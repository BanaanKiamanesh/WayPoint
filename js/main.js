// ----- Map setup -----
const MapObj = L.map("map", {
  zoomControl: false, // We'll add it manually at bottom left
  preferCanvas: true,
}).setView([0, 0], 2); // World map default

// OSM tile layer
const OsmTiles = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }
);
OsmTiles.addTo(MapObj);

// Add zoom control at bottom left
L.control
  .zoom({
    position: "bottomleft",
  })
  .addTo(MapObj);

// Feature group to hold drawn shapes (lines/polygons)
const DrawnItems = L.featureGroup();
DrawnItems.addTo(MapObj);

const DrawOptions = {
  polyline: {
    shapeOptions: {
      color: "#ffb347",
      weight: 3,
    },
  },
  polygon: {
    allowIntersection: true,
    showArea: false,
    shapeOptions: {
      color: "#ffd166",
      weight: 2.5,
    },
  },
};

let ActiveDrawer = null;
let ActiveDrawMode = null;
let BoundaryConfirmed = false;

// Marker for search result
let SearchMarker = null;

// ----- UI elements -----
const SearchInput = document.getElementById("SearchInput");
const SearchBtn = document.getElementById("SearchBtn");
const ResultsDiv = document.getElementById("Results");
const WaypointSidebar = document.getElementById("WaypointSidebar");
const SettingsPanelLeft = document.getElementById("SettingsPanelLeft");
const WaypointListDiv = document.getElementById("WaypointList");
const TravelTimeSummary = document.getElementById("TravelTimeSummary");
const WaypointPanelHeader = document.getElementById("WaypointPanelHeader");
const UnitRadios = document.querySelectorAll('input[name="Units"]');
const GlobalAltInput = document.getElementById("GlobalAltInput");
const GlobalSpeedInput = document.getElementById("GlobalSpeedInput");
const ShapeSpacingInput = document.getElementById("ShapeSpacingInput");
const ShapeResolutionSlider = document.getElementById("ShapeResolutionSlider");
const ShapeResolutionValue = document.getElementById("ShapeResolutionValue");
const GenerateFromShapeBtn = document.getElementById("GenerateFromShapeBtn");
const ClearShapesBtn = document.getElementById("ClearShapesBtn");
const RotationInput = document.getElementById("RotationInput");
const ApplyRotationBtn = document.getElementById("ApplyRotationBtn");
const ConfirmShapeBtn = document.getElementById("ConfirmShapeBtn");
const LeftControlsWrap = document.getElementById("LeftControls");
const ToggleWaypointsBtn = document.getElementById("ToggleWaypointsBtn");
const ToggleSettingsBtn = document.getElementById("ToggleSettingsBtn");
const RightControlsWrap = document.getElementById("RightControls");
const ToggleToolsBtn = document.getElementById("ToggleToolsBtn");
const DrawLineBtn = document.getElementById("DrawLineBtn");
const DrawPolygonBtn = document.getElementById("DrawPolygonBtn");
const DrawEllipseBtn = document.getElementById("DrawEllipseBtn");
const EllipseModeBoundaryBtn = document.getElementById("EllipseModeBoundaryBtn");
const EllipseModeCircBtn = document.getElementById("EllipseModeCircBtn");
const EllipseResolutionInput = document.getElementById("EllipseResolutionInput");
const EllipseRotationInput = document.getElementById("EllipseRotationInput");

// ----- Waypoint state -----
const Waypoints = [];
const SelectedIds = new Set();
const ExpandedIds = new Set();
let IsWaypointPanelOpen = true;
let LeftPanelOpen = false;
let ActiveLeftPane = "waypoints";
let ToolsPanelOpen = false;
let NextWaypointId = 1;
const MarkerById = new Map();
let LastRotationSnapshot = null; // Reserved for future undo/redo of transforms
let LastCoverageModel = null; // stores resolution model for current boundary/path
let LastBoundaryFeature = null; // normalized boundary in WGS84 for replacement/removal
let EllipseState = null;
let EllipseMode = "boundary"; // boundary | circumference
const WaypointLine = L.polyline([], {
  color: "#4db3ff",
  weight: 3,
  opacity: 0.85,
});
WaypointLine.addTo(MapObj);

const DEFAULT_ALT = 50;
const DEFAULT_SPEED = 10;
const DEFAULT_HEADING = 0;
const DEFAULT_GIMBAL = 0;
const SettingsState = {
  units: "metric",
  globalAlt: DEFAULT_ALT,
  globalSpeed: DEFAULT_SPEED,
};

// ----- Helpers -----
function EscapeHtml(Str) {
  return String(Str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ClearResults() {
  ResultsDiv.innerHTML = "";
  ResultsDiv.style.display = "none";
}

function ShowResults(ResultsArr) {
  if (!ResultsArr || ResultsArr.length === 0) {
    ResultsDiv.innerHTML =
      '<div class="resultItem"><div class="resultMain">No results</div><div class="resultSub">Try a different query.</div></div>';
    ResultsDiv.style.display = "block";
    return;
  }

  ResultsDiv.innerHTML = "";
  for (const Item of ResultsArr) {
    const MainText = Item.display_name || "(unknown)";
    const SubText = [Item.type, Item.class].filter(Boolean).join(" / ");

    const Row = document.createElement("div");
    Row.className = "resultItem";
    Row.innerHTML =
      '<div class="resultMain">' +
      EscapeHtml(MainText) +
      "</div>" +
      '<div class="resultSub">' +
      EscapeHtml(SubText) +
      "</div>";

    Row.addEventListener("click", () => {
      const LatNum = parseFloat(Item.lat);
      const LonNum = parseFloat(Item.lon);
      if (!Number.isFinite(LatNum) || !Number.isFinite(LonNum)) return;

      if (SearchMarker) {
        MapObj.removeLayer(SearchMarker);
        SearchMarker = null;
      }

      SearchMarker = L.marker([LatNum, LonNum]).addTo(MapObj);
      SearchMarker.bindPopup(EscapeHtml(MainText)).openPopup();

      const Bb = Item.boundingbox;
      if (Bb && Bb.length === 4) {
        const South = parseFloat(Bb[0]);
        const North = parseFloat(Bb[1]);
        const West = parseFloat(Bb[2]);
        const East = parseFloat(Bb[3]);
        if ([South, North, West, East].every(Number.isFinite)) {
          MapObj.fitBounds(
            [
              [South, West],
              [North, East],
            ],
            { padding: [30, 30] }
          );
        } else {
          MapObj.setView([LatNum, LonNum], 16);
        }
      } else {
        MapObj.setView([LatNum, LonNum], 16);
      }

      ClearResults();
    });

    ResultsDiv.appendChild(Row);
  }

  ResultsDiv.style.display = "block";
}

function FormatCoord(Num) {
  return Number(Num).toFixed(5);
}

function UpdateLeftPanelUi() {
  const ShowWaypoints = LeftPanelOpen && ActiveLeftPane === "waypoints";
  const ShowSettings = LeftPanelOpen && ActiveLeftPane === "settings";

  if (LeftControlsWrap) {
    LeftControlsWrap.classList.toggle("collapsed", !LeftPanelOpen);
    LeftControlsWrap.classList.toggle("expanded", LeftPanelOpen);
  }

  if (WaypointSidebar) {
    WaypointSidebar.style.display = ShowWaypoints ? "block" : "none";
  }
  if (SettingsPanelLeft) {
    SettingsPanelLeft.style.display = ShowSettings ? "block" : "none";
  }
  if (ToggleWaypointsBtn) {
    ToggleWaypointsBtn.classList.toggle("active", ShowWaypoints);
  }
  if (ToggleSettingsBtn) {
    ToggleSettingsBtn.classList.toggle("active", ShowSettings);
  }
}

function StopActiveDrawing() {
  if (ActiveDrawer) {
    ActiveDrawer.disable();
  }
  ActiveDrawer = null;
  ActiveDrawMode = null;
  clearEllipseHandles();
}

function HasBoundaryShape() {
  return DrawnItems && DrawnItems.getLayers().length > 0;
}

function ConfirmReplaceBoundary() {
  if (!HasBoundaryShape()) return true;
  return window.confirm("Replace existing boundary shape?");
}

function StartDrawing(Mode) {
  StopActiveDrawing();

  if (!ConfirmReplaceBoundary()) {
    return;
  }
  DrawnItems.clearLayers();
  BoundaryConfirmed = false;
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();

  if (Mode === "polyline") {
    ActiveDrawer = new L.Draw.Polyline(MapObj, DrawOptions.polyline);
  } else if (Mode === "polygon") {
    ActiveDrawer = new L.Draw.Polygon(MapObj, DrawOptions.polygon);
  } else if (Mode === "ellipse") {
    ActiveDrawMode = "ellipse";
    startEllipseInteraction();
    UpdateToolsUi();
    return;
  } else {
    return;
  }

  ActiveDrawMode = Mode;
  ActiveDrawer.enable();
  UpdateToolsUi();
}

function UpdateRightPanelUi() {
  if (RightControlsWrap) {
    RightControlsWrap.classList.toggle("collapsed", !ToolsPanelOpen);
    RightControlsWrap.classList.toggle("expanded", ToolsPanelOpen);
  }
  if (ToggleToolsBtn) {
    ToggleToolsBtn.classList.toggle("active", ToolsPanelOpen);
  }
}

function TryFinishPolygonOnFirstPoint(Ev) {
  if (!ActiveDrawer || ActiveDrawMode !== "polygon") return false;
  const Markers = ActiveDrawer._markers || [];
  if (Markers.length < 2) return false;

  const FirstLatLng = Markers[0].getLatLng();
  const ClickPt = MapObj.latLngToLayerPoint(Ev.latlng);
  const FirstPt = MapObj.latLngToLayerPoint(FirstLatLng);
  const DistPx = ClickPt.distanceTo(FirstPt);

  if (DistPx <= 12) {
    // Close polygon manually when user clicks near the first vertex
    ActiveDrawer._finishShape && ActiveDrawer._finishShape();
    return true;
  }
  return false;
}

function clearEllipseHandles() {
  if (EllipseState && EllipseState.handles) {
    EllipseState.handles.forEach((h) => MapObj.removeLayer(h));
    EllipseState.handles = [];
  }
  if (EllipseState && EllipseState.moveHandler) {
    MapObj.off("mousemove", EllipseState.moveHandler);
    EllipseState.moveHandler = null;
  }
  if (EllipseState && EllipseState.clickHandler) {
    MapObj.off("click", EllipseState.clickHandler);
    EllipseState.clickHandler = null;
  }
}

function updateEllipseLayer() {
  if (!EllipseState || !EllipseState.center) return;
  const pts = computeEllipsePoints(
    [EllipseState.center.lat, EllipseState.center.lng],
    EllipseState.rx || 10,
    EllipseState.ry || 10,
    EllipseState.rotationDeg || 0
  );
  DrawnItems.clearLayers();
  const poly = L.polygon(pts, { color: "#9b5de5", weight: 2, fillOpacity: 0.1 });
  DrawnItems.addLayer(poly);
  LastBoundaryFeature = poly.toGeoJSON();
  LastCoverageModel = null;
}

function createHandle(latlng, onDrag, onDragEnd, variant = "default") {
  const isRotation = variant === "rotate";
  const html = isRotation
    ? '<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:#ff8c00;font-size:18px;transform:rotate(-20deg);text-shadow:0 0 6px rgba(0,0,0,0.6);">&#8635;</div>'
    : '<div style="width:12px;height:12px;border-radius:6px;background:#ff8c00;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>';
  const marker = L.marker(latlng, {
    draggable: true,
    icon: L.divIcon({
      className: "ellipseHandle",
      html,
      iconSize: isRotation ? [22, 22] : [14, 14],
      iconAnchor: isRotation ? [11, 11] : [7, 7],
    }),
  });
  if (onDrag) marker.on("drag", (ev) => onDrag(ev.latlng));
  if (onDragEnd) marker.on("dragend", (ev) => onDragEnd(ev.latlng));
  marker.addTo(MapObj);
  return marker;
}

function refreshHandles() {
  if (!EllipseState) return;
  clearEllipseHandles();
  const center = EllipseState.center;
  if (!center) return;
  const rotRad = (EllipseState.rotationDeg || 0) * (Math.PI / 180);
  const rx = EllipseState.rx || 10;
  const ry = EllipseState.ry || 10;

  // Axis end points in local frame, then rotate to world
  const axisX = rotateXY(rx, 0, rotRad);
  const axisY = rotateXY(0, ry, rotRad);
  const rotVec = rotateXY(rx * 1.2, 0, rotRad);

  const east = localMetersToLatLng(center, axisX[0], axisX[1]);
  const north = localMetersToLatLng(center, axisY[0], axisY[1]);
  const rotHandle = localMetersToLatLng(center, rotVec[0], rotVec[1]);

  const centerHandle = createHandle(
    center,
    (ll) => {
      EllipseState.center = ll;
      updateEllipseLayer();
    },
    () => refreshHandles()
  );

  const rxHandle = createHandle(
    east,
    (ll) => {
      const { x, y } = latLngToLocalMeters(center, ll);
      const [xr] = rotateXY(x, y, -rotRad);
      EllipseState.rx = Math.max(1, Math.abs(xr));
      updateEllipseLayer();
      const snappedVec = rotateXY(EllipseState.rx, 0, rotRad);
      rxHandle.setLatLng(localMetersToLatLng(center, snappedVec[0], snappedVec[1]));
    },
    () => refreshHandles()
  );

  const ryHandle = createHandle(
    north,
    (ll) => {
      const { x, y } = latLngToLocalMeters(center, ll);
      const [, yr] = rotateXY(x, y, -rotRad);
      EllipseState.ry = Math.max(1, Math.abs(yr));
      updateEllipseLayer();
      const vec = rotateXY(0, EllipseState.ry, rotRad);
      ryHandle.setLatLng(localMetersToLatLng(center, vec[0], vec[1]));
    },
    () => refreshHandles()
  );

  const rotHandleMarker = createHandle(
    rotHandle,
    (ll) => {
      const { x, y } = latLngToLocalMeters(center, ll);
      const ang = (Math.atan2(y, x) * 180) / Math.PI;
      EllipseState.rotationDeg = (ang + 360) % 360;
      updateEllipseLayer();
      const vec = rotateXY(rx * 1.2, 0, (EllipseState.rotationDeg * Math.PI) / 180);
      rotHandleMarker.setLatLng(localMetersToLatLng(center, vec[0], vec[1]));
    },
    () => refreshHandles(),
    "rotate"
  );

  EllipseState.handles.push(centerHandle, rxHandle, ryHandle, rotHandleMarker);
}

function startEllipseInteraction() {
  EllipseState = {
    center: null,
    rx: 30,
    ry: 30,
    rotationDeg: 0,
    handles: [],
    moveHandler: null,
    clickHandler: null,
  };
  let step = 0;

  const clickHandler = (ev) => {
    if (ActiveDrawMode !== "ellipse") return;
    if (step === 0) {
      EllipseState.center = ev.latlng;
      // live preview radius: follow mouse
      const moveHandler = (mv) => {
        if (!EllipseState.center) return;
        const dist =
          turf.distance(
            [EllipseState.center.lng, EllipseState.center.lat],
            [mv.latlng.lng, mv.latlng.lat],
            { units: "kilometers" }
          ) * 1000;
        EllipseState.rx = Math.max(1, dist);
        EllipseState.ry = Math.max(1, dist);
        updateEllipseLayer();
      };
      EllipseState.moveHandler = moveHandler;
      MapObj.on("mousemove", moveHandler);
      step = 1;
    } else if (step === 1) {
      const d = turf.distance(
        [EllipseState.center.lng, EllipseState.center.lat],
        [ev.latlng.lng, ev.latlng.lat],
        { units: "kilometers" }
      );
      EllipseState.rx = Math.max(1, d * 1000);
      EllipseState.ry = EllipseState.rx;
      updateEllipseLayer();
      refreshHandles();
      if (EllipseState.moveHandler) {
        MapObj.off("mousemove", EllipseState.moveHandler);
        EllipseState.moveHandler = null;
      }
      step = 2;
      ActiveDrawMode = null;
      MapObj.off("click", clickHandler);
      EllipseState.clickHandler = null;
      UpdateToolsUi();
    }
  };

  EllipseState.clickHandler = clickHandler;
  MapObj.on("click", clickHandler);
}

function coveragePlanningMeters(polygonFeature, spacingMeters, resolutionMeters) {
  if (typeof turf === "undefined") return [];
  const normalized = normalizeBoundaryFeature(polygonFeature, spacingMeters);
  const model = buildCoverageModelFromFeature(normalized, spacingMeters);
  if (!model) return [];
  const levelMax = (model.maxLevel || 0) + 1;
  let levelVal = levelMax;
  if (Number.isFinite(resolutionMeters) && resolutionMeters <= 0) {
    levelVal = 1;
  } else if (Number.isFinite(resolutionMeters) && resolutionMeters > 0) {
    // Map desired spacing to nearest dyadic level (coarser spacing -> lower level)
    const desiredSpacing = resolutionMeters;
    const kApprox = desiredSpacing / Math.max(model.baseStepVal, 1e-6);
    const kExp = Math.round(Math.log2(Math.max(kApprox, 1)));
    const kVal = Math.pow(2, kExp);
    const levelFromK = model.maxLevel - Math.round(Math.log2(Math.max(kVal, 1))) + 1;
    levelVal = clamp(levelFromK, 1, levelMax);
  }
  const Res = generatePhotoWaypointsForLevel(model, levelVal);
  return Res ? Res.latLngs : [];
}

function normalizeBoundaryFeature(feature, spacingMeters) {
  if (!feature || !feature.geometry) return null;
  const type = feature.geometry.type;
  if (type === "Polygon" || type === "MultiPolygon") {
    return feature;
  }
  if (type === "LineString" || type === "MultiLineString") {
    const bufferDistanceKm = Math.max(spacingMeters || 10, 5) / 1000;
    const buffered = turf.buffer(feature, bufferDistanceKm, { units: "kilometers" });
    return buffered;
  }
  return null;
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function ellipseCircumferenceWaypoints(feature, spacingMeters, rotationDeg) {
  const spacing = Number.isFinite(spacingMeters) && spacingMeters > 0 ? spacingMeters : 20;
  if (!feature) return [];

  // Prefer sampling actual current boundary polygon to guarantee alignment
  const polyFeature =
    feature && feature.geometry && feature.geometry.type === "Polygon"
      ? feature
      : normalizeBoundaryFeature(feature, spacing);

  if (polyFeature && polyFeature.geometry && polyFeature.geometry.type === "Polygon") {
    const ring = (polyFeature.geometry.coordinates[0] || []).slice();
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push([...ring[0]]);
    }
    const line = turf.lineString(ring);
    const totalM = turf.length(line, { units: "kilometers" }) * 1000;
    const step = Math.max(1, spacing);
    const steps = Math.max(3, Math.ceil(totalM / step));
    const out = [];
    for (let i = 0; i < steps; i++) {
      const distKm = (totalM * i) / steps / 1000;
      const pt = turf.along(line, distKm, { units: "kilometers" });
      if (pt && pt.geometry && pt.geometry.coordinates) {
        out.push(pt.geometry.coordinates);
      }
    }
    return out;
  }

  // Fallback: rebuild from ellipse params (live state)
  let centerLL = null;
  let rx = null;
  let ry = null;
  let rotDeg = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  if (EllipseState && EllipseState.center) {
    centerLL = EllipseState.center;
    rx = EllipseState.rx || spacing;
    ry = EllipseState.ry || spacing;
    rotDeg = EllipseState.rotationDeg || rotDeg;
  } else {
    return [];
  }

  const centerMerc = turf.toMercator([centerLL.lng, centerLL.lat]);
  const approxCirc = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
  const steps = Math.max(12, Math.ceil(approxCirc / spacing));
  const rotRad = (rotDeg * Math.PI) / 180;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    const xr = x * Math.cos(rotRad) - y * Math.sin(rotRad);
    const yr = x * Math.sin(rotRad) + y * Math.cos(rotRad);
    const wgs = turf.toWgs84([centerMerc[0] + xr, centerMerc[1] + yr]);
    out.push(wgs);
  }
  return out;
}

function buildCoverageModelFromFeature(boundaryFeature, spacingMeters) {
  try {
    const mercator = turf.toMercator(boundaryFeature);
    const coords =
      mercator.geometry.type === "Polygon"
        ? mercator.geometry.coordinates[0]
        : mercator.geometry.coordinates[0][0];

    const [ox, oy] = closePolygon(
      coords.map((c) => c[0]),
      coords.map((c) => c[1])
    );

    const [rx, ry] = planning(
      ox,
      oy,
      spacingMeters,
      MovingDirection.RIGHT,
      SweepDirection.UP
    );

    const resModel = buildResolutionModel(rx, ry);
    return {
      boundaryFeature,
      spacingMeters,
      rx,
      ry,
      baseStepVal: resModel.baseStepVal,
      baseDistArr: resModel.baseDistArr,
      turnDistArr: resModel.turnDistArr,
      maxLevel: resModel.maxLevel,
    };
  } catch (Err) {
    console.error("Failed to build coverage model", Err);
    return null;
  }
}

function generatePhotoWaypointsForLevel(model, levelVal) {
  if (!model || !model.rx || !model.ry) return null;
  const levelMin = 1;
  const levelMax = (model.maxLevel || 0) + 1;
  const level = clamp(levelVal || levelMax, levelMin, levelMax);

  const Result = generatePhotoWaypointsByResolutionLevel(
    model.rx,
    model.ry,
    level,
    model.baseStepVal,
    model.baseDistArr,
    model.turnDistArr,
    model.maxLevel
  );

  const latLngs = [];
  for (let i = 0; i < Result.wx.length; i++) {
    const [lon, lat] = turf.toWgs84([Result.wx[i], Result.wy[i]]);
    latLngs.push([lat, lon]);
  }

  return {
    latLngs,
    levelUsed: Result.levelUsed,
    photoSpacingUsed: Result.photoSpacingUsed,
    count: Result.count,
  };
}

function syncResolutionSlider(model, preferredLevel) {
  if (!ShapeResolutionSlider) return 1;
  const maxLevelUi = model ? Math.max(1, (model.maxLevel || 0) + 1) : 1;
  const minLevelUi = 1;
  const levelVal = clamp(preferredLevel || maxLevelUi, minLevelUi, maxLevelUi);
  ShapeResolutionSlider.min = String(minLevelUi);
  ShapeResolutionSlider.max = String(maxLevelUi);
  ShapeResolutionSlider.step = "1";
  ShapeResolutionSlider.value = String(levelVal);
  UpdateResolutionDisplay(levelVal);
  return levelVal;
}

function RegenerateWaypointsFromResolution() {
  if (BoundaryConfirmed) return;
  if (!LastCoverageModel || !LastBoundaryFeature) return;
  const Level = GetResolutionLevel() || 1;
  applyCoverageModelAtLevel(LastCoverageModel, LastBoundaryFeature, Level);
}

function applyCoverageModelAtLevel(model, boundaryFeature, levelVal) {
  const Res = generatePhotoWaypointsForLevel(model, levelVal);
  if (!Res || !Res.latLngs || !Res.latLngs.length) return;

  RemoveWaypointsInsideBoundary(boundaryFeature);

  SelectedIds.clear();
  Res.latLngs.forEach((ll) => {
    AddWaypoint(ll[0], ll[1], { selectionMode: "add", skipRender: true });
  });

  if (ShapeResolutionSlider) {
    ShapeResolutionSlider.value = String(Res.levelUsed);
  }
  UpdateResolutionDisplay(Res.levelUsed);
  RenderAll();
}

function GetSpacingMeters() {
  if (!ShapeSpacingInput) return null;
  const ValNum = parseFloat(ShapeSpacingInput.value);
  if (!Number.isFinite(ValNum) || ValNum <= 0) return null;
  return ValNum;
}

function GetResolutionLevel() {
  if (!ShapeResolutionSlider) return null;
  const ValNum = parseInt(ShapeResolutionSlider.value, 10);
  if (!Number.isFinite(ValNum)) return null;
  return ValNum;
}

function UpdateResolutionDisplay(LevelOverride) {
  if (!ShapeResolutionSlider || !ShapeResolutionValue) return;
  const Level = LevelOverride || GetResolutionLevel() || 1;

  let SpacingInfo = "";
  if (LastCoverageModel && LastCoverageModel.baseStepVal !== undefined) {
    const maxLevel = (LastCoverageModel.maxLevel || 0) + 1;
    const levelClamped = Math.min(Math.max(Level, 1), maxLevel);
    const kExp = LastCoverageModel.maxLevel - (levelClamped - 1);
    const kVal = Math.max(1, Math.pow(2, kExp));
    const photoSpacing = LastCoverageModel.baseStepVal * kVal;
    SpacingInfo = ` (~${photoSpacing.toFixed(2)} m)`;
  }

  ShapeResolutionValue.textContent = `Level ${Level}${SpacingInfo}`;
}

function PushUniqueCoord(List, CoordArr) {
  if (!CoordArr || CoordArr.length < 2) return;
  const Last = List[List.length - 1];
  if (
    Last &&
    Math.abs(Last[0] - CoordArr[0]) < 1e-6 &&
    Math.abs(Last[1] - CoordArr[1]) < 1e-6
  ) {
    return;
  }
  List.push([CoordArr[0], CoordArr[1]]);
}

function SampleLineFeature(LineFeature, SpacingMeters) {
  const Points = [];
  if (!LineFeature || !Number.isFinite(SpacingMeters) || SpacingMeters <= 0) {
    return Points;
  }

  // Flatten to handle both LineString and MultiLineString
  turf.flattenEach(LineFeature, (CurFeat) => {
    const LengthKm = turf.length(CurFeat, { units: "kilometers" });
    if (!Number.isFinite(LengthKm) || LengthKm <= 0) return;

    const TotalMeters = LengthKm * 1000;
    for (let Dist = 0; Dist <= TotalMeters; Dist += SpacingMeters) {
      const Pt = turf.along(CurFeat, Dist / 1000, { units: "kilometers" });
      if (Pt && Pt.geometry && Pt.geometry.coordinates) {
        PushUniqueCoord(Points, Pt.geometry.coordinates);
      }
    }

    // Ensure the final vertex is included
    const Coords = CurFeat.geometry && CurFeat.geometry.coordinates;
    if (Coords && Coords.length) {
      PushUniqueCoord(Points, Coords[Coords.length - 1]);
    }
  });

  return Points;
}

function GenerateWaypointCoordsFromShape(Feature, SpacingMeters, ResolutionMeters) {
  if (typeof turf === "undefined") return [];
  if (!Feature || !Feature.geometry) return [];
  const pathLatLngs = coveragePlanningMeters(Feature, SpacingMeters, ResolutionMeters);
  // return as [lng, lat] pairs to match AddWaypoint call below
  return pathLatLngs.map((ll) => [ll[1], ll[0]]);
}

function SnapshotSelectedWaypoints() {
  return Waypoints.filter((Wp) => SelectedIds.has(Wp.Id)).map((Wp) => ({
    Id: Wp.Id,
    Lat: Wp.Lat,
    Lon: Wp.Lon,
  }));
}

function RotateSelectedWaypoints(AngleDeg) {
  const SelectedList = Waypoints.filter((Wp) => SelectedIds.has(Wp.Id));
  const AngleNum = parseFloat(AngleDeg);
  if (!Number.isFinite(AngleNum) || SelectedList.length < 2) return;

  // Centroid anchor (average lat/lon)
  const AnchorLat =
    SelectedList.reduce((Sum, Wp) => Sum + Wp.Lat, 0) / SelectedList.length;
  const AnchorLon =
    SelectedList.reduce((Sum, Wp) => Sum + Wp.Lon, 0) / SelectedList.length;

  const Zoom = MapObj.getZoom();
  const AnchorPt = MapObj.project([AnchorLat, AnchorLon], Zoom);

  // Leaflet projects to a Y-down plane, so invert angle for intuitive CCW rotation
  const AngleRad = (-AngleNum * Math.PI) / 180;
  const CosA = Math.cos(AngleRad);
  const SinA = Math.sin(AngleRad);

  // Store snapshot for future undo/redo integrations
  LastRotationSnapshot = SnapshotSelectedWaypoints();

  SelectedList.forEach((Wp) => {
    const Pt = MapObj.project([Wp.Lat, Wp.Lon], Zoom);
    const X0 = Pt.x - AnchorPt.x;
    const Y0 = Pt.y - AnchorPt.y;

    const X1 = X0 * CosA - Y0 * SinA;
    const Y1 = X0 * SinA + Y0 * CosA;

    const RotatedLatLng = MapObj.unproject(
      L.point(X1 + AnchorPt.x, Y1 + AnchorPt.y),
      Zoom
    );
    Wp.Lat = RotatedLatLng.lat;
    Wp.Lon = RotatedLatLng.lng;
  });

  RenderAll();
}

function MarkerIcon(Label, IsSelected) {
  return L.divIcon({
    className: "wpMarker" + (IsSelected ? " wpMarkerSelected" : ""),
    html:
      '<div class="wpMarkerCircle' +
      (IsSelected ? " selected" : "") +
      '">' +
      Label +
      "</div>",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function UpdatePolyline() {
  const LatLngs = Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  WaypointLine.setLatLngs(LatLngs);
}

function GetFirstDrawnFeature() {
  let GeoJson = null;
  DrawnItems.eachLayer((Layer) => {
    if (!GeoJson) {
      GeoJson = Layer.toGeoJSON();
    }
  });
  return GeoJson;
}

function GenerateWaypointsFromDrawnShape() {
  const SpacingMeters = GetSpacingMeters();
  const ShapeFeature = GetFirstDrawnFeature();
  if (!SpacingMeters || !ShapeFeature) return;

  const BoundaryFeature = normalizeBoundaryFeature(ShapeFeature, SpacingMeters);
  if (!BoundaryFeature) return;

  // Ellipse circumference mode: drop waypoints along ellipse edge
  if (EllipseMode === "circumference") {
    const circSpacing = parseFloat(
      EllipseResolutionInput ? EllipseResolutionInput.value : "0"
    );
    const rotDeg = parseFloat(EllipseRotationInput ? EllipseRotationInput.value : "0") || 0;
    const pts = ellipseCircumferenceWaypoints(BoundaryFeature, circSpacing, rotDeg);
    if (!pts.length) return;
    RemoveWaypointsInsideBoundary(BoundaryFeature);
    SelectedIds.clear();
    pts.forEach((p) => {
      const wp = AddWaypoint(p[1], p[0], { selectionMode: "add", skipRender: true });
      wp.Speed = SettingsState.globalSpeed;
      wp.UseGlobalSpeed = true;
    });
    RenderAll();
    return;
  }

  const Model = buildCoverageModelFromFeature(BoundaryFeature, SpacingMeters);
  if (!Model) return;

  LastCoverageModel = Model;
  LastBoundaryFeature = BoundaryFeature;

  const PreferredLevel = GetResolutionLevel() || 1;
  const LevelToUse = syncResolutionSlider(Model, PreferredLevel);

  applyCoverageModelAtLevel(Model, BoundaryFeature, LevelToUse);
  UpdateToolsUi();
}

function RemoveWaypointsInsideBoundary(BoundaryFeature) {
  if (!BoundaryFeature) return;
  const PolyFeature =
    BoundaryFeature.type === "Feature"
      ? BoundaryFeature
      : { type: "Feature", geometry: BoundaryFeature, properties: {} };
  // Slightly buffer to ensure boundary points are included in the removal set
  const RemovalPoly = turf.buffer(PolyFeature, 0.00001, { units: "kilometers" });
  const Remaining = [];
  Waypoints.forEach((Wp) => {
    const Inside = turf.booleanPointInPolygon(
      turf.point([Wp.Lon, Wp.Lat]),
      RemovalPoly,
      { ignoreBoundary: false }
    );
    if (Inside) {
      SelectedIds.delete(Wp.Id);
      ExpandedIds.delete(Wp.Id);
      const Marker = MarkerById.get(Wp.Id);
      if (Marker) {
        MapObj.removeLayer(Marker);
        MarkerById.delete(Wp.Id);
      }
    } else {
      Remaining.push(Wp);
    }
  });
  Waypoints.length = 0;
  Remaining.forEach((Wp) => Waypoints.push(Wp));
}

function UpdateToolsUi() {
  const HasShape = DrawnItems && DrawnItems.getLayers().length > 0;
  const SpacingValid = GetSpacingMeters() !== null;
  const ResolutionValid = GetResolutionLevel() !== null;
  const HasRotationSelection = SelectedIds.size >= 2;
  const AngleValid =
    RotationInput && Number.isFinite(parseFloat(RotationInput.value));
  const IsDrawingLine = ActiveDrawMode === "polyline";
  const IsDrawingPoly = ActiveDrawMode === "polygon";
  const BoundaryLocked = BoundaryConfirmed;

  if (GenerateFromShapeBtn) {
    GenerateFromShapeBtn.disabled =
      !HasShape || !SpacingValid || !ResolutionValid || BoundaryLocked;
  }
  if (ClearShapesBtn) {
    ClearShapesBtn.disabled = !HasShape || BoundaryLocked;
  }
  if (ApplyRotationBtn) {
    ApplyRotationBtn.disabled = !(HasRotationSelection && AngleValid);
  }
  if (DrawLineBtn) {
    DrawLineBtn.classList.toggle("active", IsDrawingLine);
  }
  if (DrawPolygonBtn) {
    DrawPolygonBtn.classList.toggle("active", IsDrawingPoly);
  }
  if (DrawEllipseBtn) {
    DrawEllipseBtn.classList.toggle("active", ActiveDrawMode === "ellipse");
  }
  if (ConfirmShapeBtn) {
    ConfirmShapeBtn.disabled = !HasShape || BoundaryLocked;
    ConfirmShapeBtn.classList.toggle("active", BoundaryConfirmed);
  }
  if (ShapeResolutionSlider) {
    ShapeResolutionSlider.disabled = !HasShape || BoundaryLocked || !LastCoverageModel;
  }
  if (EllipseModeBoundaryBtn && EllipseModeCircBtn) {
    EllipseModeBoundaryBtn.classList.toggle("active", EllipseMode === "boundary");
    EllipseModeCircBtn.classList.toggle("active", EllipseMode === "circumference");
  }
}

function RefreshMarkers() {
  const Seen = new Set();
  Waypoints.forEach((Wp, Idx) => {
    const IsSelected = SelectedIds.has(Wp.Id);
    let Marker = MarkerById.get(Wp.Id);
    const Icon = MarkerIcon(Idx + 1, IsSelected);

    if (!Marker) {
      Marker = L.marker([Wp.Lat, Wp.Lon], {
        draggable: true,
        icon: Icon,
      });

      Marker.on("click", () => {
        SelectedIds.clear();
        SelectedIds.add(Wp.Id);
        if (ExpandedIds.has(Wp.Id)) {
          ExpandedIds.delete(Wp.Id);
        } else {
          ExpandedIds.add(Wp.Id);
        }
        RenderAll();
      });

      Marker.on("drag", (Ev) => {
        Wp.Lat = Ev.latlng.lat;
        Wp.Lon = Ev.latlng.lng;
        UpdatePolyline();
        RenderWaypointList();
      });

      Marker.addTo(MapObj);
      MarkerById.set(Wp.Id, Marker);
    } else {
      Marker.setLatLng([Wp.Lat, Wp.Lon]);
      Marker.setIcon(Icon);
    }

    Seen.add(Wp.Id);
  });

  // Remove markers for deleted waypoints
  for (const [Id, Marker] of MarkerById.entries()) {
    if (!Seen.has(Id)) {
      MapObj.removeLayer(Marker);
      MarkerById.delete(Id);
    }
  }
}

function AddWaypoint(LatNum, LonNum, Options) {
  const Opts = Options || {};
  const NewWp = {
    Id: "wp-" + NextWaypointId++,
    Lat: LatNum,
    Lon: LonNum,
    Alt: SettingsState.globalAlt,
    Speed: SettingsState.globalSpeed,
    Heading: DEFAULT_HEADING,
    Gimbal: DEFAULT_GIMBAL,
    UseGlobalAlt: true,
    UseGlobalSpeed: true,
  };
  Waypoints.push(NewWp);

  const SelectionMode = Opts.selectionMode || "replace"; // replace | add | none
  if (SelectionMode === "replace") {
    SelectedIds.clear();
    SelectedIds.add(NewWp.Id);
  } else if (SelectionMode === "add") {
    SelectedIds.add(NewWp.Id);
  }

  if (!Opts.skipRender) {
    RenderAll();
  }

  return NewWp;
}

function DeleteWaypoint(WpId) {
  const Idx = Waypoints.findIndex((Wp) => Wp.Id === WpId);
  if (Idx === -1) return;
  Waypoints.splice(Idx, 1);
  SelectedIds.delete(WpId);
  ExpandedIds.delete(WpId);
  const Marker = MarkerById.get(WpId);
  if (Marker) {
    MapObj.removeLayer(Marker);
    MarkerById.delete(WpId);
  }
  RenderAll();
}

function FieldLabel(Key) {
  if (Key === "Alt") {
    return SettingsState.units === "imperial" ? "Altitude (ft)" : "Altitude (m)";
  }
  if (Key === "Speed") {
    return SettingsState.units === "imperial" ? "Speed (mph)" : "Speed (m/s)";
  }
  if (Key === "Heading") {
    return "Heading (deg)";
  }
  if (Key === "Gimbal") {
    return "Gimbal (deg)";
  }
  return Key;
}

function formatDurationSeconds(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "~0s";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  const parts = [];
  if (hours > 0) parts.push(hours + "h");
  if (minutes > 0) parts.push(minutes + "m");
  if (hours === 0 && minutes === 0) parts.push(seconds + "s");
  return "~" + parts.join(" ");
}

function computeTravelTimeSeconds() {
  if (!turf || Waypoints.length < 2) return 0;
  const totalM = computeTotalDistanceMeters();
  if (!Number.isFinite(totalM) || totalM <= 0) return 0;

  let speedMs = SettingsState.globalSpeed;
  if (SettingsState.units === "imperial") {
    speedMs = speedMs * 0.44704; // mph to m/s
  }
  if (!Number.isFinite(speedMs) || speedMs <= 0) return 0;

  return totalM / speedMs;
}

function computeTotalDistanceMeters() {
  if (!turf || Waypoints.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < Waypoints.length - 1; i++) {
    const a = Waypoints[i];
    const b = Waypoints[i + 1];
    total += turf.distance([a.Lon, a.Lat], [b.Lon, b.Lat], { units: "kilometers" }) * 1000;
  }
  return total;
}

function RenderWaypointList() {
  if (!WaypointListDiv) return;
  WaypointListDiv.innerHTML = "";

  WaypointListDiv.style.display = IsWaypointPanelOpen ? "block" : "none";
  if (WaypointPanelHeader) {
    WaypointPanelHeader.classList.toggle("collapsed", !IsWaypointPanelOpen);
  }
  if (WaypointSidebar) {
    WaypointSidebar.classList.toggle("collapsed", !IsWaypointPanelOpen);
  }
  if (TravelTimeSummary) {
    if (Waypoints.length > 1) {
      const sec = computeTravelTimeSeconds();
      const distM = computeTotalDistanceMeters();
      const useImperial = SettingsState.units === "imperial";
      const distVal = useImperial ? distM * 0.000621371 : distM / 1000;
      const distUnit = useImperial ? "mi" : "km";
      TravelTimeSummary.style.display = "block";
      TravelTimeSummary.textContent =
        "~" + distVal.toFixed(2) + " " + distUnit + " | " + formatDurationSeconds(sec);
    } else {
      TravelTimeSummary.style.display = "none";
      TravelTimeSummary.textContent = "";
    }
  }

  if (Waypoints.length === 0) {
    const Empty = document.createElement("div");
    Empty.className = "emptyState";
    Empty.textContent = "No waypoints yet. Click the map to add.";
    WaypointListDiv.appendChild(Empty);
    return;
  }

  Waypoints.forEach((Wp, Idx) => {
    const IsSelected = SelectedIds.has(Wp.Id);
    const IsExpanded = ExpandedIds.has(Wp.Id);

    const Row = document.createElement("div");
    Row.className =
      "wpRow" + (IsSelected ? " selected" : "") + (IsExpanded ? " expanded" : "");
    Row.dataset.id = Wp.Id;

    const Header = document.createElement("div");
    Header.className = "wpHeader";

    const HeaderMain = document.createElement("div");
    HeaderMain.className = "wpHeaderMain";

    const Caret = document.createElement("span");
    Caret.className = "wpCaret";
    Caret.textContent = IsExpanded ? "v" : ">";

    const Index = document.createElement("div");
    Index.className = "wpIndex";
    Index.textContent = Idx + 1;

    const Label = document.createElement("div");
    Label.className = "wpLabel";
    Label.textContent = "Waypoint";

    HeaderMain.appendChild(Caret);
    HeaderMain.appendChild(Index);
    HeaderMain.appendChild(Label);

    const DeleteBtn = document.createElement("button");
    DeleteBtn.type = "button";
    DeleteBtn.className = "wpDelete";
    DeleteBtn.textContent = "Delete";
    DeleteBtn.addEventListener("click", (Ev) => {
      Ev.stopPropagation();
      DeleteWaypoint(Wp.Id);
    });

    Header.appendChild(HeaderMain);
    Header.appendChild(DeleteBtn);

    HeaderMain.addEventListener("click", (Ev) => {
      Ev.stopPropagation();
      const WasOpen = ExpandedIds.has(Wp.Id);
      ExpandedIds[WasOpen ? "delete" : "add"](Wp.Id);
      SelectedIds.clear();
      SelectedIds.add(Wp.Id);
      RenderAll();
    });

    const Details = document.createElement("div");
    Details.className = "wpDetails";
    Details.style.display = IsExpanded ? "block" : "none";

    const Coords = document.createElement("div");
    Coords.className = "wpCoordsRow";
    Coords.textContent =
      "Lat " + FormatCoord(Wp.Lat) + " | Lon " + FormatCoord(Wp.Lon);
    Details.appendChild(Coords);

    const Fields = document.createElement("div");
    Fields.className = "wpFields";

    [
      { key: "Alt", step: "1", min: undefined, max: undefined, useKey: "UseGlobalAlt" },
      { key: "Speed", step: "0.5", min: undefined, max: undefined, useKey: "UseGlobalSpeed" },
      { key: "Heading", step: "1", min: 0, max: 360, useKey: null },
      { key: "Gimbal", step: "1", min: -90, max: 90, useKey: null },
    ].forEach((Field) => {
      const Wrap = document.createElement("div");
      Wrap.className = "wpField";

      const HeaderRow = document.createElement("div");
      HeaderRow.className = "wpFieldHeader";
      const Lab = document.createElement("span");
      Lab.textContent = FieldLabel(Field.key);
      HeaderRow.appendChild(Lab);

      if (Field.useKey) {
        const ToggleWrap = document.createElement("label");
        ToggleWrap.className = "wpToggleWrap";

        const Toggle = document.createElement("input");
        Toggle.type = "checkbox";
        Toggle.checked = Boolean(Wp[Field.useKey]);
        Toggle.addEventListener("click", (Ev) => Ev.stopPropagation());
        Toggle.addEventListener("change", (Ev) => {
          Ev.stopPropagation();
          const UseGlobal = Ev.target.checked;
          Wp[Field.useKey] = UseGlobal;
          if (UseGlobal) {
            if (Field.key === "Alt") Wp.Alt = SettingsState.globalAlt;
            if (Field.key === "Speed") Wp.Speed = SettingsState.globalSpeed;
          }
          RenderWaypointList();
        });

        const ToggleLabel = document.createElement("span");
        ToggleLabel.textContent = "Use global";

        ToggleWrap.appendChild(Toggle);
        ToggleWrap.appendChild(ToggleLabel);
        HeaderRow.appendChild(ToggleWrap);
      }
      Wrap.appendChild(HeaderRow);

      const Input = document.createElement("input");
      Input.type = "number";
      Input.step = Field.step;
      if (Field.min !== undefined) Input.min = Field.min;
      if (Field.max !== undefined) Input.max = Field.max;
      Input.value = Wp[Field.key];
      const IsGlobal = Field.useKey ? Boolean(Wp[Field.useKey]) : false;
      Input.disabled = IsGlobal;
      Input.addEventListener("click", (Ev) => Ev.stopPropagation());
      Input.addEventListener("change", (Ev) => {
        Ev.stopPropagation();
        let ValNum = parseFloat(Ev.target.value);
        if (Number.isFinite(ValNum)) {
          if (Field.min !== undefined) ValNum = Math.max(Field.min, ValNum);
          if (Field.max !== undefined) ValNum = Math.min(Field.max, ValNum);
          Wp[Field.key] = ValNum;
        }
        RenderWaypointList();
      });

      Wrap.appendChild(Input);
      Fields.appendChild(Wrap);
    });

    Details.appendChild(Fields);

    Row.appendChild(Header);
    Row.appendChild(Details);

    WaypointListDiv.appendChild(Row);
  });
}

function RenderAll() {
  RenderWaypointList();
  RefreshMarkers();
  UpdatePolyline();
  UpdateToolsUi();
  UpdateLeftPanelUi();
  UpdateRightPanelUi();
}

// ----- Nominatim search (OpenStreetMap geocoder) -----
// IMPORTANT:
// - This is a simple MVP that calls the public Nominatim endpoint.
// - Keep request volume low (debounce, no continuous typing queries).
// - For production, consider your own hosted geocoder or a provider with an API key.

let LastSearchTs = 0;

async function RunSearch() {
  const QueryText = (SearchInput.value || "").trim();
  if (!QueryText) {
    return;
  }

  // Very simple client-side throttle: at most 1 request per 1.2 seconds
  const NowTs = Date.now();
  if (NowTs - LastSearchTs < 1200) {
    return;
  }
  LastSearchTs = NowTs;

  SearchBtn.disabled = true;

  try {
    const UrlObj = new URL("https://nominatim.openstreetmap.org/search");
    UrlObj.searchParams.set("format", "jsonv2");
    UrlObj.searchParams.set("q", QueryText);
    UrlObj.searchParams.set("limit", "6");
    UrlObj.searchParams.set("addressdetails", "1");

    const Resp = await fetch(UrlObj.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!Resp.ok) {
      throw new Error("HTTP " + Resp.status);
    }

    const JsonObj = await Resp.json();
    ShowResults(JsonObj);
  } catch (ErrObj) {
    ClearResults();
  } finally {
    SearchBtn.disabled = false;
  }
}

// ----- Wire up events -----
SearchBtn.addEventListener("click", RunSearch);

SearchInput.addEventListener("keydown", (Ev) => {
  if (Ev.key === "Enter") {
    Ev.preventDefault();
    RunSearch();
  }
  if (Ev.key === "Escape") {
    ClearResults();
  }
});

// Drawing events: keep only one active shape and enable tools
MapObj.on(L.Draw.Event.CREATED, (Ev) => {
  DrawnItems.clearLayers();
  DrawnItems.addLayer(Ev.layer);
  StopActiveDrawing();
  BoundaryConfirmed = false;
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();
});

MapObj.on(L.Draw.Event.DELETED, () => {
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();
});
MapObj.on(L.Draw.Event.EDITED, () => {
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();
});
MapObj.on(L.Draw.Event.DRAWSTOP, () => {
  StopActiveDrawing();
  UpdateToolsUi();
});

// Shape tool buttons
if (GenerateFromShapeBtn) {
  GenerateFromShapeBtn.addEventListener("click", () => {
    GenerateWaypointsFromDrawnShape();
  });
}

if (ClearShapesBtn) {
  ClearShapesBtn.addEventListener("click", () => {
    const BoundaryFeature = LastBoundaryFeature || GetFirstDrawnFeature();
    if (!BoundaryFeature) return;
    RemoveWaypointsInsideBoundary(BoundaryFeature);
    RenderAll();
  });
}

if (ShapeSpacingInput) {
  ShapeSpacingInput.addEventListener("change", () => {
    UpdateToolsUi();
  });
}

if (ShapeResolutionSlider) {
  ShapeResolutionSlider.addEventListener("input", () => {
    UpdateResolutionDisplay();
    RegenerateWaypointsFromResolution();
    UpdateToolsUi();
  });
}

if (EllipseResolutionInput) {
  EllipseResolutionInput.addEventListener("change", () => {
    if (EllipseMode === "circumference") {
      GenerateWaypointsFromDrawnShape();
    }
  });
}

if (EllipseRotationInput) {
  EllipseRotationInput.addEventListener("change", () => {
    if (EllipseMode === "circumference") {
      GenerateWaypointsFromDrawnShape();
    }
  });
}

if (DrawLineBtn) {
  DrawLineBtn.addEventListener("click", () => {
    StartDrawing("polyline");
  });
}

if (DrawPolygonBtn) {
  DrawPolygonBtn.addEventListener("click", () => {
    StartDrawing("polygon");
  });
}

if (DrawEllipseBtn) {
  DrawEllipseBtn.addEventListener("click", () => {
    StartDrawing("ellipse");
  });
}

if (ConfirmShapeBtn) {
  ConfirmShapeBtn.addEventListener("click", () => {
    if (!HasBoundaryShape()) return;
    BoundaryConfirmed = true;
    DrawnItems.clearLayers(); // remove boundary overlay after confirming
    clearEllipseHandles();
    EllipseState = null;
    LastCoverageModel = null;
    LastBoundaryFeature = null;
    UpdateToolsUi();
  });
}

if (ApplyRotationBtn) {
  ApplyRotationBtn.addEventListener("click", () => {
    RotateSelectedWaypoints(RotationInput ? RotationInput.value : 0);
  });
}

if (RotationInput) {
  RotationInput.addEventListener("input", UpdateToolsUi);
  RotationInput.addEventListener("change", UpdateToolsUi);
}

// Click on map: clear search results and add a waypoint
MapObj.on("click", (Ev) => {
  ClearResults();
  if (ActiveDrawer || ActiveDrawMode === "ellipse") {
    // If currently drawing, try to finish polygon; do not add waypoint
    if (ActiveDrawMode !== "ellipse" && TryFinishPolygonOnFirstPoint(Ev)) {
      return;
    }
    return;
  }
  AddWaypoint(Ev.latlng.lat, Ev.latlng.lng);
});

// Toggle waypoint panel by clicking header
if (WaypointPanelHeader) {
  WaypointPanelHeader.style.cursor = "pointer";
  WaypointPanelHeader.addEventListener("click", () => {
    IsWaypointPanelOpen = !IsWaypointPanelOpen;
    RenderWaypointList();
  });
}

if (ToggleWaypointsBtn) {
  ToggleWaypointsBtn.addEventListener("click", () => {
    if (ActiveLeftPane === "waypoints" && LeftPanelOpen) {
      LeftPanelOpen = false;
    } else {
      ActiveLeftPane = "waypoints";
      LeftPanelOpen = true;
    }
    UpdateLeftPanelUi();
  });
}

if (ToggleSettingsBtn) {
  ToggleSettingsBtn.addEventListener("click", () => {
    if (ActiveLeftPane === "settings" && LeftPanelOpen) {
      LeftPanelOpen = false;
    } else {
      ActiveLeftPane = "settings";
      LeftPanelOpen = true;
    }
    UpdateLeftPanelUi();
  });
}

if (ToggleToolsBtn) {
  ToggleToolsBtn.addEventListener("click", () => {
    ToolsPanelOpen = !ToolsPanelOpen;
    UpdateRightPanelUi();
  });
}

// Ellipse mode toggle
if (EllipseModeBoundaryBtn && EllipseModeCircBtn) {
  EllipseModeBoundaryBtn.addEventListener("click", () => {
    EllipseMode = "boundary";
    UpdateToolsUi();
  });
  EllipseModeCircBtn.addEventListener("click", () => {
    EllipseMode = "circumference";
    UpdateToolsUi();
  });
}

// Settings: units
if (UnitRadios && UnitRadios.length) {
  UnitRadios.forEach((El) => {
    if (El.checked) {
      SettingsState.units = El.value;
    }
    El.addEventListener("change", (Ev) => {
      if (Ev.target.checked) {
        SettingsState.units = Ev.target.value;
        RenderWaypointList();
      }
    });
  });
}

// Settings: global altitude/speed
if (GlobalAltInput) {
  GlobalAltInput.value = SettingsState.globalAlt;
  GlobalAltInput.addEventListener("change", (Ev) => {
    const ValNum = parseFloat(Ev.target.value);
    if (Number.isFinite(ValNum)) {
      SettingsState.globalAlt = ValNum;
      Waypoints.forEach((Wp) => {
        if (Wp.UseGlobalAlt) {
          Wp.Alt = ValNum;
        }
      });
      RenderWaypointList();
    }
  });
}

if (GlobalSpeedInput) {
  GlobalSpeedInput.value = SettingsState.globalSpeed;
  GlobalSpeedInput.addEventListener("change", (Ev) => {
    const ValNum = parseFloat(Ev.target.value);
    if (Number.isFinite(ValNum)) {
      SettingsState.globalSpeed = ValNum;
      Waypoints.forEach((Wp) => {
        if (Wp.UseGlobalSpeed) {
          Wp.Speed = ValNum;
        }
      });
      RenderWaypointList();
    }
  });
}

// Initial render for empty state
UpdateResolutionDisplay();
RenderAll();



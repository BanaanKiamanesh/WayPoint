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

// Marker for search result
let SearchMarker = null;

// ----- UI elements -----
const SearchInput = document.getElementById("SearchInput");
const SearchBtn = document.getElementById("SearchBtn");
const ResultsDiv = document.getElementById("Results");
const WaypointSidebar = document.getElementById("WaypointSidebar");
const SettingsPanelLeft = document.getElementById("SettingsPanelLeft");
const WaypointListDiv = document.getElementById("WaypointList");
const WaypointPanelHeader = document.getElementById("WaypointPanelHeader");
const UnitRadios = document.querySelectorAll('input[name="Units"]');
const GlobalAltInput = document.getElementById("GlobalAltInput");
const GlobalSpeedInput = document.getElementById("GlobalSpeedInput");
const ShapeSpacingInput = document.getElementById("ShapeSpacingInput");
const GenerateFromShapeBtn = document.getElementById("GenerateFromShapeBtn");
const ClearShapesBtn = document.getElementById("ClearShapesBtn");
const RotationInput = document.getElementById("RotationInput");
const ApplyRotationBtn = document.getElementById("ApplyRotationBtn");
const LeftControlsWrap = document.getElementById("LeftControls");
const ToggleWaypointsBtn = document.getElementById("ToggleWaypointsBtn");
const ToggleSettingsBtn = document.getElementById("ToggleSettingsBtn");
const RightControlsWrap = document.getElementById("RightControls");
const ToggleToolsBtn = document.getElementById("ToggleToolsBtn");
const DrawLineBtn = document.getElementById("DrawLineBtn");
const DrawPolygonBtn = document.getElementById("DrawPolygonBtn");

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
const WaypointLine = L.polyline([], {
  color: "#4db3ff",
  weight: 3,
  opacity: 0.85,
});
WaypointLine.addTo(MapObj);

const DEFAULT_ALT = 50;
const DEFAULT_SPEED = 8;
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
}

function StartDrawing(Mode) {
  StopActiveDrawing();

  if (Mode === "polyline") {
    ActiveDrawer = new L.Draw.Polyline(MapObj, DrawOptions.polyline);
  } else if (Mode === "polygon") {
    ActiveDrawer = new L.Draw.Polygon(MapObj, DrawOptions.polygon);
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

// ----- Coverage planning utilities (ported to JS) -----
const SweepDirection = {
  UP: 1,
  DOWN: -1,
};

const MovingDirection = {
  RIGHT: 1,
  LEFT: -1,
};

function rotMat2d(th) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [
    [c, -s],
    [s, c],
  ];
}

function applyRot(mat, x, y) {
  return [mat[0][0] * x + mat[0][1] * y, mat[1][0] * x + mat[1][1] * y];
}

class GridMap {
  constructor(width, height, resolution, centerX, centerY, polygonMercator) {
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.centerX = centerX;
    this.centerY = centerY;
    this.data = Array.from({ length: height }, () => new Float32Array(width));
    this.polygon = polygonMercator;
    this.setPolygonFreeArea();
  }

  worldToIndex(x, y) {
    const ix = Math.round((x - this.centerX) / this.resolution + this.width / 2);
    const iy = Math.round((y - this.centerY) / this.resolution + this.height / 2);
    return [ix, iy];
  }

  indexToWorld(ix, iy) {
    const x = (ix - this.width / 2) * this.resolution + this.centerX;
    const y = (iy - this.height / 2) * this.resolution + this.centerY;
    return [x, y];
  }

  checkOccupied(ix, iy, occupiedVal = 0.5) {
    ix = Math.trunc(ix);
    iy = Math.trunc(iy);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return true;
    return this.data[iy][ix] >= occupiedVal;
  }

  setValue(ix, iy, val) {
    ix = Math.trunc(ix);
    iy = Math.trunc(iy);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return false;
    this.data[iy][ix] = val;
    return true;
  }

  setPolygonFreeArea() {
    const poly =
      this.polygon && this.polygon.type === "Feature"
        ? this.polygon
        : {
            type: "Feature",
            geometry: this.polygon,
            properties: {},
          };
    if (!poly) return;
    for (let iy = 0; iy < this.height; iy++) {
      for (let ix = 0; ix < this.width; ix++) {
        const [x, y] = this.indexToWorld(ix, iy);
        const inside = turf.booleanPointInPolygon([x, y], poly);
        if (!inside) {
          this.data[iy][ix] = 1;
        }
      }
    }
  }
}

function searchFreeGridIndexAtEdgeY(gridMap, fromUpper = false) {
  const yRange = fromUpper
    ? [...Array(gridMap.height).keys()].reverse()
    : [...Array(gridMap.height).keys()];
  const xRange = fromUpper
    ? [...Array(gridMap.width).keys()].reverse()
    : [...Array(gridMap.width).keys()];

  let yIndex = null;
  const xIndexes = [];

  for (const iy of yRange) {
    for (const ix of xRange) {
      if (!gridMap.checkOccupied(ix, iy)) {
        yIndex = iy;
        xIndexes.push(ix);
      }
    }
    if (yIndex !== null) break;
  }

  return [xIndexes, yIndex];
}

function findSweepDirectionAndStartPosition(ox, oy) {
  let maxDist = 0;
  let vec = [0, 0];
  let sweepStart = [0, 0];
  for (let i = 0; i < ox.length - 1; i++) {
    const dx = ox[i + 1] - ox[i];
    const dy = oy[i + 1] - oy[i];
    const d = Math.hypot(dx, dy);
    if (d > maxDist) {
      maxDist = d;
      vec = [dx, dy];
      sweepStart = [ox[i], oy[i]];
    }
  }
  return { vec, sweepStart };
}

function convertGridCoordinate(ox, oy, sweepVec, sweepStart) {
  const tx = ox.map((v) => v - sweepStart[0]);
  const ty = oy.map((v) => v - sweepStart[1]);
  const th = Math.atan2(sweepVec[1], sweepVec[0]);
  const rot = rotMat2d(th);
  const rx = [];
  const ry = [];
  for (let i = 0; i < tx.length; i++) {
    const [nx, ny] = applyRot(rot, tx[i], ty[i]);
    rx.push(nx);
    ry.push(ny);
  }
  return [rx, ry];
}

function convertGlobalCoordinate(x, y, sweepVec, sweepStart) {
  const th = Math.atan2(sweepVec[1], sweepVec[0]);
  const rot = rotMat2d(-th);
  const rx = [];
  const ry = [];
  for (let i = 0; i < x.length; i++) {
    const [nx, ny] = applyRot(rot, x[i], y[i]);
    rx.push(nx + sweepStart[0]);
    ry.push(ny + sweepStart[1]);
  }
  return [rx, ry];
}

function setupGridMap(ox, oy, resolution, sweepDirection) {
  const width = Math.ceil((Math.max(...ox) - Math.min(...ox)) / resolution) + 10;
  const height = Math.ceil((Math.max(...oy) - Math.min(...oy)) / resolution) + 10;
  const centerX = (Math.max(...ox) + Math.min(...ox)) / 2;
  const centerY = (Math.max(...oy) + Math.min(...oy)) / 2;

  const polygonMercator = {
    type: "Polygon",
    coordinates: [ox.map((v, i) => [v, oy[i]])],
  };

  const gridMap = new GridMap(width, height, resolution, centerX, centerY, polygonMercator);

  let xGoal, goalY;
  if (sweepDirection === SweepDirection.UP) {
    [xGoal, goalY] = searchFreeGridIndexAtEdgeY(gridMap, true);
  } else {
    [xGoal, goalY] = searchFreeGridIndexAtEdgeY(gridMap, false);
  }

  return { gridMap, xGoal, goalY };
}

function sweepPathSearch(sweeper, gridMap) {
  let [cx, cy] = sweeper.searchStartGrid(gridMap);
  if (!gridMap.setValue(cx, cy, 0.5)) {
    return [[], []];
  }

  let [x, y] = gridMap.indexToWorld(cx, cy);
  const px = [x];
  const py = [y];

  while (true) {
    [cx, cy] = sweeper.moveTargetGrid(cx, cy, gridMap);
    if (sweeper.isSearchDone(gridMap) || cx === null || cy === null) break;
    [x, y] = gridMap.indexToWorld(cx, cy);
    px.push(x);
    py.push(y);
    gridMap.setValue(cx, cy, 0.5);
  }

  return [px, py];
}

class SweepSearcher {
  constructor(movingDirection, sweepDirection, xGoal, goalY) {
    this.movingDirection = movingDirection;
    this.sweepDirection = sweepDirection;
    this.updateTurningWindow();
    this.xGoal = xGoal;
    this.goalY = goalY;
  }

  updateTurningWindow() {
    this.turningWindow = [
      [this.movingDirection, 0],
      [this.movingDirection, this.sweepDirection],
      [0, this.sweepDirection],
      [-this.movingDirection, this.sweepDirection],
    ];
  }

  swapMovingDirection() {
    this.movingDirection *= -1;
    this.updateTurningWindow();
  }

  checkOccupied(ix, iy, gridMap, occupiedVal = 0.5) {
    return gridMap.checkOccupied(ix, iy, occupiedVal);
  }

  findSafeTurningGrid(cx, cy, gridMap) {
    for (const [dx, dy] of this.turningWindow) {
      const nx = dx + cx;
      const ny = dy + cy;
      if (!this.checkOccupied(nx, ny, gridMap)) return [nx, ny];
    }
    return [null, null];
  }

  isSearchDone(gridMap) {
    for (const ix of this.xGoal) {
      if (!this.checkOccupied(ix, this.goalY, gridMap)) return false;
    }
    return true;
  }

  searchStartGrid(gridMap) {
    const [xInds, yInd] = searchFreeGridIndexAtEdgeY(
      gridMap,
      this.sweepDirection === SweepDirection.DOWN
    );
    if (this.movingDirection === MovingDirection.RIGHT) {
      return [Math.min(...xInds), yInd];
    }
    return [Math.max(...xInds), yInd];
  }

  moveTargetGrid(cx, cy, gridMap) {
    let nx = this.movingDirection + cx;
    let ny = cy;
    if (!this.checkOccupied(nx, ny, gridMap)) {
      return [nx, ny];
    }
    // need to turn
    let [tx, ty] = this.findSafeTurningGrid(cx, cy, gridMap);
    if (tx === null && ty === null) {
      nx = -this.movingDirection + cx;
      ny = cy;
      if (this.checkOccupied(nx, ny, gridMap, 1.0)) {
        return [null, null];
      }
      return [nx, ny];
    }
    while (!this.checkOccupied(tx + this.movingDirection, ty, gridMap)) {
      tx += this.movingDirection;
    }
    this.swapMovingDirection();
    return [tx, ty];
  }
}

function coveragePlanningMeters(polygonFeature, resolutionMeters) {
  if (!polygonFeature) return [];
  const mercator = turf.toMercator(polygonFeature);
  const coords =
    mercator.geometry.type === "Polygon"
      ? mercator.geometry.coordinates[0]
      : mercator.geometry.coordinates[0][0];

  if (
    coords.length &&
    (coords[0][0] !== coords[coords.length - 1][0] ||
      coords[0][1] !== coords[coords.length - 1][1])
  ) {
    coords.push([...coords[0]]);
  }

  const ox = coords.map((c) => c[0]);
  const oy = coords.map((c) => c[1]);

  const { vec: sweepVec, sweepStart } = findSweepDirectionAndStartPosition(ox, oy);
  const [rox, roy] = convertGridCoordinate(ox, oy, sweepVec, sweepStart);
  const { gridMap, xGoal, goalY } = setupGridMap(
    rox,
    roy,
    resolutionMeters,
    SweepDirection.UP
  );
  const sweeper = new SweepSearcher(MovingDirection.RIGHT, SweepDirection.UP, xGoal, goalY);
  const [px, py] = sweepPathSearch(sweeper, gridMap);
  const [rx, ry] = convertGlobalCoordinate(px, py, sweepVec, sweepStart);

  const latLngs = [];
  for (let i = 0; i < rx.length; i++) {
    const [lon, lat] = turf.toWgs84([rx[i], ry[i]]);
    latLngs.push([lat, lon]);
  }
  return latLngs;
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

function GetSpacingMeters() {
  if (!ShapeSpacingInput) return null;
  const ValNum = parseFloat(ShapeSpacingInput.value);
  if (!Number.isFinite(ValNum) || ValNum <= 0) return null;
  return ValNum;
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

function GenerateWaypointCoordsFromShape(Feature, SpacingMeters) {
  if (typeof turf === "undefined") return [];
  const boundary = normalizeBoundaryFeature(Feature, SpacingMeters);
  if (!boundary) return [];
  const pathLatLngs = coveragePlanningMeters(boundary, SpacingMeters);
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

  const Points = GenerateWaypointCoordsFromShape(ShapeFeature, SpacingMeters);
  if (!Points.length) return;

  SelectedIds.clear();
  Points.forEach((Coord) => {
    AddWaypoint(Coord[1], Coord[0], { selectionMode: "add", skipRender: true });
  });

  RenderAll();
  DrawnItems.clearLayers();
  UpdateToolsUi();
}

function UpdateToolsUi() {
  const HasShape = DrawnItems && DrawnItems.getLayers().length > 0;
  const SpacingValid = GetSpacingMeters() !== null;
  const HasRotationSelection = SelectedIds.size >= 2;
  const AngleValid =
    RotationInput && Number.isFinite(parseFloat(RotationInput.value));
  const IsDrawingLine = ActiveDrawMode === "polyline";
  const IsDrawingPoly = ActiveDrawMode === "polygon";

  if (GenerateFromShapeBtn) {
    GenerateFromShapeBtn.disabled = !HasShape || !SpacingValid;
  }
  if (ClearShapesBtn) {
    ClearShapesBtn.disabled = !HasShape;
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
  UpdateToolsUi();
});

MapObj.on(L.Draw.Event.DELETED, () => {
  UpdateToolsUi();
});
MapObj.on(L.Draw.Event.EDITED, () => {
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
    DrawnItems.clearLayers();
    UpdateToolsUi();
  });
}

if (ShapeSpacingInput) {
  ShapeSpacingInput.addEventListener("change", () => {
    UpdateToolsUi();
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
  if (ActiveDrawer) {
    // If currently drawing, try to finish polygon; do not add waypoint
    if (TryFinishPolygonOnFirstPoint(Ev)) {
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
RenderAll();

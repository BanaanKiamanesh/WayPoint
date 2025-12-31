// ----- Map setup -----
const MapObj = L.map("map", {
  zoomControl: false, // We'll add it manually at bottom left
  boxZoom: false, // Reserve shift-drag for waypoint selection
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
const SatelliteTiles = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }
);

let ActiveBaseLayer = SatelliteTiles;
ActiveBaseLayer.addTo(MapObj);

let MapModeBtnMap = null;
let MapModeBtnSat = null;

function setBaseLayer(mode) {
  const useSatellite = mode === "satellite";
  const nextLayer = useSatellite ? SatelliteTiles : OsmTiles;
  if (ActiveBaseLayer !== nextLayer) {
    if (ActiveBaseLayer) {
      MapObj.removeLayer(ActiveBaseLayer);
    }
    ActiveBaseLayer = nextLayer;
    ActiveBaseLayer.addTo(MapObj);
  }
  if (MapModeBtnMap && MapModeBtnSat) {
    MapModeBtnMap.classList.toggle("active", !useSatellite);
    MapModeBtnSat.classList.toggle("active", useSatellite);
    MapModeBtnMap.setAttribute("aria-pressed", useSatellite ? "false" : "true");
    MapModeBtnSat.setAttribute("aria-pressed", useSatellite ? "true" : "false");
  }
}

function FitMapToWindow() {
  if (!MapObj) return;
  let bounds = null;
  if (Waypoints && Waypoints.length) {
    bounds = L.latLngBounds(Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]));
  }
  if (
    (!bounds || !bounds.isValid || !bounds.isValid()) &&
    DrawnItems &&
    DrawnItems.getLayers().length
  ) {
    bounds = DrawnItems.getBounds();
  }
  if ((!bounds || !bounds.isValid || !bounds.isValid()) && SearchMarker) {
    const ll = SearchMarker.getLatLng();
    bounds = L.latLngBounds([ll, ll]);
  }
  if (bounds && bounds.isValid && bounds.isValid()) {
    MapObj.fitBounds(bounds.pad(0.15));
  } else {
    MapObj.fitWorld();
  }
  MapObj.invalidateSize();
}

const MapModeControl = L.control({ position: "bottomleft" });
MapModeControl.onAdd = () => {
  const Wrap = L.DomUtil.create("div", "mapModeControl");
  const MapBtn = L.DomUtil.create("button", "mapModeButton active", Wrap);
  MapBtn.type = "button";
  MapBtn.textContent = "Map";
  MapBtn.setAttribute("aria-pressed", "true");

  const SatBtn = L.DomUtil.create("button", "mapModeButton", Wrap);
  SatBtn.type = "button";
  SatBtn.textContent = "Satellite";
  SatBtn.setAttribute("aria-pressed", "false");

  MapModeBtnMap = MapBtn;
  MapModeBtnSat = SatBtn;

  setBaseLayer("satellite");

  L.DomEvent.on(MapBtn, "click", (Ev) => {
    L.DomEvent.stop(Ev);
    setBaseLayer("map");
  });
  L.DomEvent.on(SatBtn, "click", (Ev) => {
    L.DomEvent.stop(Ev);
    setBaseLayer("satellite");
  });

  L.DomEvent.disableClickPropagation(Wrap);
  L.DomEvent.disableScrollPropagation(Wrap);
  return Wrap;
};
MapModeControl.addTo(MapObj);

const AttributionToggleControl = L.control({ position: "bottomright" });
AttributionToggleControl.onAdd = () => {
  const Wrap = L.DomUtil.create("div", "attribToggleControl");
  const Btn = L.DomUtil.create("button", "attribToggleButton", Wrap);
  Btn.type = "button";
  Btn.title = "Map attribution";
  Btn.setAttribute("aria-label", "Map attribution");
  Btn.setAttribute("aria-pressed", "false");
  Btn.textContent = "i";

  L.DomEvent.on(Btn, "click", (Ev) => {
    L.DomEvent.stop(Ev);
    const MapEl = MapObj.getContainer();
    const IsOpen = MapEl.classList.toggle("showAttribution");
    Btn.setAttribute("aria-pressed", IsOpen ? "true" : "false");
  });

  L.DomEvent.disableClickPropagation(Wrap);
  L.DomEvent.disableScrollPropagation(Wrap);
  return Wrap;
};
AttributionToggleControl.addTo(MapObj);

const HomeControl = L.control({ position: "bottomleft" });
HomeControl.onAdd = () => {
  const Wrap = L.DomUtil.create("div", "homeControl");
  const Btn = L.DomUtil.create("button", "homeButton", Wrap);
  Btn.type = "button";
  Btn.title = "Fit map";
  Btn.setAttribute("aria-label", "Fit map");
  Btn.innerHTML =
    '<svg class="homeButtonIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 4.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5z" />' +
    "</svg>";

  L.DomEvent.on(Btn, "click", (Ev) => {
    L.DomEvent.stop(Ev);
    FitMapToWindow();
  });

  L.DomEvent.disableClickPropagation(Wrap);
  L.DomEvent.disableScrollPropagation(Wrap);
  return Wrap;
};
HomeControl.addTo(MapObj);

// Add zoom control at bottom left
L.control
  .zoom({
    position: "bottomleft",
  })
  .addTo(MapObj);

// Feature group to hold drawn shapes (lines/polygons)
const DrawnItems = L.featureGroup();
DrawnItems.addTo(MapObj);

const DrawVertexIcon = L.divIcon({
  className: "drawVertexIcon",
  html: '<div class="drawVertexDot"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});
const DrawVertexTouchIcon = L.divIcon({
  className: "drawVertexIcon drawVertexIcon--touch",
  html: '<div class="drawVertexDot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const DrawOptions = {
  polyline: {
    shapeOptions: {
      color: "#ffb347",
      weight: 3,
    },
    icon: DrawVertexIcon,
    touchIcon: DrawVertexTouchIcon,
  },
  polygon: {
    allowIntersection: true,
    showArea: false,
    shapeOptions: {
      color: "#ffd166",
      weight: 2.5,
    },
    icon: DrawVertexIcon,
    touchIcon: DrawVertexTouchIcon,
  },
};

let ActiveDrawer = null;
let ActiveDrawMode = null;
let ActiveDrawTool = null;
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
const ClearAllWaypointsBtn = document.getElementById("ClearAllWaypointsBtn");
const UnitRadios = document.querySelectorAll('input[name="Units"]');
const GlobalAltInput = document.getElementById("GlobalAltInput");
const GlobalSpeedInput = document.getElementById("GlobalSpeedInput");
const ShowAltLabelsToggle = document.getElementById("ShowAltLabelsToggle");
const ShapeSpacingInput = document.getElementById("ShapeSpacingInput");
const ShapeResolutionSlider = document.getElementById("ShapeResolutionSlider");
const ShapeResolutionValue = document.getElementById("ShapeResolutionValue");
const ShapeResolutionRow = document.getElementById("ShapeResolutionRow");
const ShapeOrientationRow = document.getElementById("ShapeOrientationRow");
const ShapeOrientationSelect = document.getElementById("ShapeOrientationSelect");
const GenerateFromShapeBtn = document.getElementById("GenerateFromShapeBtn");
const ClearShapesBtn = document.getElementById("ClearShapesBtn");
const RotationInput = document.getElementById("RotationInput");
const ApplyRotationBtn = document.getElementById("ApplyRotationBtn");
const BatchAltInput = document.getElementById("BatchAltInput");
const BatchSpeedInput = document.getElementById("BatchSpeedInput");
const BatchHeadingInput = document.getElementById("BatchHeadingInput");
const BatchGimbalInput = document.getElementById("BatchGimbalInput");
const BatchGimbalRollInput = document.getElementById("BatchGimbalRollInput");
const BatchHoverInput = document.getElementById("BatchHoverInput");
const BatchCameraActionSelect = document.getElementById("BatchCameraActionSelect");
const BatchZoomInput = document.getElementById("BatchZoomInput");
const ApplyBatchEditBtn = document.getElementById("ApplyBatchEditBtn");
const ClearBatchEditBtn = document.getElementById("ClearBatchEditBtn");
const NudgeStepInput = document.getElementById("NudgeStepInput");
const NudgeNorthBtn = document.getElementById("NudgeNorthBtn");
const NudgeSouthBtn = document.getElementById("NudgeSouthBtn");
const NudgeWestBtn = document.getElementById("NudgeWestBtn");
const NudgeEastBtn = document.getElementById("NudgeEastBtn");
const OffsetDistanceInput = document.getElementById("OffsetDistanceInput");
const OffsetBearingInput = document.getElementById("OffsetBearingInput");
const ApplyOffsetBtn = document.getElementById("ApplyOffsetBtn");
const ReverseWaypointsBtn = document.getElementById("ReverseWaypointsBtn");
const ConfirmShapeBtn = document.getElementById("ConfirmShapeBtn");
const LeftControlsWrap = document.getElementById("LeftControls");
const ToggleWaypointsBtn = document.getElementById("ToggleWaypointsBtn");
const ToggleSettingsBtn = document.getElementById("ToggleSettingsBtn");
const RightControlsWrap = document.getElementById("RightControls");
const ToggleToolsBtn = document.getElementById("ToggleToolsBtn");
const ToggleManipulateBtn = document.getElementById("ToggleManipulateBtn");
const DrawLineBtn = document.getElementById("DrawLineBtn");
const DrawPolygonBtn = document.getElementById("DrawPolygonBtn");
const DrawEllipseBtn = document.getElementById("DrawEllipseBtn");
const DrawOptionsPanel = document.getElementById("DrawOptionsPanel");
const DrawOptionsTitle = document.getElementById("DrawOptionsTitle");
const DrawOptionsHint = document.getElementById("DrawOptionsHint");
const EllipseOptionsSection = document.getElementById("EllipseOptionsSection");
const EllipseModeBoundaryBtn = document.getElementById("EllipseModeBoundaryBtn");
const EllipseModeCircBtn = document.getElementById("EllipseModeCircBtn");
const EllipseOrientationRow = document.getElementById("EllipseOrientationRow");
const EllipseOrientationSelect = document.getElementById("EllipseOrientationSelect");
const EllipseResolutionInput = document.getElementById("EllipseResolutionInput");
const EllipseRotationInput = document.getElementById("EllipseRotationInput");
const ExportDockBtn = document.getElementById("ExportDockBtn");
const ExportFormatSelect = document.getElementById("ExportFormatSelect");
const ExportPathModeSelect = document.getElementById("ExportPathModeSelect");
const ExportNowBtn = document.getElementById("ExportNowBtn");
const ImportFileBtn = document.getElementById("ImportFileBtn");
const ImportFileInput = document.getElementById("ImportFileInput");
const DropOverlay = document.getElementById("DropOverlay");

// ----- Waypoint state -----
const Waypoints = [];
const SelectedIds = new Set();
const ExpandedIds = new Set();
let IsWaypointPanelOpen = true;
let LeftPanelOpen = false;
let ActiveLeftPane = "waypoints";
let ToolsPanelOpen = false;
let ManipulatePanelOpen = false;
let ExportPanelOpen = false;
let NextWaypointId = 1;
const MarkerById = new Map();
let LastRotationSnapshot = null; // Reserved for future undo/redo of transforms
let LastCoverageModel = null; // stores resolution model for current boundary/path
let LastBoundaryFeature = null; // normalized boundary in WGS84 for replacement/removal
let EllipseState = null;
let EllipseMode = "boundary"; // boundary | circumference
let PolygonOrientation = "auto";
let EllipseBoundaryOrientation = "auto";
let PathDisplayMode = "straight"; // straight | curved
const WaypointLine = L.polyline([], {
  color: "#4db3ff",
  weight: 3,
  opacity: 0.85,
});
WaypointLine.addTo(MapObj);

const DEFAULT_ALT = 50;
const DEFAULT_SPEED = 10;
const DEFAULT_HEADING = 0;
const DEFAULT_GIMBAL = -45;
const SettingsState = {
  units: "metric",
  globalAlt: DEFAULT_ALT,
  globalSpeed: DEFAULT_SPEED,
  showAltitudeLabels: true,
};
const METERS_PER_FOOT = 0.3048;
const ELLIPSE_STYLE = {
  color: "#9b5de5",
  weight: 2,
  fillOpacity: 0.1,
  smoothFactor: 0,
  lineJoin: "round",
  lineCap: "round",
};

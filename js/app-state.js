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
const ClearAllWaypointsBtn = document.getElementById("ClearAllWaypointsBtn");
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
const EllipseModeBoundaryBtn = document.getElementById("EllipseModeBoundaryBtn");
const EllipseModeCircBtn = document.getElementById("EllipseModeCircBtn");
const EllipseResolutionInput = document.getElementById("EllipseResolutionInput");
const EllipseRotationInput = document.getElementById("EllipseRotationInput");
const ExportDockBtn = document.getElementById("ExportDockBtn");
const ExportFormatSelect = document.getElementById("ExportFormatSelect");
const ExportNowBtn = document.getElementById("ExportNowBtn");
const ImportFileBtn = document.getElementById("ImportFileBtn");
const ImportFileInput = document.getElementById("ImportFileInput");

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
const METERS_PER_FOOT = 0.3048;
const ELLIPSE_STYLE = { color: "#9b5de5", weight: 2, fillOpacity: 0.1 };

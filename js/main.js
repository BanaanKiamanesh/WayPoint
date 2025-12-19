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

// Marker for search result
let SearchMarker = null;

// ----- UI elements -----
const SearchInput = document.getElementById("SearchInput");
const SearchBtn = document.getElementById("SearchBtn");
const ResultsDiv = document.getElementById("Results");
const WaypointSidebar = document.getElementById("WaypointSidebar");
const WaypointListDiv = document.getElementById("WaypointList");
const WaypointPanelHeader = document.getElementById("WaypointPanelHeader");
const UnitRadios = document.querySelectorAll('input[name="Units"]');
const GlobalAltInput = document.getElementById("GlobalAltInput");
const GlobalSpeedInput = document.getElementById("GlobalSpeedInput");

// ----- Waypoint state -----
const Waypoints = [];
const SelectedIds = new Set();
const ExpandedIds = new Set();
let IsWaypointPanelOpen = true;
let NextWaypointId = 1;
const MarkerById = new Map();
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

function AddWaypoint(LatNum, LonNum) {
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
  SelectedIds.clear();
  SelectedIds.add(NewWp.Id);
  RenderAll();
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

// Click on map: clear search results and add a waypoint
MapObj.on("click", (Ev) => {
  ClearResults();
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

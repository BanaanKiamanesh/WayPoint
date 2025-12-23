function SnapshotSelectedWaypoints() {
  return Waypoints.filter((Wp) => SelectedIds.has(Wp.Id)).map((Wp) => ({
    Id: Wp.Id,
    Lat: Wp.Lat,
    Lon: Wp.Lon,
  }));
}

function MarkerIcon(Label, IsSelected, HeadingDeg) {
  const HeadingNum = parseFloat(HeadingDeg);
  const Heading = Number.isFinite(HeadingNum) ? HeadingNum : 0;
  return L.divIcon({
    className: "wpMarker" + (IsSelected ? " selected" : ""),
    html:
      '<div class="wpMarkerDrop" style="--heading:' +
      Heading +
      'deg">' +
      '<svg class="wpMarkerSvg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<path class="wpMarkerShape" d="M50 0 C72 12 90 32 90 56 C90 80 72 98 50 100 C28 98 10 80 10 56 C10 32 28 12 50 0 Z"></path>' +
      "</svg>" +
      '<div class="wpMarkerLabel">' +
      Label +
      "</div>" +
      "</div>",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function UpdatePolyline() {
  const LatLngs = Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  WaypointLine.setLatLngs(LatLngs);
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

function RefreshMarkers() {
  const Seen = new Set();
  Waypoints.forEach((Wp, Idx) => {
    const IsSelected = SelectedIds.has(Wp.Id);
    let Marker = MarkerById.get(Wp.Id);
    const Icon = MarkerIcon(Idx + 1, IsSelected, Wp.Heading);

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
        PushHistory();
      });

      Marker.on("drag", (Ev) => {
        Wp.Lat = Ev.latlng.lat;
        Wp.Lon = Ev.latlng.lng;
        UpdatePolyline();
        RenderWaypointList();
      });
      Marker.on("dragend", () => {
        PushHistory();
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
  if (!Opts.skipHistory) {
    PushHistory();
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
  PushHistory();
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
      PushHistory();
    });

    const Details = document.createElement("div");
    Details.className = "wpDetails";
    Details.style.display = IsExpanded ? "block" : "none";

    const Coords = document.createElement("div");
    Coords.className = "wpCoordsRow";
    Coords.textContent = "Lat " + FormatCoord(Wp.Lat) + " | Lon " + FormatCoord(Wp.Lon);
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
          PushHistory();
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
        if (Field.key === "Heading") {
          RefreshMarkers();
        }
        PushHistory();
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

function SnapshotSelectedWaypoints() {
  return Waypoints.filter((Wp) => SelectedIds.has(Wp.Id)).map((Wp) => ({
    Id: Wp.Id,
    Lat: Wp.Lat,
    Lon: Wp.Lon,
  }));
}

let DragSelectionState = null;
const PASTE_OFFSET_METERS = 5;
let CopiedWaypoints = null;
let PasteOffsetIndex = 0;

function offsetLatLngMeters(lat, lon, offsetMeters) {
  if (typeof turf !== "undefined" && turf.toMercator && turf.toWgs84) {
    const merc = turf.toMercator([lon, lat]);
    const wgs = turf.toWgs84([merc[0] + offsetMeters, merc[1] + offsetMeters]);
    return { lat: wgs[1], lon: wgs[0] };
  }
  const latRad = (lat * Math.PI) / 180;
  const deltaLat = offsetMeters / 111320;
  const cosLat = Math.cos(latRad);
  const deltaLon = Math.abs(cosLat) > 1e-6 ? offsetMeters / (111320 * cosLat) : 0;
  return { lat: lat + deltaLat, lon: lon + deltaLon };
}

function CopySelectedWaypoints() {
  const SelectedList = Waypoints.filter((Wp) => SelectedIds.has(Wp.Id));
  if (!SelectedList.length) return;
  CopiedWaypoints = SelectedList.map((Wp) => ({
    Lat: Wp.Lat,
    Lon: Wp.Lon,
    Alt: Wp.Alt,
    Speed: Wp.Speed,
    Heading: Wp.Heading,
    Gimbal: Wp.Gimbal,
    UseGlobalAlt: Boolean(Wp.UseGlobalAlt),
    UseGlobalSpeed: Boolean(Wp.UseGlobalSpeed),
  }));
  PasteOffsetIndex = 0;
}

function PasteCopiedWaypoints() {
  if (!CopiedWaypoints || !CopiedWaypoints.length) return;
  const offsetMeters = PASTE_OFFSET_METERS * (PasteOffsetIndex + 1);
  PasteOffsetIndex += 1;

  SelectedIds.clear();
  CopiedWaypoints.forEach((Item) => {
    const shifted = offsetLatLngMeters(Item.Lat, Item.Lon, offsetMeters);
    const wp = AddWaypoint(shifted.lat, shifted.lon, {
      selectionMode: "add",
      skipRender: true,
      skipHistory: true,
    });
    wp.UseGlobalAlt = Item.UseGlobalAlt;
    wp.UseGlobalSpeed = Item.UseGlobalSpeed;
    wp.Alt = wp.UseGlobalAlt ? SettingsState.globalAlt : Item.Alt;
    wp.Speed = wp.UseGlobalSpeed ? SettingsState.globalSpeed : Item.Speed;
    wp.Heading = Item.Heading;
    wp.Gimbal = Item.Gimbal;
  });
  RenderAll();
  PushHistory();
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
  const LatLngs = getDisplayPathLatLngs();
  WaypointLine.setLatLngs(LatLngs);
}

const CURVE_SAMPLE_SPACING_M = 25;
const CURVE_SAMPLE_MIN_STEPS = 6;
const CURVE_SAMPLE_MAX_STEPS = 60;
const CURVE_HANDLE_SCALE = 3.0;
const CURVE_HANDLE_MAX_RATIO = 0.7;

function getDisplayPathLatLngs() {
  if (!Waypoints.length) return [];
  if (PathDisplayMode !== "curved" || Waypoints.length < 3) {
    return Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  }
  if (typeof turf === "undefined" || !turf.toMercator || !turf.toWgs84) {
    return Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  }
  return buildCurvedPathLatLngs();
}

function cubicBezier(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  return mt3 * a + 3 * mt2 * t * b + 3 * mt * t2 * c + t3 * d;
}

function clampHandle(vec, maxLen) {
  const len = Math.hypot(vec[0], vec[1]);
  if (!Number.isFinite(len) || len <= 0 || len <= maxLen) return vec;
  const scale = maxLen / len;
  return [vec[0] * scale, vec[1] * scale];
}

function buildBezierControls(p0, p1, p2, p3) {
  const k = CURVE_HANDLE_SCALE / 6;
  const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const maxHandle = Number.isFinite(segLen) ? segLen * CURVE_HANDLE_MAX_RATIO : 0;
  let v1 = [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k];
  let v2 = [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];

  if (maxHandle > 0) {
    v1 = clampHandle(v1, maxHandle);
    v2 = clampHandle(v2, maxHandle);
  }

  return {
    c1: [p1[0] + v1[0], p1[1] + v1[1]],
    c2: [p2[0] - v2[0], p2[1] - v2[1]],
    segLen: segLen,
  };
}

function buildCurvedPathLatLngs() {
  const pts = Waypoints.map((Wp) => turf.toMercator([Wp.Lon, Wp.Lat]));
  const out = [];

  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || pts[i + 1];
    const controls = buildBezierControls(p0, p1, p2, p3);
    const segLen = controls.segLen;
    const rawSteps = Number.isFinite(segLen)
      ? Math.round(segLen / CURVE_SAMPLE_SPACING_M)
      : CURVE_SAMPLE_MIN_STEPS;
    const steps = Math.min(
      CURVE_SAMPLE_MAX_STEPS,
      Math.max(CURVE_SAMPLE_MIN_STEPS, rawSteps)
    );

    for (let s = 0; s <= steps; s += 1) {
      if (i > 0 && s === 0) continue;
      const t = steps === 0 ? 0 : s / steps;
      const x = cubicBezier(p1[0], controls.c1[0], controls.c2[0], p2[0], t);
      const y = cubicBezier(p1[1], controls.c1[1], controls.c2[1], p2[1], t);
      const ll = turf.toWgs84([x, y]);
      out.push([ll[1], ll[0]]);
    }
  }

  return out;
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
  const totalSec = Math.round(sec);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (hours > 0) parts.push(hours + "h");
  if (hours > 0 || minutes > 0) parts.push(minutes + "m");
  parts.push(seconds + "s");
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
  if (!turf) return 0;
  const path = getDisplayPathLatLngs();
  if (path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    total += turf.distance([a[1], a[0]], [b[1], b[0]], { units: "kilometers" }) * 1000;
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

      Marker.on("click", (Ev) => {
        const OrigEv = Ev && Ev.originalEvent;
        const IsMulti =
          OrigEv && (OrigEv.shiftKey || OrigEv.ctrlKey || OrigEv.metaKey);
        if (IsMulti) {
          if (SelectedIds.has(Wp.Id)) {
            SelectedIds.delete(Wp.Id);
          } else {
            SelectedIds.add(Wp.Id);
          }
        } else {
          SelectedIds.clear();
          SelectedIds.add(Wp.Id);
          if (ExpandedIds.has(Wp.Id)) {
            ExpandedIds.delete(Wp.Id);
          } else {
            ExpandedIds.add(Wp.Id);
          }
        }
        RenderAll();
        PushHistory();
      });

      Marker.on("dragstart", (Ev) => {
        if (SelectedIds.has(Wp.Id) && SelectedIds.size > 1) {
          const zoom = MapObj.getZoom();
          const startPoint = MapObj.project(Ev.latlng, zoom);
          const items = Waypoints.filter((Item) => SelectedIds.has(Item.Id)).map(
            (Item) => ({
              id: Item.Id,
              wp: Item,
              point: MapObj.project([Item.Lat, Item.Lon], zoom),
            })
          );
          DragSelectionState = {
            zoom,
            startPoint,
            items,
            activeId: Wp.Id,
          };
        } else {
          DragSelectionState = null;
        }
      });

      Marker.on("drag", (Ev) => {
        if (DragSelectionState) {
          const curPoint = MapObj.project(Ev.latlng, DragSelectionState.zoom);
          const dx = curPoint.x - DragSelectionState.startPoint.x;
          const dy = curPoint.y - DragSelectionState.startPoint.y;
          DragSelectionState.items.forEach((Item) => {
            const newPt = L.point(Item.point.x + dx, Item.point.y + dy);
            const newLatLng = MapObj.unproject(newPt, DragSelectionState.zoom);
            Item.wp.Lat = newLatLng.lat;
            Item.wp.Lon = newLatLng.lng;
            if (Item.id !== DragSelectionState.activeId) {
              const MarkerRef = MarkerById.get(Item.id);
              if (MarkerRef) {
                MarkerRef.setLatLng(newLatLng);
              }
            }
          });
        } else {
          Wp.Lat = Ev.latlng.lat;
          Wp.Lon = Ev.latlng.lng;
        }
        UpdatePolyline();
        RenderWaypointList();
      });
      Marker.on("dragend", () => {
        DragSelectionState = null;
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

function DeleteSelectedWaypoints() {
  if (!SelectedIds.size) return;
  const Removed = new Set(SelectedIds);
  if (!Removed.size) return;

  const Remaining = [];
  Waypoints.forEach((Wp) => {
    if (Removed.has(Wp.Id)) {
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
  SelectedIds.clear();
  RenderAll();
  PushHistory();
}

function ClearAllWaypoints() {
  if (!Waypoints.length) return;
  Waypoints.length = 0;
  SelectedIds.clear();
  ExpandedIds.clear();
  for (const [, Marker] of MarkerById.entries()) {
    MapObj.removeLayer(Marker);
  }
  MarkerById.clear();
  RenderAll();
  PushHistory();
}

function RenderWaypointList() {
  if (!WaypointListDiv) return;
  WaypointListDiv.innerHTML = "";
  if (ClearAllWaypointsBtn) {
    ClearAllWaypointsBtn.disabled = Waypoints.length === 0;
  }

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
      const IsMulti = Ev.shiftKey || Ev.ctrlKey || Ev.metaKey;
      if (IsMulti) {
        if (SelectedIds.has(Wp.Id)) {
          SelectedIds.delete(Wp.Id);
        } else {
          SelectedIds.add(Wp.Id);
        }
      } else {
        const WasOpen = ExpandedIds.has(Wp.Id);
        ExpandedIds[WasOpen ? "delete" : "add"](Wp.Id);
        SelectedIds.clear();
        SelectedIds.add(Wp.Id);
      }
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

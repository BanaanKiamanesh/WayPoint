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
let WaypointDragState = null;
let WaypointListDragBound = false;

function offsetLatLngByMeters(lat, lon, northMeters, eastMeters) {
  if (typeof turf !== "undefined" && turf.toMercator && turf.toWgs84) {
    const merc = turf.toMercator([lon, lat]);
    const wgs = turf.toWgs84([merc[0] + eastMeters, merc[1] + northMeters]);
    return { lat: wgs[1], lon: wgs[0] };
  }
  const latRad = (lat * Math.PI) / 180;
  const deltaLat = northMeters / 111320;
  const cosLat = Math.cos(latRad);
  const deltaLon = Math.abs(cosLat) > 1e-6 ? eastMeters / (111320 * cosLat) : 0;
  return { lat: lat + deltaLat, lon: lon + deltaLon };
}

function offsetLatLngMeters(lat, lon, offsetMeters) {
  return offsetLatLngByMeters(lat, lon, offsetMeters, offsetMeters);
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
    GimbalRoll: Wp.GimbalRoll,
    Hover: Wp.Hover,
    CameraAction: Wp.CameraAction,
    Zoom: Wp.Zoom,
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
    wp.GimbalRoll = Item.GimbalRoll;
    wp.Hover = Item.Hover;
    wp.CameraAction = Item.CameraAction || "none";
    wp.Zoom = Item.Zoom;
  });
  RenderAll();
  PushHistory();
}

function MarkerIcon(Label, IsSelected, HeadingDeg, AltLabel) {
  const HeadingNum = parseFloat(HeadingDeg);
  const Heading = Number.isFinite(HeadingNum) ? HeadingNum : 0;
  const AltHtml = AltLabel
    ? '<div class="wpAltLabel">' + EscapeHtml(AltLabel) + "</div>"
    : "";
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
      AltHtml +
      "</div>",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function UpdatePolyline() {
  const LatLngs = getDisplayPathLatLngs();
  WaypointLine.setLatLngs(LatLngs);
}

const ALT_LABEL_MIN_ZOOM = 14;
const ALT_LABEL_MAX_WAYPOINTS = 350;

function getAltitudeLabelText(Wp) {
  const altVal = parseFloat(Wp.Alt);
  if (!Number.isFinite(altVal)) return "";
  const unit = SettingsState.units === "imperial" ? "ft" : "m";
  const rounded = RoundNumber(altVal, 0);
  return rounded + unit;
}

function shouldShowAltitudeLabel(isSelected, zoom, totalCount) {
  if (!SettingsState.showAltitudeLabels) return false;
  if (!Number.isFinite(zoom) || zoom < ALT_LABEL_MIN_ZOOM) return false;
  if (totalCount <= ALT_LABEL_MAX_WAYPOINTS) return true;
  return isSelected;
}

function ClearWaypointDragIndicators() {
  if (!WaypointListDiv) return;
  const dragId = WaypointDragState && WaypointDragState.dragId;
  const Rows = WaypointListDiv.querySelectorAll(".wpRow");
  Rows.forEach((Row) => {
    Row.classList.remove("dropBefore", "dropAfter", "dragging");
    if (dragId && Row.dataset && Row.dataset.id === dragId) {
      Row.classList.add("dragging");
    }
  });
}

function MoveWaypointToIndex(dragId, targetIndex) {
  if (!dragId) return false;
  const fromIdx = Waypoints.findIndex((Wp) => Wp.Id === dragId);
  if (fromIdx < 0) return false;
  const [Item] = Waypoints.splice(fromIdx, 1);
  if (!Number.isFinite(targetIndex)) {
    Waypoints.splice(fromIdx, 0, Item);
    return false;
  }
  let insertIndex = targetIndex;
  if (fromIdx < insertIndex) insertIndex -= 1;
  insertIndex = Math.max(0, Math.min(insertIndex, Waypoints.length));
  if (insertIndex === fromIdx) {
    Waypoints.splice(insertIndex, 0, Item);
    return false;
  }
  Waypoints.splice(insertIndex, 0, Item);
  return true;
}

function ReorderWaypointsByDrop(dragId, targetId, before) {
  if (!dragId || !targetId || dragId === targetId) return false;
  const targetIdx = Waypoints.findIndex((Wp) => Wp.Id === targetId);
  if (targetIdx < 0) return false;
  const insertIndex = before ? targetIdx : targetIdx + 1;
  return MoveWaypointToIndex(dragId, insertIndex);
}

function GetInsertLatLngAfterIndex(index) {
  const current = Waypoints[index];
  if (!current) return null;
  const next = Waypoints[index + 1];
  if (next) {
    return {
      lat: (current.Lat + next.Lat) / 2,
      lon: (current.Lon + next.Lon) / 2,
    };
  }
  const prev = Waypoints[index - 1];
  if (prev) {
    const dLat = current.Lat - prev.Lat;
    const dLon = current.Lon - prev.Lon;
    if (Math.abs(dLat) > 1e-10 || Math.abs(dLon) > 1e-10) {
      return {
        lat: current.Lat + dLat * 0.25,
        lon: current.Lon + dLon * 0.25,
      };
    }
  }
  return offsetLatLngByMeters(current.Lat, current.Lon, 2, 2);
}

function InsertWaypointAfterIndex(index) {
  const Pos = GetInsertLatLngAfterIndex(index);
  if (!Pos) return;
  const current = Waypoints[index];
  const wp = AddWaypoint(Pos.lat, Pos.lon, {
    selectionMode: "replace",
    skipRender: true,
    skipHistory: true,
    insertIndex: index + 1,
  });
  if (current) {
    wp.Alt = current.Alt;
    wp.Speed = current.Speed;
    wp.Heading = current.Heading;
    wp.Gimbal = current.Gimbal;
    wp.GimbalRoll = current.GimbalRoll;
    wp.Hover = current.Hover;
    wp.CameraAction = current.CameraAction;
    wp.Zoom = current.Zoom;
    wp.UseGlobalAlt = Boolean(current.UseGlobalAlt);
    wp.UseGlobalSpeed = Boolean(current.UseGlobalSpeed);
  }
  ExpandedIds.add(wp.Id);
  RenderAll();
  PushHistory();
}

const CURVE_SAMPLE_SPACING_M = 10;
const CURVE_SAMPLE_MIN_POINTS = 16;
const CURVE_SAMPLE_MAX_POINTS = 2000;
const CURVE_SHARPNESS = 0.95;

function getDisplayPathLatLngs() {
  if (!Waypoints.length) return [];
  if (PathDisplayMode !== "curved" || Waypoints.length < 3) {
    return Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  }
  if (
    typeof turf === "undefined" ||
    !turf.lineString ||
    !turf.along ||
    !turf.length
  ) {
    return Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  }
  return buildCurvedPathLatLngs();
}

function buildCurvedPathLatLngs() {
  const coords = Waypoints.map((Wp) => [Wp.Lon, Wp.Lat]);
  if (coords.length < 2) return Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  const baseLine = turf.lineString(coords);
  const curvedLine =
    typeof turf.bezierSpline === "function"
      ? turf.bezierSpline(baseLine, { sharpness: CURVE_SHARPNESS })
      : baseLine;
  const curvedCoords = curvedLine && curvedLine.geometry && curvedLine.geometry.coordinates;
  if (!curvedCoords || curvedCoords.length < 2) {
    return Waypoints.map((Wp) => [Wp.Lat, Wp.Lon]);
  }

  const lengthKm = turf.length(curvedLine, { units: "kilometers" });
  const lengthM = lengthKm * 1000;
  if (!Number.isFinite(lengthM) || lengthM <= 0) {
    return curvedCoords.map((coord) => [coord[1], coord[0]]);
  }

  const rawPoints = Math.ceil(lengthM / CURVE_SAMPLE_SPACING_M);
  const points = Math.min(
    CURVE_SAMPLE_MAX_POINTS,
    Math.max(CURVE_SAMPLE_MIN_POINTS, rawPoints)
  );
  const out = [];
  for (let i = 0; i <= points; i += 1) {
    const distKm = (lengthKm * i) / points;
    const pt = turf.along(curvedLine, distKm, { units: "kilometers" });
    if (pt && pt.geometry && pt.geometry.coordinates) {
      const coord = pt.geometry.coordinates;
      out.push([coord[1], coord[0]]);
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
  if (Key === "GimbalRoll") {
    return "Gimbal roll (deg)";
  }
  if (Key === "Hover") {
    return "Hover (s)";
  }
  if (Key === "Zoom") {
    return "Zoom (x)";
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

function getWaypointSpeedMsForEstimate(Wp) {
  const useGlobal = !Wp || Wp.UseGlobalSpeed;
  let speedVal = useGlobal ? SettingsState.globalSpeed : Wp.Speed;
  if (!Number.isFinite(speedVal) || speedVal <= 0) {
    speedVal = SettingsState.globalSpeed;
  }
  if (!Number.isFinite(speedVal) || speedVal <= 0) return null;
  if (typeof ConvertSpeedBetweenUnits === "function") {
    return ConvertSpeedBetweenUnits(speedVal, SettingsState.units, "metric");
  }
  return SettingsState.units === "imperial" ? speedVal * 0.44704 : speedVal;
}

function computeTravelTimeSeconds() {
  if (!turf || Waypoints.length < 2) return 0;
  let totalSeconds = 0;
  for (let i = 0; i < Waypoints.length - 1; i++) {
    const cur = Waypoints[i];
    const next = Waypoints[i + 1];
    const speedMs = getWaypointSpeedMsForEstimate(cur);
    if (!Number.isFinite(speedMs) || speedMs <= 0) continue;
    const distM =
      turf.distance([cur.Lon, cur.Lat], [next.Lon, next.Lat], { units: "kilometers" }) *
      1000;
    if (!Number.isFinite(distM) || distM <= 0) continue;
    totalSeconds += distM / speedMs;
  }
  return totalSeconds;
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
  const totalCount = Waypoints.length;
  const zoom = MapObj && typeof MapObj.getZoom === "function" ? MapObj.getZoom() : null;
  Waypoints.forEach((Wp, Idx) => {
    const IsSelected = SelectedIds.has(Wp.Id);
    let Marker = MarkerById.get(Wp.Id);
    const AltLabel = shouldShowAltitudeLabel(IsSelected, zoom, totalCount)
      ? getAltitudeLabelText(Wp)
      : "";
    const Icon = MarkerIcon(Idx + 1, IsSelected, Wp.Heading, AltLabel);

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
    GimbalRoll: 0,
    Hover: 0,
    CameraAction: "none",
    Zoom: null,
    UseGlobalAlt: true,
    UseGlobalSpeed: true,
  };
  const insertIndex = Number.isFinite(Opts.insertIndex) ? Opts.insertIndex : null;
  if (insertIndex !== null) {
    const clamped = Math.max(0, Math.min(insertIndex, Waypoints.length));
    Waypoints.splice(clamped, 0, NewWp);
  } else {
    Waypoints.push(NewWp);
  }

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
  if (!WaypointListDragBound) {
    WaypointListDiv.addEventListener("dragover", (Ev) => {
      if (!WaypointDragState) return;
      const target = Ev.target;
      if (target && target.closest && target.closest(".wpRow")) return;
      Ev.preventDefault();
      if (Ev.dataTransfer) {
        Ev.dataTransfer.dropEffect = "move";
      }
      ClearWaypointDragIndicators();
    });
    WaypointListDiv.addEventListener("drop", (Ev) => {
      if (!WaypointDragState) return;
      const target = Ev.target;
      if (target && target.closest && target.closest(".wpRow")) return;
      Ev.preventDefault();
      const dragId =
        (Ev.dataTransfer && Ev.dataTransfer.getData("text/plain")) ||
        (WaypointDragState && WaypointDragState.dragId);
      const moved = MoveWaypointToIndex(dragId, Waypoints.length);
      WaypointDragState = null;
      ClearWaypointDragIndicators();
      if (moved) {
        RenderAll();
        PushHistory();
      }
    });
    WaypointListDragBound = true;
  }
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

    const DragHandle = document.createElement("span");
    DragHandle.className = "wpDragHandle";
    DragHandle.textContent = "::";
    DragHandle.title = "Drag to reorder";
    DragHandle.draggable = true;
    DragHandle.addEventListener("mousedown", (Ev) => Ev.stopPropagation());
    DragHandle.addEventListener("click", (Ev) => Ev.stopPropagation());
    DragHandle.addEventListener("dragstart", (Ev) => {
      WaypointDragState = { dragId: Wp.Id, overId: null, before: null };
      ClearWaypointDragIndicators();
      Row.classList.add("dragging");
      if (Ev.dataTransfer) {
        Ev.dataTransfer.effectAllowed = "move";
        Ev.dataTransfer.setData("text/plain", Wp.Id);
      }
    });
    DragHandle.addEventListener("dragend", () => {
      WaypointDragState = null;
      ClearWaypointDragIndicators();
    });

    const Caret = document.createElement("span");
    Caret.className = "wpCaret";
    Caret.textContent = IsExpanded ? "v" : ">";

    const Index = document.createElement("div");
    Index.className = "wpIndex";
    Index.textContent = Idx + 1;

    const Label = document.createElement("div");
    Label.className = "wpLabel";
    Label.textContent = "Waypoint";

    HeaderMain.appendChild(DragHandle);
    HeaderMain.appendChild(Caret);
    HeaderMain.appendChild(Index);
    HeaderMain.appendChild(Label);

    const HeaderActions = document.createElement("div");
    HeaderActions.className = "wpHeaderActions";

    const InsertBtn = document.createElement("button");
    InsertBtn.type = "button";
    InsertBtn.className = "wpInsert";
    InsertBtn.textContent = "Insert";
    InsertBtn.title = "Insert after this waypoint";
    InsertBtn.addEventListener("click", (Ev) => {
      Ev.stopPropagation();
      InsertWaypointAfterIndex(Idx);
    });

    const DeleteBtn = document.createElement("button");
    DeleteBtn.type = "button";
    DeleteBtn.className = "wpDelete";
    DeleteBtn.textContent = "Delete";
    DeleteBtn.addEventListener("click", (Ev) => {
      Ev.stopPropagation();
      DeleteWaypoint(Wp.Id);
    });

    Header.appendChild(HeaderMain);
    HeaderActions.appendChild(InsertBtn);
    HeaderActions.appendChild(DeleteBtn);
    Header.appendChild(HeaderActions);

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

    Row.addEventListener("dragover", (Ev) => {
      if (!WaypointDragState) return;
      Ev.preventDefault();
      const rect = Row.getBoundingClientRect();
      const before = Ev.clientY < rect.top + rect.height / 2;
      if (
        WaypointDragState.overId !== Wp.Id ||
        WaypointDragState.before !== before
      ) {
        ClearWaypointDragIndicators();
        Row.classList.add(before ? "dropBefore" : "dropAfter");
        WaypointDragState.overId = Wp.Id;
        WaypointDragState.before = before;
      }
      if (Ev.dataTransfer) {
        Ev.dataTransfer.dropEffect = "move";
      }
    });
    Row.addEventListener("drop", (Ev) => {
      if (!WaypointDragState) return;
      Ev.preventDefault();
      const dragId =
        (Ev.dataTransfer && Ev.dataTransfer.getData("text/plain")) ||
        (WaypointDragState && WaypointDragState.dragId);
      const moved = ReorderWaypointsByDrop(
        dragId,
        Wp.Id,
        WaypointDragState.before !== false
      );
      WaypointDragState = null;
      ClearWaypointDragIndicators();
      if (moved) {
        RenderAll();
        PushHistory();
      }
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
      { key: "GimbalRoll", step: "1", min: -90, max: 90, useKey: null },
      { key: "Hover", step: "1", min: 0, max: undefined, useKey: null },
      { key: "Zoom", step: "0.1", min: 1, max: undefined, useKey: null, allowEmpty: true, placeholder: "-" },
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
          if (Field.key === "Alt") {
            RefreshMarkers();
          }
          PushHistory();
        });

        const ToggleLabel = document.createElement("span");
        ToggleLabel.textContent = "Use global";

        ToggleWrap.appendChild(Toggle);
        ToggleWrap.appendChild(ToggleLabel);
        HeaderRow.appendChild(ToggleWrap);
      }

      if (Field.key === "Heading") {
        const BearingBtn = document.createElement("button");
        BearingBtn.className = "wpBearing";
        BearingBtn.textContent = "Towards next WP";
        BearingBtn.title = "Aim heading towards next waypoint";
        BearingBtn.disabled = (Idx+1 >= Waypoints.length);
        BearingBtn.addEventListener("click", (Ev) => {
          Ev.stopPropagation();
          if(Idx + 1 >= Waypoints.length)
            return;

          const heading = bearingBetweenPoints(
            { lat: Wp.Lat, lng: Wp.Lon },
            { lat: Waypoints[Idx + 1].Lat, lng: Waypoints[Idx + 1].Lon }
          );

          if (Number.isFinite(heading)) {
            Wp.Heading = heading.toFixed(2);
            RenderWaypointList();
            RefreshMarkers();
            PushHistory();
          }
        });

        HeaderRow.appendChild(BearingBtn);
      }

      Wrap.appendChild(HeaderRow);

      const Input = document.createElement("input");
      Input.type = "number";
      Input.step = Field.step;
      if (Field.min !== undefined) Input.min = Field.min;
      if (Field.max !== undefined) Input.max = Field.max;
      if (Field.allowEmpty && !Number.isFinite(parseFloat(Wp[Field.key]))) {
        Input.value = "";
        if (Field.placeholder) Input.placeholder = Field.placeholder;
      } else {
        Input.value = Wp[Field.key];
      }
      const IsGlobal = Field.useKey ? Boolean(Wp[Field.useKey]) : false;
      Input.disabled = IsGlobal;
      Input.addEventListener("click", (Ev) => Ev.stopPropagation());
      Input.addEventListener("change", (Ev) => {
        Ev.stopPropagation();
        const raw = String(Ev.target.value || "").trim();
        if (Field.allowEmpty && raw === "") {
          Wp[Field.key] = null;
          RenderWaypointList();
          PushHistory();
          return;
        }
        let ValNum = parseFloat(raw);
        if (Number.isFinite(ValNum)) {
          if (Field.min !== undefined) ValNum = Math.max(Field.min, ValNum);
          if (Field.max !== undefined) ValNum = Math.min(Field.max, ValNum);
          Wp[Field.key] = ValNum;
        }
        RenderWaypointList();
        if (Field.key === "Heading" || Field.key === "Alt") {
          RefreshMarkers();
        }
        PushHistory();
      });

      Wrap.appendChild(Input);
      Fields.appendChild(Wrap);
    });

    const CameraWrap = document.createElement("div");
    CameraWrap.className = "wpField";

    const CameraHeader = document.createElement("div");
    CameraHeader.className = "wpFieldHeader";
    const CameraLabel = document.createElement("span");
    CameraLabel.textContent = "Camera action";
    CameraHeader.appendChild(CameraLabel);
    CameraWrap.appendChild(CameraHeader);

    const CameraSelect = document.createElement("select");
    [
      { value: "none", label: "None" },
      { value: "takePhoto", label: "Take photo" },
      { value: "startRecording", label: "Start recording" },
      { value: "stopRecording", label: "Stop recording" },
    ].forEach((opt) => {
      const Option = document.createElement("option");
      Option.value = opt.value;
      Option.textContent = opt.label;
      CameraSelect.appendChild(Option);
    });
    CameraSelect.value = Wp.CameraAction || "none";
    CameraSelect.addEventListener("click", (Ev) => Ev.stopPropagation());
    CameraSelect.addEventListener("change", (Ev) => {
      Ev.stopPropagation();
      Wp.CameraAction = Ev.target.value || "none";
      PushHistory();
    });
    CameraWrap.appendChild(CameraSelect);
    Fields.appendChild(CameraWrap);

    Details.appendChild(Fields);

    Row.appendChild(Header);
    Row.appendChild(Details);

    WaypointListDiv.appendChild(Row);
  });
}

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

document.addEventListener("keydown", (Ev) => {
  const key = Ev.key || "";
  const keyLower = (Ev.key || "").toLowerCase();
  const isMod = Ev.ctrlKey || Ev.metaKey;
  const isUndo = isMod && keyLower === "z" && !Ev.shiftKey;
  const isRedo = isMod && (keyLower === "y" || (keyLower === "z" && Ev.shiftKey));
  const isCopy = (isMod && keyLower === "c") || (Ev.ctrlKey && keyLower === "insert");
  const isPaste = (isMod && keyLower === "v") || (Ev.shiftKey && keyLower === "insert");

  if (isMod && isUndo) {
    Ev.preventDefault();
    UndoHistory();
    return;
  }
  if (isMod && isRedo) {
    Ev.preventDefault();
    RedoHistory();
    return;
  }
  const isEscape = key === "Escape" || key === "Esc";
  if (isEscape && !IsEditableTarget(Ev.target)) {
    if (CancelActiveDrawing()) {
      Ev.preventDefault();
      return;
    }
  }
  const isSpace =
    Ev.code === "Space" || key === " " || keyLower === "spacebar";
  if (isSpace && !IsEditableTarget(Ev.target)) {
    Ev.preventDefault();
    if (typeof FitMapToWindow === "function") {
      FitMapToWindow();
    }
    return;
  }
  if (isCopy && !IsEditableTarget(Ev.target)) {
    Ev.preventDefault();
    CopySelectedWaypoints();
    return;
  }
  if (isPaste && !IsEditableTarget(Ev.target)) {
    Ev.preventDefault();
    PasteCopiedWaypoints();
    return;
  }

  const isDeleteKey = key === "Delete" || key === "Backspace" || key === "Del";
  if (isDeleteKey && !IsEditableTarget(Ev.target) && SelectedIds.size) {
    Ev.preventDefault();
    DeleteSelectedWaypoints();
  }
});

function CancelActiveDrawing() {
  const hasActiveDraw = Boolean(ActiveDrawer || ActiveDrawMode === "ellipse");
  const hasPendingShape = Boolean(
    (DrawnItems && DrawnItems.getLayers().length) || (EllipseState && EllipseState.center)
  );
  if (!hasActiveDraw && !hasPendingShape) return false;

  if (ActiveDrawer && typeof ActiveDrawer.disable === "function") {
    ActiveDrawer.disable();
  }
  ActiveDrawer = null;
  ActiveDrawMode = null;
  clearEllipseHandles();
  EllipseState = null;
  if (DrawnItems) {
    DrawnItems.clearLayers();
  }
  BoundaryConfirmed = false;
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();
  PushHistory();
  return true;
}

function IsFileDrag(Ev) {
  if (!Ev || !Ev.dataTransfer) return false;
  const Transfer = Ev.dataTransfer;
  const Types = Transfer.types;
  if (Types && Types.length) {
    for (let i = 0; i < Types.length; i++) {
      const Type = Types[i];
      if (
        Type === "Files" ||
        Type === "application/x-moz-file" ||
        Type === "public.file-url"
      ) {
        return true;
      }
    }
  }
  const Items = Transfer.items;
  if (Items && Items.length) {
    for (let i = 0; i < Items.length; i++) {
      if (Items[i].kind === "file") return true;
    }
  }
  return Transfer.files && Transfer.files.length > 0;
}

let FileDragActive = false;
let DragOverlayCount = 0;

function ShowDropOverlay() {
  if (!DropOverlay) return;
  DropOverlay.classList.add("visible");
  FileDragActive = true;
}

function HideDropOverlay() {
  if (!DropOverlay) return;
  DropOverlay.classList.remove("visible");
  FileDragActive = false;
  DragOverlayCount = 0;
}

document.addEventListener("dragenter", (Ev) => {
  if (!IsFileDrag(Ev)) return;
  DragOverlayCount += 1;
  ShowDropOverlay();
});

document.addEventListener("dragover", (Ev) => {
  if (!IsFileDrag(Ev)) return;
  Ev.preventDefault();
  if (Ev.dataTransfer) {
    Ev.dataTransfer.dropEffect = "copy";
  }
  ShowDropOverlay();
});

document.addEventListener("dragleave", () => {
  if (!FileDragActive) return;
  DragOverlayCount = Math.max(DragOverlayCount - 1, 0);
  if (DragOverlayCount === 0) {
    HideDropOverlay();
  }
});

document.addEventListener("drop", async (Ev) => {
  if (!IsFileDrag(Ev)) return;
  Ev.preventDefault();
  HideDropOverlay();
  const Files = Ev.dataTransfer && Ev.dataTransfer.files ? Ev.dataTransfer.files : null;
  if (!Files || !Files.length) return;
  try {
    await ImportWaypointsFromFile(Files[0]);
  } catch (Err) {
    console.error("Import failed", Err);
    alert("Import failed. Please check the file.");
  }
});

let BoxSelectState = null;
let BoxSelectLayer = null;
let BoxSelectIgnoreClick = false;
let MoveSelectionState = null;

function IsEventOnWaypointMarker(OrigEv) {
  if (!OrigEv || !OrigEv.target || !OrigEv.target.closest) return false;
  return Boolean(OrigEv.target.closest(".wpMarker"));
}

function IsEditableTarget(TargetEl) {
  if (!TargetEl) return false;
  if (TargetEl.isContentEditable) return true;
  const Tag = (TargetEl.tagName || "").toLowerCase();
  return Tag === "input" || Tag === "textarea" || Tag === "select";
}

function IsPrimaryPointer(OrigEv) {
  if (!OrigEv) return false;
  if (OrigEv.button === undefined) return true;
  return OrigEv.button === 0;
}

function StartBoxSelect(Ev) {
  const OrigEv = Ev && Ev.originalEvent ? Ev.originalEvent : Ev;
  if (!OrigEv || !OrigEv.shiftKey || !IsPrimaryPointer(OrigEv)) return;
  if (ActiveDrawer || ActiveDrawMode === "ellipse") return;
  if (IsEventOnWaypointMarker(OrigEv)) return;
  if (MoveSelectionState) return;
  if (BoxSelectState) return;

  const StartLatLng = Ev && Ev.latlng ? Ev.latlng : MapObj.mouseEventToLatLng(OrigEv);
  if (!StartLatLng) return;

  L.DomEvent.preventDefault(OrigEv);
  if (OrigEv.stopImmediatePropagation) {
    OrigEv.stopImmediatePropagation();
  } else {
    L.DomEvent.stopPropagation(OrigEv);
  }

  BoxSelectState = {
    startLatLng: StartLatLng,
    additive: OrigEv.ctrlKey || OrigEv.metaKey,
    moved: false,
  };
  BoxSelectIgnoreClick = true;

  if (BoxSelectLayer) {
    MapObj.removeLayer(BoxSelectLayer);
    BoxSelectLayer = null;
  }
  BoxSelectLayer = L.rectangle([StartLatLng, StartLatLng], {
    color: "#4db3ff",
    weight: 1,
    dashArray: "4 4",
    fillOpacity: 0.08,
    interactive: false,
  });
  BoxSelectLayer.addTo(MapObj);
  MapObj.dragging.disable();
  MapObj.on("mousemove", UpdateBoxSelect);
  document.addEventListener("mouseup", EndBoxSelect);
}

function UpdateBoxSelect(Ev) {
  if (!BoxSelectState || !BoxSelectLayer) return;
  BoxSelectState.moved = true;
  BoxSelectLayer.setBounds(L.latLngBounds(BoxSelectState.startLatLng, Ev.latlng));
}

function EndBoxSelect(Ev) {
  if (!BoxSelectState) return;
  MapObj.dragging.enable();
  MapObj.off("mousemove", UpdateBoxSelect);
  document.removeEventListener("mouseup", EndBoxSelect);

  if (BoxSelectLayer) {
    const Bounds = BoxSelectLayer.getBounds();
    MapObj.removeLayer(BoxSelectLayer);
    BoxSelectLayer = null;

    if (BoxSelectState.moved) {
      if (!BoxSelectState.additive) {
        SelectedIds.clear();
      }
      Waypoints.forEach((Wp) => {
        if (Bounds.contains([Wp.Lat, Wp.Lon])) {
          SelectedIds.add(Wp.Id);
        }
      });
      RenderAll();
      PushHistory();
    }
  }

  BoxSelectState = null;
  setTimeout(() => {
    BoxSelectIgnoreClick = false;
  }, 0);
}

function StartMoveSelection(Ev) {
  const OrigEv = Ev && Ev.originalEvent ? Ev.originalEvent : Ev;
  if (!OrigEv || !OrigEv.altKey || !IsPrimaryPointer(OrigEv)) return;
  if (OrigEv.shiftKey) return;
  if (!SelectedIds || SelectedIds.size === 0) return;
  if (ActiveDrawer || ActiveDrawMode === "ellipse") return;
  if (BoxSelectState || MoveSelectionState) return;

  const StartLatLng = Ev && Ev.latlng ? Ev.latlng : MapObj.mouseEventToLatLng(OrigEv);
  if (!StartLatLng) return;

  L.DomEvent.preventDefault(OrigEv);
  if (OrigEv.stopImmediatePropagation) {
    OrigEv.stopImmediatePropagation();
  } else {
    L.DomEvent.stopPropagation(OrigEv);
  }

  const Zoom = MapObj.getZoom();
  const StartPoint = MapObj.project(StartLatLng, Zoom);
  const Items = Waypoints.filter((Wp) => SelectedIds.has(Wp.Id)).map((Wp) => ({
    id: Wp.Id,
    wp: Wp,
    point: MapObj.project([Wp.Lat, Wp.Lon], Zoom),
  }));

  if (!Items.length) return;

  MoveSelectionState = {
    zoom: Zoom,
    startPoint: StartPoint,
    items: Items,
    moved: false,
  };
  BoxSelectIgnoreClick = true;

  MapObj.dragging.disable();
  MapObj.on("mousemove", UpdateMoveSelection);
  document.addEventListener("mouseup", EndMoveSelection);
}

function UpdateMoveSelection(Ev) {
  if (!MoveSelectionState) return;
  MoveSelectionState.moved = true;
  const CurPoint = MapObj.project(Ev.latlng, MoveSelectionState.zoom);
  const dx = CurPoint.x - MoveSelectionState.startPoint.x;
  const dy = CurPoint.y - MoveSelectionState.startPoint.y;

  MoveSelectionState.items.forEach((Item) => {
    const newPt = L.point(Item.point.x + dx, Item.point.y + dy);
    const newLatLng = MapObj.unproject(newPt, MoveSelectionState.zoom);
    Item.wp.Lat = newLatLng.lat;
    Item.wp.Lon = newLatLng.lng;
    const MarkerRef = MarkerById.get(Item.id);
    if (MarkerRef) {
      MarkerRef.setLatLng(newLatLng);
    }
  });

  UpdatePolyline();
  RenderWaypointList();
}

function EndMoveSelection() {
  if (!MoveSelectionState) return;
  MapObj.dragging.enable();
  MapObj.off("mousemove", UpdateMoveSelection);
  document.removeEventListener("mouseup", EndMoveSelection);

  if (MoveSelectionState.moved) {
    PushHistory();
  }
  MoveSelectionState = null;
  setTimeout(() => {
    BoxSelectIgnoreClick = false;
  }, 0);
}

// Drawing events: keep only one active shape and enable tools
MapObj.on(L.Draw.Event.CREATED, (Ev) => {
  DrawnItems.clearLayers();
  DrawnItems.addLayer(Ev.layer);
  StopActiveDrawing();
  BoundaryConfirmed = false;
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();
  PushHistory();
});

MapObj.on(L.Draw.Event.DELETED, () => {
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();
  PushHistory();
});
MapObj.on(L.Draw.Event.EDITED, () => {
  LastCoverageModel = null;
  LastBoundaryFeature = null;
  UpdateToolsUi();
  PushHistory();
});
MapObj.on(L.Draw.Event.DRAWSTOP, () => {
  StopActiveDrawing();
  UpdateToolsUi();
});

const MapContainer = MapObj.getContainer();
if (MapContainer) {
  MapContainer.addEventListener("mousedown", StartMoveSelection, true);
  MapContainer.addEventListener("mousedown", StartBoxSelect, true);
}

MapObj.on("mousedown", StartMoveSelection);
MapObj.on("mousedown", StartBoxSelect);
MapObj.on("zoomend", () => {
  if (SettingsState.showAltitudeLabels) {
    RefreshMarkers();
  }
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
    PushHistory();
  });
}

if (ShapeSpacingInput) {
  ShapeSpacingInput.addEventListener("change", () => {
    UpdateToolsUi();
    PushHistory();
  });
}

if (ShapeResolutionSlider) {
  ShapeResolutionSlider.addEventListener("input", () => {
    UpdateResolutionDisplay();
    RegenerateWaypointsFromResolution();
    UpdateToolsUi();
  });
  ShapeResolutionSlider.addEventListener("change", () => {
    PushHistory();
  });
}

if (ShapeOrientationSelect) {
  ShapeOrientationSelect.addEventListener("change", () => {
    PolygonOrientation = ShapeOrientationSelect.value || "auto";
    if (!BoundaryConfirmed && HasBoundaryShape()) {
      GenerateWaypointsFromDrawnShape();
    }
    UpdateToolsUi();
    PushHistory();
  });
}

if (EllipseResolutionInput) {
  EllipseResolutionInput.addEventListener("change", () => {
    if (EllipseMode === "circumference") {
      GenerateWaypointsFromDrawnShape();
      return;
    }
    PushHistory();
  });
}

if (EllipseOrientationSelect) {
  EllipseOrientationSelect.addEventListener("change", () => {
    EllipseBoundaryOrientation = EllipseOrientationSelect.value || "auto";
    if (EllipseMode === "boundary" && !BoundaryConfirmed && HasBoundaryShape()) {
      GenerateWaypointsFromDrawnShape();
    }
    UpdateToolsUi();
    PushHistory();
  });
}

if (EllipseRotationInput) {
  EllipseRotationInput.addEventListener("change", () => {
    const RotVal = parseFloat(EllipseRotationInput.value);
    if (EllipseState && EllipseState.center && Number.isFinite(RotVal)) {
      const NormRot = ((RotVal % 360) + 360) % 360;
      EllipseRotationInput.value = String(NormRot);
      EllipseState.rotationDeg = NormRot;
      updateEllipseLayer();
      refreshHandles();
    }
    if (EllipseMode === "circumference") {
      GenerateWaypointsFromDrawnShape();
      return;
    }
    PushHistory();
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
    PushHistory();
  });
}

if (ApplyRotationBtn) {
  ApplyRotationBtn.addEventListener("click", () => {
    RotateSelectedWaypoints(RotationInput ? RotationInput.value : 0);
  });
}

if (ApplyBatchEditBtn) {
  ApplyBatchEditBtn.addEventListener("click", () => {
    ApplyBatchEditToSelected();
  });
}

if (ClearBatchEditBtn) {
  ClearBatchEditBtn.addEventListener("click", () => {
    ClearBatchEditInputs();
  });
}

[
  BatchAltInput,
  BatchSpeedInput,
  BatchHeadingInput,
  BatchGimbalInput,
  BatchGimbalRollInput,
  BatchHoverInput,
  BatchZoomInput,
].forEach((InputEl) => {
  if (!InputEl) return;
  InputEl.addEventListener("input", UpdateToolsUi);
});

if (BatchCameraActionSelect) {
  BatchCameraActionSelect.addEventListener("change", UpdateToolsUi);
}

if (NudgeStepInput) {
  NudgeStepInput.addEventListener("input", UpdateToolsUi);
}

if (NudgeNorthBtn) {
  NudgeNorthBtn.addEventListener("click", () => {
    NudgeSelectionByDirection("north");
  });
}
if (NudgeSouthBtn) {
  NudgeSouthBtn.addEventListener("click", () => {
    NudgeSelectionByDirection("south");
  });
}
if (NudgeWestBtn) {
  NudgeWestBtn.addEventListener("click", () => {
    NudgeSelectionByDirection("west");
  });
}
if (NudgeEastBtn) {
  NudgeEastBtn.addEventListener("click", () => {
    NudgeSelectionByDirection("east");
  });
}

if (OffsetDistanceInput) {
  OffsetDistanceInput.addEventListener("input", UpdateToolsUi);
}
if (OffsetBearingInput) {
  OffsetBearingInput.addEventListener("input", UpdateToolsUi);
}
if (ApplyOffsetBtn) {
  ApplyOffsetBtn.addEventListener("click", () => {
    ApplyOffsetSelectionFromInputs();
  });
}

if (ReverseWaypointsBtn) {
  ReverseWaypointsBtn.addEventListener("click", () => {
    ReverseWaypointOrder();
  });
}

if (RotationInput) {
  RotationInput.addEventListener("input", UpdateToolsUi);
  RotationInput.addEventListener("change", () => {
    UpdateToolsUi();
    PushHistory();
  });
}

if (ExportFormatSelect) {
  ExportFormatSelect.addEventListener("change", () => {
    PushHistory();
  });
}
if (ExportPathModeSelect) {
  ExportPathModeSelect.addEventListener("change", () => {
    PathDisplayMode = ExportPathModeSelect.value === "curved" ? "curved" : "straight";
    RenderAll();
    PushHistory();
  });
}

if (ExportDockBtn) {
  ExportDockBtn.addEventListener("click", () => {
    if (ExportPanelOpen) {
      ExportPanelOpen = false;
    } else {
      ExportPanelOpen = true;
      ToolsPanelOpen = false;
      ManipulatePanelOpen = false;
    }
    UpdateRightPanelUi();
    UpdateToolsUi();
    PushHistory();
  });
}

if (ExportNowBtn) {
  ExportNowBtn.addEventListener("click", () => {
    if (!Waypoints.length) return;
    const format = ExportFormatSelect ? ExportFormatSelect.value : "kml";
    ExportWaypoints(format);
  });
}

if (ImportFileBtn && ImportFileInput) {
  ImportFileBtn.addEventListener("click", () => {
    ImportFileInput.click();
  });
  ImportFileInput.addEventListener("change", async (Ev) => {
    const FileObj = Ev.target && Ev.target.files ? Ev.target.files[0] : null;
    if (!FileObj) return;
    try {
      await ImportWaypointsFromFile(FileObj);
    } catch (Err) {
      console.error("Import failed", Err);
      alert("Import failed. Please check the file.");
    } finally {
      ImportFileInput.value = "";
    }
  });
}

// Click on map: clear search results and add a waypoint
MapObj.on("click", (Ev) => {
  ClearResults();
  if (BoxSelectIgnoreClick) return;
  if (ActiveDrawer || ActiveDrawMode === "ellipse") {
    // If currently drawing, try to finish polygon; do not add waypoint
    if (ActiveDrawMode !== "ellipse" && TryFinishPolygonOnFirstPoint(Ev)) {
      return;
    }
    return;
  }
  if (Ev.originalEvent && Ev.originalEvent.shiftKey) {
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
    PushHistory();
  });
}

if (ClearAllWaypointsBtn) {
  ClearAllWaypointsBtn.addEventListener("click", (Ev) => {
    Ev.stopPropagation();
    ClearAllWaypoints();
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
    PushHistory();
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
    PushHistory();
  });
}

if (ToggleToolsBtn) {
  ToggleToolsBtn.addEventListener("click", () => {
    if (ToolsPanelOpen) {
      ToolsPanelOpen = false;
      StopActiveDrawing();
      ActiveDrawTool = null;
    } else {
      ToolsPanelOpen = true;
      ManipulatePanelOpen = false;
      ExportPanelOpen = false;
    }
    UpdateRightPanelUi();
    UpdateToolsUi();
    PushHistory();
  });
}

if (ToggleManipulateBtn) {
  ToggleManipulateBtn.addEventListener("click", () => {
    if (ManipulatePanelOpen) {
      ManipulatePanelOpen = false;
    } else {
      ManipulatePanelOpen = true;
      ToolsPanelOpen = false;
      ExportPanelOpen = false;
    }
    UpdateRightPanelUi();
    UpdateToolsUi();
    PushHistory();
  });
}

// Ellipse mode toggle
if (EllipseModeBoundaryBtn && EllipseModeCircBtn) {
  EllipseModeBoundaryBtn.addEventListener("click", () => {
    EllipseMode = "boundary";
    UpdateToolsUi();
    PushHistory();
  });
  EllipseModeCircBtn.addEventListener("click", () => {
    EllipseMode = "circumference";
    UpdateToolsUi();
    PushHistory();
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
        const nextUnits = Ev.target.value;
        const prevUnits = SettingsState.units;
        if (prevUnits !== nextUnits) {
          SettingsState.units = nextUnits;
          ApplyUnitConversion(prevUnits, nextUnits);
        } else {
          SettingsState.units = nextUnits;
        }
        UpdateDistanceLabels();
        UpdateResolutionDisplay();
        UpdateToolsUi();
        RenderWaypointList();
        RefreshMarkers();
        if (SettingsState.terrainCorrectionEnabled && typeof RequestTerrainCorrection === "function") {
          RequestTerrainCorrection();
        }
        PushHistory();
      }
    });
  });
  UpdateDistanceLabels();
  UpdateResolutionDisplay();
  UpdateToolsUi();
}

function ApplyUnitConversion(prevUnits, nextUnits) {
  if (prevUnits === nextUnits) return;
  const distVal = (val) =>
    RoundNumber(ConvertDistanceBetweenUnits(val, prevUnits, nextUnits), 3);
  const speedVal = (val) =>
    RoundNumber(ConvertSpeedBetweenUnits(val, prevUnits, nextUnits), 3);

  if (Number.isFinite(SettingsState.globalAlt)) {
    SettingsState.globalAlt = distVal(SettingsState.globalAlt);
  }
  if (Number.isFinite(SettingsState.globalSpeed)) {
    SettingsState.globalSpeed = speedVal(SettingsState.globalSpeed);
  }

  if (GlobalAltInput) {
    GlobalAltInput.value = Number.isFinite(SettingsState.globalAlt)
      ? String(SettingsState.globalAlt)
      : "";
  }
  if (GlobalSpeedInput) {
    GlobalSpeedInput.value = Number.isFinite(SettingsState.globalSpeed)
      ? String(SettingsState.globalSpeed)
      : "";
  }
  if (ShapeSpacingInput) {
    const spacingVal = parseFloat(ShapeSpacingInput.value);
    if (Number.isFinite(spacingVal)) {
      ShapeSpacingInput.value = String(distVal(spacingVal));
    }
  }
  if (EllipseResolutionInput) {
    const ellipseVal = parseFloat(EllipseResolutionInput.value);
    if (Number.isFinite(ellipseVal)) {
      EllipseResolutionInput.value = String(distVal(ellipseVal));
    }
  }
  if (BatchAltInput) {
    const batchAltVal = parseFloat(BatchAltInput.value);
    if (Number.isFinite(batchAltVal)) {
      BatchAltInput.value = String(distVal(batchAltVal));
    }
  }
  if (BatchSpeedInput) {
    const batchSpeedVal = parseFloat(BatchSpeedInput.value);
    if (Number.isFinite(batchSpeedVal)) {
      BatchSpeedInput.value = String(speedVal(batchSpeedVal));
    }
  }
  if (NudgeStepInput) {
    const nudgeVal = parseFloat(NudgeStepInput.value);
    if (Number.isFinite(nudgeVal)) {
      NudgeStepInput.value = String(distVal(nudgeVal));
    }
  }
  if (OffsetDistanceInput) {
    const offsetVal = parseFloat(OffsetDistanceInput.value);
    if (Number.isFinite(offsetVal)) {
      OffsetDistanceInput.value = String(distVal(offsetVal));
    }
  }
  if (TerrainTargetInput) {
    const targetVal = parseFloat(TerrainTargetInput.value);
    if (Number.isFinite(targetVal)) {
      TerrainTargetInput.value = String(distVal(targetVal));
    }
  }
  if (TerrainMaxAltInput) {
    const maxAltVal = parseFloat(TerrainMaxAltInput.value);
    if (Number.isFinite(maxAltVal)) {
      TerrainMaxAltInput.value = String(distVal(maxAltVal));
    }
  }

  Waypoints.forEach((Wp) => {
    if (Number.isFinite(Wp.Alt)) {
      Wp.Alt = distVal(Wp.Alt);
    }
    if (Number.isFinite(Wp.Speed)) {
      Wp.Speed = speedVal(Wp.Speed);
    }
  });

  Waypoints.forEach((Wp) => {
    if (Wp.UseGlobalAlt) {
      Wp.Alt = SettingsState.globalAlt;
    }
    if (Wp.UseGlobalSpeed) {
      Wp.Speed = SettingsState.globalSpeed;
    }
  });

  if (Number.isFinite(SettingsState.terrainTargetAgl)) {
    SettingsState.terrainTargetAgl = distVal(SettingsState.terrainTargetAgl);
  }
  if (Number.isFinite(SettingsState.terrainMaxAlt)) {
    SettingsState.terrainMaxAlt = distVal(SettingsState.terrainMaxAlt);
  }
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
      RefreshMarkers();
      PushHistory();
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
      PushHistory();
    }
  });
}

if (ShowAltLabelsToggle) {
  ShowAltLabelsToggle.checked = SettingsState.showAltitudeLabels;
  ShowAltLabelsToggle.addEventListener("change", (Ev) => {
    SettingsState.showAltitudeLabels = Boolean(Ev.target.checked);
    RefreshMarkers();
    PushHistory();
  });
}

if (TerrainCorrectionToggle) {
  TerrainCorrectionToggle.checked = SettingsState.terrainCorrectionEnabled;
  TerrainCorrectionToggle.addEventListener("change", (Ev) => {
    SettingsState.terrainCorrectionEnabled = Boolean(Ev.target.checked);
    if (SettingsState.terrainCorrectionEnabled && typeof RequestTerrainCorrection === "function") {
      RequestTerrainCorrection();
    }
    PushHistory();
  });
}
if (TerrainTargetInput) {
  TerrainTargetInput.value = Number.isFinite(SettingsState.terrainTargetAgl)
    ? String(SettingsState.terrainTargetAgl)
    : "";
  TerrainTargetInput.addEventListener("change", (Ev) => {
    const val = parseFloat(Ev.target.value);
    if (Number.isFinite(val)) {
      SettingsState.terrainTargetAgl = val;
    } else {
      SettingsState.terrainTargetAgl = DEFAULT_ALT;
      TerrainTargetInput.value = String(DEFAULT_ALT);
    }
    if (SettingsState.terrainCorrectionEnabled && typeof RequestTerrainCorrection === "function") {
      RequestTerrainCorrection();
    }
    PushHistory();
  });
}
if (TerrainMaxAltInput) {
  TerrainMaxAltInput.value = Number.isFinite(SettingsState.terrainMaxAlt)
    ? String(SettingsState.terrainMaxAlt)
    : "";
  TerrainMaxAltInput.addEventListener("change", (Ev) => {
    const raw = String(Ev.target.value || "").trim();
    const val = raw === "" ? null : parseFloat(raw);
    if (raw === "") {
      SettingsState.terrainMaxAlt = null;
    } else if (Number.isFinite(val)) {
      SettingsState.terrainMaxAlt = val;
    } else {
      SettingsState.terrainMaxAlt = null;
      TerrainMaxAltInput.value = "";
    }
    if (SettingsState.terrainCorrectionEnabled && typeof RequestTerrainCorrection === "function") {
      RequestTerrainCorrection();
    }
    PushHistory();
  });
}

// Initial render for empty state
UpdateResolutionDisplay();
RenderAll();
PushHistory();

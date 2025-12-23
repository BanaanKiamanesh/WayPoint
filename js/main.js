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
  const key = Ev.key;
  const isMod = Ev.ctrlKey || Ev.metaKey;
  if (!isMod) return;

  const isUndo = (key === "z" || key === "Z") && !Ev.shiftKey;
  const isRedo =
    key === "y" ||
    key === "Y" ||
    ((key === "z" || key === "Z") && Ev.shiftKey);

  if (isUndo) {
    Ev.preventDefault();
    UndoHistory();
  } else if (isRedo) {
    Ev.preventDefault();
    RedoHistory();
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

if (EllipseResolutionInput) {
  EllipseResolutionInput.addEventListener("change", () => {
    if (EllipseMode === "circumference") {
      GenerateWaypointsFromDrawnShape();
      return;
    }
    PushHistory();
  });
}

if (EllipseRotationInput) {
  EllipseRotationInput.addEventListener("change", () => {
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

if (RotationInput) {
  RotationInput.addEventListener("input", UpdateToolsUi);
  RotationInput.addEventListener("change", () => {
    UpdateToolsUi();
    PushHistory();
  });
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
    PushHistory();
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
    ToolsPanelOpen = !ToolsPanelOpen;
    UpdateRightPanelUi();
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
        SettingsState.units = Ev.target.value;
        UpdateDistanceLabels();
        UpdateResolutionDisplay();
        RenderWaypointList();
        PushHistory();
      }
    });
  });
  UpdateDistanceLabels();
  UpdateResolutionDisplay();
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

// Initial render for empty state
UpdateResolutionDisplay();
RenderAll();
PushHistory();

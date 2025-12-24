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
  if (!Mode) return;
  if (ActiveDrawTool === Mode) {
    StopActiveDrawing();
    ActiveDrawTool = null;
    ActiveDrawMode = null;
    UpdateToolsUi();
    PushHistory();
    return;
  }

  if (!ConfirmReplaceBoundary()) {
    return;
  }

  StopActiveDrawing();
  ActiveDrawTool = Mode;
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
    PushHistory();
    return;
  } else {
    return;
  }

  ActiveDrawMode = Mode;
  ActiveDrawer.enable();
  UpdateToolsUi();
  PushHistory();
}

function UpdateRightPanelUi() {
  if (RightControlsWrap) {
    const anyOpen = ToolsPanelOpen || ManipulatePanelOpen || ExportPanelOpen;
    RightControlsWrap.classList.toggle("collapsed", !anyOpen);
    RightControlsWrap.classList.toggle("expanded", anyOpen);
    RightControlsWrap.classList.toggle("toolsOpen", ToolsPanelOpen);
    RightControlsWrap.classList.toggle("manipulateOpen", ManipulatePanelOpen);
    RightControlsWrap.classList.toggle("exportOpen", ExportPanelOpen);
  }
  if (ToggleToolsBtn) {
    ToggleToolsBtn.classList.toggle("active", ToolsPanelOpen);
  }
  if (ToggleManipulateBtn) {
    ToggleManipulateBtn.classList.toggle("active", ManipulatePanelOpen);
  }
  if (ExportDockBtn) {
    ExportDockBtn.classList.toggle("active", ExportPanelOpen);
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

function RotateSelectedWaypoints(AngleDeg) {
  const SelectedList = Waypoints.filter((Wp) => SelectedIds.has(Wp.Id));
  const AngleNum = parseFloat(AngleDeg);
  if (!Number.isFinite(AngleNum) || SelectedList.length < 2) return;
  const HeadingDelta = AngleNum;

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
    const HeadingVal = parseFloat(Wp.Heading);
    if (Number.isFinite(HeadingVal)) {
      Wp.Heading = ((HeadingVal + HeadingDelta) % 360 + 360) % 360;
    }
  });

  RenderAll();
  PushHistory();
}

function ReverseWaypointOrder() {
  if (Waypoints.length < 2) return;
  Waypoints.reverse();
  RenderAll();
  PushHistory();
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

function GetSpacingMeters() {
  if (!ShapeSpacingInput) return null;
  const ValNum = parseFloat(ShapeSpacingInput.value);
  return ConvertDistanceToMeters(ValNum);
}

function GetEllipseSpacingMeters() {
  if (!EllipseResolutionInput) return null;
  const ValNum = parseFloat(EllipseResolutionInput.value);
  return ConvertDistanceToMeters(ValNum);
}

function GetEllipseCenterLatLng(BoundaryFeature) {
  if (BoundaryFeature && typeof turf !== "undefined" && turf.centroid) {
    const CenterFeature = turf.centroid(BoundaryFeature);
    if (
      CenterFeature &&
      CenterFeature.geometry &&
      CenterFeature.geometry.coordinates &&
      CenterFeature.geometry.coordinates.length >= 2
    ) {
      const Coords = CenterFeature.geometry.coordinates;
      return L.latLng(Coords[1], Coords[0]);
    }
  }
  if (EllipseState && EllipseState.center) {
    return EllipseState.center;
  }
  return null;
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
  let LevelLabel = Level;
  if (LastCoverageModel && LastCoverageModel.baseStepVal !== undefined) {
    const spacingInfo = resolutionSpacingFromLevel(
      Level,
      LastCoverageModel.baseStepVal,
      LastCoverageModel.maxLevel || 0,
      LastCoverageModel.maxSpacing,
      LastCoverageModel.minSpacing
    );
    LevelLabel = spacingInfo.levelUsed;
    const photoSpacing = spacingInfo.spacing;
    const displaySpacing = ConvertMetersToDistance(photoSpacing);
    const unitLabel = GetDistanceUnitLabel();
    if (Number.isFinite(displaySpacing)) {
      SpacingInfo = ` (~${displaySpacing.toFixed(2)} ${unitLabel})`;
    }
  }

  ShapeResolutionValue.textContent = `Level ${LevelLabel}${SpacingInfo}`;
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
    AddWaypoint(ll[0], ll[1], {
      selectionMode: "add",
      skipRender: true,
      skipHistory: true,
    });
  });

  if (ShapeResolutionSlider) {
    ShapeResolutionSlider.value = String(Res.levelUsed);
  }
  UpdateResolutionDisplay(Res.levelUsed);
  RenderAll();
}

function GenerateWaypointsFromDrawnShape() {
  const SpacingMeters = GetSpacingMeters();
  const ShapeFeature = GetFirstDrawnFeature();
  if (!SpacingMeters || !ShapeFeature) return;

  const GeomType = ShapeFeature.geometry.type;
  if (GeomType === "LineString" || GeomType === "MultiLineString") {
    const pts = SampleLineFeature(ShapeFeature, SpacingMeters);
    if (!pts.length) return;
    const tolerance = Math.max(SpacingMeters * 0.5, 0.1);
    RemoveWaypointsNearLine(ShapeFeature, tolerance);
    SelectedIds.clear();
    pts.forEach((p) => {
      AddWaypoint(p[1], p[0], {
        selectionMode: "add",
        skipRender: true,
        skipHistory: true,
      });
    });
    LastCoverageModel = null;
    LastBoundaryFeature = ShapeFeature;
    RenderAll();
    PushHistory();
    return;
  }

  const BoundaryFeature = normalizeBoundaryFeature(ShapeFeature, SpacingMeters);
  if (!BoundaryFeature) return;

  // Ellipse circumference mode: drop waypoints along ellipse edge
  if (EllipseMode === "circumference") {
    const circSpacing = GetEllipseSpacingMeters();
    const rotDeg = parseFloat(EllipseRotationInput ? EllipseRotationInput.value : "0") || 0;
    const pts = ellipseCircumferenceWaypoints(BoundaryFeature, circSpacing, rotDeg);
    if (!pts.length) return;
    const ellipseCenter = GetEllipseCenterLatLng(BoundaryFeature);
    RemoveWaypointsInsideBoundary(BoundaryFeature);
    SelectedIds.clear();
    pts.forEach((p) => {
      const wp = AddWaypoint(p[1], p[0], {
        selectionMode: "add",
        skipRender: true,
        skipHistory: true,
      });
      wp.Speed = SettingsState.globalSpeed;
      wp.UseGlobalSpeed = true;
      if (ellipseCenter) {
        wp.Heading = bearingBetweenPoints({ lat: wp.Lat, lng: wp.Lon }, ellipseCenter);
      }
    });
    RenderAll();
    PushHistory();
    return;
  }

  const useEllipseOrientation = EllipseMode === "boundary" && EllipseState;
  const orientation = useEllipseOrientation
    ? EllipseBoundaryOrientation
    : PolygonOrientation;
  const Model = buildCoverageModelFromFeature(
    BoundaryFeature,
    SpacingMeters,
    orientation
  );
  if (!Model) return;

  LastCoverageModel = Model;
  LastBoundaryFeature = BoundaryFeature;

  const PreferredLevel = GetResolutionLevel() || 1;
  const LevelToUse = syncResolutionSlider(Model, PreferredLevel);

  applyCoverageModelAtLevel(Model, BoundaryFeature, LevelToUse);
  UpdateToolsUi();
  PushHistory();
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

function RemoveWaypointsNearLine(LineFeature, ToleranceMeters) {
  if (!LineFeature || typeof turf === "undefined") return;
  const TolMeters = Number.isFinite(ToleranceMeters) ? ToleranceMeters : 0;
  if (TolMeters <= 0) return;
  const Remaining = [];
  Waypoints.forEach((Wp) => {
    const DistKm = turf.pointToLineDistance(
      turf.point([Wp.Lon, Wp.Lat]),
      LineFeature,
      { units: "kilometers" }
    );
    const DistM = DistKm * 1000;
    if (DistM <= TolMeters) {
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
  const ActiveTool = ActiveDrawTool;
  const IsLineTool = ActiveTool === "polyline";
  const IsPolyTool = ActiveTool === "polygon";
  const IsEllipseTool = ActiveTool === "ellipse";
  const NeedsResolution = ActiveTool !== "polyline";
  const ShowEllipseOrientation = IsEllipseTool && EllipseMode === "boundary";
  const BoundaryLocked = BoundaryConfirmed;
  const ShowDrawOptions = Boolean(ToolsPanelOpen && ActiveTool);

  if (DrawOptionsPanel) {
    DrawOptionsPanel.classList.toggle("visible", ShowDrawOptions);
    DrawOptionsPanel.setAttribute("aria-hidden", ShowDrawOptions ? "false" : "true");
  }
  if (DrawOptionsTitle || DrawOptionsHint) {
    let TitleText = "Draw tools";
    let HintText = "Select a shape to begin";
    if (IsLineTool) {
      TitleText = "Line tools";
      HintText = "Spacing along the line";
    } else if (IsPolyTool) {
      TitleText = "Polygon tools";
      HintText = "Spacing and resolution";
    } else if (IsEllipseTool) {
      TitleText = "Ellipse tools";
      HintText = "Spacing and ellipse settings";
    }
    if (DrawOptionsTitle) {
      DrawOptionsTitle.textContent = TitleText;
    }
    if (DrawOptionsHint) {
      DrawOptionsHint.textContent = HintText;
    }
  }
  if (ShapeResolutionRow) {
    ShapeResolutionRow.style.display = IsLineTool ? "none" : "";
  }
  if (ShapeOrientationRow) {
    ShapeOrientationRow.style.display = IsPolyTool ? "" : "none";
  }
  if (EllipseOptionsSection) {
    EllipseOptionsSection.style.display = IsEllipseTool ? "block" : "none";
  }
  if (EllipseOrientationRow) {
    EllipseOrientationRow.style.display = ShowEllipseOrientation ? "" : "none";
  }

  if (GenerateFromShapeBtn) {
    GenerateFromShapeBtn.disabled =
      !HasShape ||
      !SpacingValid ||
      (NeedsResolution && !ResolutionValid) ||
      BoundaryLocked;
  }
  if (ClearShapesBtn) {
    ClearShapesBtn.disabled = !HasShape || BoundaryLocked;
  }
  if (ApplyRotationBtn) {
    ApplyRotationBtn.disabled = !(HasRotationSelection && AngleValid);
  }
  if (DrawLineBtn) {
    DrawLineBtn.classList.toggle("active", IsLineTool);
  }
  if (DrawPolygonBtn) {
    DrawPolygonBtn.classList.toggle("active", IsPolyTool);
  }
  if (DrawEllipseBtn) {
    DrawEllipseBtn.classList.toggle("active", IsEllipseTool);
  }
  if (ConfirmShapeBtn) {
    ConfirmShapeBtn.disabled = !HasShape || BoundaryLocked;
    ConfirmShapeBtn.classList.toggle("active", BoundaryConfirmed);
  }
  if (ShapeResolutionSlider) {
    ShapeResolutionSlider.disabled =
      !HasShape || BoundaryLocked || !LastCoverageModel || IsLineTool;
  }
  if (ShapeOrientationSelect) {
    ShapeOrientationSelect.value = PolygonOrientation || "auto";
    ShapeOrientationSelect.disabled = !HasShape || BoundaryLocked || !IsPolyTool;
  }
  if (EllipseOrientationSelect) {
    EllipseOrientationSelect.value = EllipseBoundaryOrientation || "auto";
    EllipseOrientationSelect.disabled =
      !HasShape || BoundaryLocked || !ShowEllipseOrientation;
  }
  if (ExportNowBtn) {
    ExportNowBtn.disabled = Waypoints.length === 0;
  }
  if (ReverseWaypointsBtn) {
    ReverseWaypointsBtn.disabled = Waypoints.length < 2;
  }
  if (EllipseModeBoundaryBtn && EllipseModeCircBtn) {
    EllipseModeBoundaryBtn.classList.toggle("active", EllipseMode === "boundary");
    EllipseModeCircBtn.classList.toggle("active", EllipseMode === "circumference");
  }
}

function RenderAll() {
  RenderWaypointList();
  RefreshMarkers();
  UpdatePolyline();
  UpdateToolsUi();
  UpdateLeftPanelUi();
  UpdateRightPanelUi();
}

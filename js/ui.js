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

function getNumericInputValue(InputEl) {
  if (!InputEl) return null;
  const raw = String(InputEl.value || "").trim();
  if (raw === "") return null;
  const val = parseFloat(raw);
  return Number.isFinite(val) ? val : null;
}

function convertSignedDistanceToMeters(val) {
  if (!Number.isFinite(val)) return null;
  return SettingsState.units === "imperial" ? val * METERS_PER_FOOT : val;
}

function ApplyPathHeadingsFromLatLngs(latLngs, waypoints) {
  if (
    typeof bearingBetweenPoints !== "function" ||
    !latLngs ||
    latLngs.length < 2 ||
    !waypoints ||
    waypoints.length !== latLngs.length
  ) {
    return;
  }

  let lastHeading = null;
  for (let i = 0; i < latLngs.length - 1; i++) {
    const cur = latLngs[i];
    const next = latLngs[i + 1];
    const heading = bearingBetweenPoints(
      { lat: cur[0], lng: cur[1] },
      { lat: next[0], lng: next[1] }
    );
    if (Number.isFinite(heading)) {
      waypoints[i].Heading = heading;
      lastHeading = heading;
    } else if (lastHeading !== null) {
      waypoints[i].Heading = lastHeading;
    }
  }
  if (lastHeading !== null) {
    waypoints[waypoints.length - 1].Heading = lastHeading;
  }
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

function GetAlignLineFeature() {
  const Feature = GetFirstDrawnFeature();
  if (!Feature || !Feature.geometry) return null;
  const geom = Feature.geometry;
  if (geom.type === "LineString") return Feature;
  if (geom.type === "MultiLineString" && geom.coordinates && geom.coordinates.length) {
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: geom.coordinates[0] },
      properties: Feature.properties || {},
    };
  }
  if (geom.type === "Polygon" && geom.coordinates && geom.coordinates.length) {
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: geom.coordinates[0] },
      properties: Feature.properties || {},
    };
  }
  if (geom.type === "MultiPolygon" && geom.coordinates && geom.coordinates.length) {
    const ring = geom.coordinates[0] && geom.coordinates[0][0];
    if (ring && ring.length) {
      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates: ring },
        properties: Feature.properties || {},
      };
    }
  }
  return null;
}

function ApplyBatchEditToSelected() {
  if (!SelectedIds.size) return;
  const altVal = getNumericInputValue(BatchAltInput);
  const speedVal = getNumericInputValue(BatchSpeedInput);
  const headingVal = getNumericInputValue(BatchHeadingInput);
  const gimbalVal = getNumericInputValue(BatchGimbalInput);

  if (
    altVal === null &&
    speedVal === null &&
    headingVal === null &&
    gimbalVal === null
  ) {
    return;
  }

  Waypoints.forEach((Wp) => {
    if (!SelectedIds.has(Wp.Id)) return;
    if (altVal !== null) {
      Wp.Alt = altVal;
      Wp.UseGlobalAlt = false;
    }
    if (speedVal !== null) {
      Wp.Speed = speedVal;
      Wp.UseGlobalSpeed = false;
    }
    if (headingVal !== null) {
      const clamped = Math.max(0, Math.min(360, headingVal));
      Wp.Heading = clamped;
    }
    if (gimbalVal !== null) {
      const clamped = Math.max(-90, Math.min(90, gimbalVal));
      Wp.Gimbal = clamped;
    }
  });

  RenderAll();
  PushHistory();
}

function ClearBatchEditInputs() {
  if (BatchAltInput) BatchAltInput.value = "";
  if (BatchSpeedInput) BatchSpeedInput.value = "";
  if (BatchHeadingInput) BatchHeadingInput.value = "";
  if (BatchGimbalInput) BatchGimbalInput.value = "";
  UpdateToolsUi();
}

function NudgeSelectedWaypoints(northMeters, eastMeters) {
  if (!SelectedIds.size) return;
  Waypoints.forEach((Wp) => {
    if (!SelectedIds.has(Wp.Id)) return;
    const shifted = offsetLatLngByMeters(Wp.Lat, Wp.Lon, northMeters, eastMeters);
    Wp.Lat = shifted.lat;
    Wp.Lon = shifted.lon;
  });
  RenderAll();
  PushHistory();
}

function OffsetSelectedWaypointsByBearing(distanceMeters, bearingDeg) {
  if (!SelectedIds.size) return;
  const bearingVal = Number.isFinite(bearingDeg) ? bearingDeg : 0;
  const rad = (bearingVal * Math.PI) / 180;
  const northMeters = Math.cos(rad) * distanceMeters;
  const eastMeters = Math.sin(rad) * distanceMeters;
  NudgeSelectedWaypoints(northMeters, eastMeters);
}

function AlignSelectedWaypointsToLine(offsetMeters) {
  if (!SelectedIds.size) return;
  if (typeof turf === "undefined" || !turf.nearestPointOnLine) return;
  const lineFeature = GetAlignLineFeature();
  if (!lineFeature) return;

  let lineToUse = lineFeature;
  if (Number.isFinite(offsetMeters) && offsetMeters !== 0 && turf.lineOffset) {
    const offsetKm = offsetMeters / 1000;
    lineToUse = turf.lineOffset(lineFeature, offsetKm, { units: "kilometers" });
  }

  if (!lineToUse) return;
  Waypoints.forEach((Wp) => {
    if (!SelectedIds.has(Wp.Id)) return;
    const pt = turf.nearestPointOnLine(
      lineToUse,
      [Wp.Lon, Wp.Lat],
      { units: "kilometers" }
    );
    if (pt && pt.geometry && pt.geometry.coordinates) {
      Wp.Lon = pt.geometry.coordinates[0];
      Wp.Lat = pt.geometry.coordinates[1];
    }
  });

  RenderAll();
  PushHistory();
}

function AlignSelectedWaypointsToPoi() {
  if (!SelectedIds.size || !SearchMarker) return;
  const target = SearchMarker.getLatLng();
  if (!target) return;

  const selected = Waypoints.filter((Wp) => SelectedIds.has(Wp.Id));
  if (!selected.length) return;

  const centerLat =
    selected.reduce((sum, Wp) => sum + Wp.Lat, 0) / selected.length;
  const centerLon =
    selected.reduce((sum, Wp) => sum + Wp.Lon, 0) / selected.length;

  if (typeof turf !== "undefined" && turf.toMercator && turf.toWgs84) {
    const targetMerc = turf.toMercator([target.lng, target.lat]);
    const centerMerc = turf.toMercator([centerLon, centerLat]);
    const dx = targetMerc[0] - centerMerc[0];
    const dy = targetMerc[1] - centerMerc[1];
    selected.forEach((Wp) => {
      const merc = turf.toMercator([Wp.Lon, Wp.Lat]);
      const wgs = turf.toWgs84([merc[0] + dx, merc[1] + dy]);
      Wp.Lat = wgs[1];
      Wp.Lon = wgs[0];
    });
  } else {
    const dLat = target.lat - centerLat;
    const dLon = target.lng - centerLon;
    selected.forEach((Wp) => {
      Wp.Lat += dLat;
      Wp.Lon += dLon;
    });
  }

  RenderAll();
  PushHistory();
}

function NudgeSelectionByDirection(direction) {
  const stepVal = getNumericInputValue(NudgeStepInput);
  const stepMeters = ConvertDistanceToMeters(stepVal);
  if (!Number.isFinite(stepMeters) || stepMeters <= 0) return;
  let north = 0;
  let east = 0;
  if (direction === "north") north = stepMeters;
  if (direction === "south") north = -stepMeters;
  if (direction === "east") east = stepMeters;
  if (direction === "west") east = -stepMeters;
  NudgeSelectedWaypoints(north, east);
}

function ApplyOffsetSelectionFromInputs() {
  const distVal = getNumericInputValue(OffsetDistanceInput);
  const distMeters = ConvertDistanceToMeters(distVal);
  if (!Number.isFinite(distMeters) || distMeters <= 0) return;
  const bearingVal = getNumericInputValue(OffsetBearingInput);
  OffsetSelectedWaypointsByBearing(distMeters, bearingVal || 0);
}

function ApplyAlignToLineFromInputs() {
  const offsetVal = getNumericInputValue(LineOffsetInput);
  const offsetMeters = convertSignedDistanceToMeters(offsetVal) || 0;
  AlignSelectedWaypointsToLine(offsetMeters);
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
  const newWaypoints = [];
  Res.latLngs.forEach((ll) => {
    const wp = AddWaypoint(ll[0], ll[1], {
      selectionMode: "add",
      skipRender: true,
      skipHistory: true,
    });
    newWaypoints.push(wp);
  });
  ApplyPathHeadingsFromLatLngs(Res.latLngs, newWaypoints);

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
    const latLngs = pts.map((p) => [p[1], p[0]]);
    const newWaypoints = [];
    latLngs.forEach((ll) => {
      const wp = AddWaypoint(ll[0], ll[1], {
        selectionMode: "add",
        skipRender: true,
        skipHistory: true,
      });
      newWaypoints.push(wp);
    });
    ApplyPathHeadingsFromLatLngs(latLngs, newWaypoints);
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
    RemoveWaypointsInsideBoundary(BoundaryFeature);
    SelectedIds.clear();
    const latLngs = pts.map((p) => [p[1], p[0]]);
    const newWaypoints = [];
    latLngs.forEach((ll) => {
      const wp = AddWaypoint(ll[0], ll[1], {
        selectionMode: "add",
        skipRender: true,
        skipHistory: true,
      });
      wp.Speed = SettingsState.globalSpeed;
      wp.UseGlobalSpeed = true;
      newWaypoints.push(wp);
    });
    ApplyPathHeadingsFromLatLngs(latLngs, newWaypoints);
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
  const HasSelection = SelectedIds.size > 0;
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
  const BatchHasValues = [
    getNumericInputValue(BatchAltInput),
    getNumericInputValue(BatchSpeedInput),
    getNumericInputValue(BatchHeadingInput),
    getNumericInputValue(BatchGimbalInput),
  ].some((Val) => Val !== null);
  const nudgeStepVal = getNumericInputValue(NudgeStepInput);
  const nudgeStepMeters = ConvertDistanceToMeters(nudgeStepVal);
  const nudgeValid = Number.isFinite(nudgeStepMeters) && nudgeStepMeters > 0;
  const offsetDistVal = getNumericInputValue(OffsetDistanceInput);
  const offsetDistMeters = ConvertDistanceToMeters(offsetDistVal);
  const offsetValid = Number.isFinite(offsetDistMeters) && offsetDistMeters > 0;
  const lineFeature = GetAlignLineFeature();
  const canAlignLine =
    HasSelection &&
    lineFeature &&
    typeof turf !== "undefined" &&
    typeof turf.nearestPointOnLine === "function";

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
  if (ApplyBatchEditBtn) {
    ApplyBatchEditBtn.disabled = !(HasSelection && BatchHasValues);
  }
  if (ClearBatchEditBtn) {
    ClearBatchEditBtn.disabled = !BatchHasValues;
  }
  if (NudgeNorthBtn) {
    const disable = !(HasSelection && nudgeValid);
    NudgeNorthBtn.disabled = disable;
    NudgeSouthBtn.disabled = disable;
    NudgeWestBtn.disabled = disable;
    NudgeEastBtn.disabled = disable;
  }
  if (ApplyOffsetBtn) {
    ApplyOffsetBtn.disabled = !(HasSelection && offsetValid);
  }
  if (AlignToLineBtn) {
    AlignToLineBtn.disabled = !canAlignLine;
  }
  if (AlignToPoiBtn) {
    AlignToPoiBtn.disabled = !(HasSelection && Boolean(SearchMarker));
  }
  if (LineOffsetInput) {
    LineOffsetInput.disabled = !lineFeature;
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

const MAX_HISTORY = 80;
const HistoryState = {
  stack: [],
  index: -1,
  isRestoring: false,
};

function CloneJson(Obj) {
  return Obj ? JSON.parse(JSON.stringify(Obj)) : Obj;
}

function SnapshotState() {
  const EllipseSnapshot =
    EllipseState && EllipseState.center
      ? {
          center: { lat: EllipseState.center.lat, lng: EllipseState.center.lng },
          rx: EllipseState.rx,
          ry: EllipseState.ry,
          rotationDeg: EllipseState.rotationDeg,
        }
      : null;

  return {
    waypoints: Waypoints.map((Wp) => ({ ...Wp })),
    selectedIds: Array.from(SelectedIds),
    expandedIds: Array.from(ExpandedIds),
    nextWaypointId: NextWaypointId,
    settings: { ...SettingsState },
    leftPanelOpen: LeftPanelOpen,
    activeLeftPane: ActiveLeftPane,
    toolsPanelOpen: ToolsPanelOpen,
    manipulatePanelOpen: ManipulatePanelOpen,
    exportPanelOpen: ExportPanelOpen,
    isWaypointPanelOpen: IsWaypointPanelOpen,
    boundaryConfirmed: BoundaryConfirmed,
    ellipseMode: EllipseMode,
    ellipseState: EllipseSnapshot,
    drawnItemsGeo: DrawnItems ? CloneJson(DrawnItems.toGeoJSON()) : null,
    lastBoundaryFeature: CloneJson(LastBoundaryFeature),
    lastCoverageModel: CloneJson(LastCoverageModel),
    shapeSpacingValue: ShapeSpacingInput ? ShapeSpacingInput.value : null,
    shapeResolution: ShapeResolutionSlider
      ? {
          min: ShapeResolutionSlider.min,
          max: ShapeResolutionSlider.max,
          step: ShapeResolutionSlider.step,
          value: ShapeResolutionSlider.value,
        }
      : null,
    ellipseResolutionValue: EllipseResolutionInput ? EllipseResolutionInput.value : null,
    ellipseRotationValue: EllipseRotationInput ? EllipseRotationInput.value : null,
    rotationValue: RotationInput ? RotationInput.value : null,
    exportFormatValue: ExportFormatSelect ? ExportFormatSelect.value : null,
  };
}

function ApplySnapshot(State) {
  if (!State) return;
  HistoryState.isRestoring = true;

  StopActiveDrawing();
  EllipseState = null;

  SettingsState.units = State.settings && State.settings.units ? State.settings.units : "metric";
  SettingsState.globalAlt =
    State.settings && Number.isFinite(State.settings.globalAlt)
      ? State.settings.globalAlt
      : DEFAULT_ALT;
  SettingsState.globalSpeed =
    State.settings && Number.isFinite(State.settings.globalSpeed)
      ? State.settings.globalSpeed
      : DEFAULT_SPEED;

  if (UnitRadios && UnitRadios.length) {
    UnitRadios.forEach((El) => {
      El.checked = El.value === SettingsState.units;
    });
  }
  if (GlobalAltInput) GlobalAltInput.value = SettingsState.globalAlt;
  if (GlobalSpeedInput) GlobalSpeedInput.value = SettingsState.globalSpeed;

  if (ShapeSpacingInput && State.shapeSpacingValue !== null) {
    ShapeSpacingInput.value = State.shapeSpacingValue;
  }
  if (ShapeResolutionSlider && State.shapeResolution) {
    ShapeResolutionSlider.min = State.shapeResolution.min;
    ShapeResolutionSlider.max = State.shapeResolution.max;
    ShapeResolutionSlider.step = State.shapeResolution.step;
    ShapeResolutionSlider.value = State.shapeResolution.value;
  }
  if (EllipseResolutionInput && State.ellipseResolutionValue !== null) {
    EllipseResolutionInput.value = State.ellipseResolutionValue;
  }
  if (EllipseRotationInput && State.ellipseRotationValue !== null) {
    EllipseRotationInput.value = State.ellipseRotationValue;
  }
  if (RotationInput && State.rotationValue !== null) {
    RotationInput.value = State.rotationValue;
  }
  if (ExportFormatSelect && State.exportFormatValue !== null) {
    ExportFormatSelect.value = State.exportFormatValue;
  }

  LeftPanelOpen = Boolean(State.leftPanelOpen);
  ActiveLeftPane = State.activeLeftPane || "waypoints";
  ToolsPanelOpen = Boolean(State.toolsPanelOpen);
  ManipulatePanelOpen = Boolean(State.manipulatePanelOpen);
  ExportPanelOpen = Boolean(State.exportPanelOpen);
  IsWaypointPanelOpen =
    State.isWaypointPanelOpen !== undefined ? State.isWaypointPanelOpen : true;
  BoundaryConfirmed = Boolean(State.boundaryConfirmed);
  EllipseMode = State.ellipseMode || "boundary";

  Waypoints.length = 0;
  (State.waypoints || []).forEach((Wp) => Waypoints.push({ ...Wp }));
  if (Number.isFinite(State.nextWaypointId)) {
    NextWaypointId = State.nextWaypointId;
  } else {
    const MaxId = Waypoints.reduce((Max, Wp) => {
      const Raw = String(Wp.Id || "");
      const Num = parseInt(Raw.replace("wp-", ""), 10);
      return Number.isFinite(Num) ? Math.max(Max, Num) : Max;
    }, 0);
    NextWaypointId = MaxId + 1;
  }

  SelectedIds.clear();
  (State.selectedIds || []).forEach((Id) => SelectedIds.add(Id));
  ExpandedIds.clear();
  (State.expandedIds || []).forEach((Id) => ExpandedIds.add(Id));

  DrawnItems.clearLayers();
  const Geo = State.drawnItemsGeo;
  if (Geo && Geo.features && Geo.features.length) {
    const useEllipseStyle = Boolean(State.ellipseState);
    const layerGroup = L.geoJSON(Geo, {
      style: (feature) => {
        if (!feature || !feature.geometry) return {};
        const type = feature.geometry.type;
        if (type === "LineString" || type === "MultiLineString") {
          return DrawOptions.polyline.shapeOptions;
        }
        if (type === "Polygon" || type === "MultiPolygon") {
          return useEllipseStyle ? ELLIPSE_STYLE : DrawOptions.polygon.shapeOptions;
        }
        return {};
      },
    });
    layerGroup.eachLayer((Layer) => DrawnItems.addLayer(Layer));
  }

  if (State.ellipseState && State.ellipseState.center) {
    EllipseState = {
      center: L.latLng(State.ellipseState.center.lat, State.ellipseState.center.lng),
      rx: State.ellipseState.rx,
      ry: State.ellipseState.ry,
      rotationDeg: State.ellipseState.rotationDeg,
      handles: [],
      moveHandler: null,
      clickHandler: null,
    };
    if (!DrawnItems.getLayers().length) {
      updateEllipseLayer();
    }
    refreshHandles();
  }

  LastBoundaryFeature = CloneJson(State.lastBoundaryFeature);
  LastCoverageModel = CloneJson(State.lastCoverageModel);

  UpdateDistanceLabels();
  UpdateResolutionDisplay();
  RenderAll();

  HistoryState.isRestoring = false;
}

function PushHistory() {
  if (HistoryState.isRestoring) return;
  const Snapshot = SnapshotState();
  if (HistoryState.index < HistoryState.stack.length - 1) {
    HistoryState.stack = HistoryState.stack.slice(0, HistoryState.index + 1);
  }
  HistoryState.stack.push(Snapshot);
  HistoryState.index = HistoryState.stack.length - 1;
  if (HistoryState.stack.length > MAX_HISTORY) {
    HistoryState.stack.shift();
    HistoryState.index -= 1;
  }
}

function UndoHistory() {
  if (HistoryState.index <= 0) return;
  HistoryState.index -= 1;
  ApplySnapshot(HistoryState.stack[HistoryState.index]);
}

function RedoHistory() {
  if (HistoryState.index >= HistoryState.stack.length - 1) return;
  HistoryState.index += 1;
  ApplySnapshot(HistoryState.stack[HistoryState.index]);
}

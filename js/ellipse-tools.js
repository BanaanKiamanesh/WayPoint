function clearEllipseHandles() {
  if (EllipseState && EllipseState.handles) {
    EllipseState.handles.forEach((h) => MapObj.removeLayer(h));
    EllipseState.handles = [];
  }
  if (EllipseState && EllipseState.moveHandler) {
    MapObj.off("mousemove", EllipseState.moveHandler);
    EllipseState.moveHandler = null;
  }
  if (EllipseState && EllipseState.clickHandler) {
    MapObj.off("click", EllipseState.clickHandler);
    EllipseState.clickHandler = null;
  }
}

function updateEllipseLayer() {
  if (!EllipseState || !EllipseState.center) return;
  const rx = EllipseState.rx || 10;
  const ry = EllipseState.ry || 10;
  const rotation = EllipseState.rotationDeg || 0;
  const segments = getEllipseSegments(EllipseState.center, rx, ry);
  const pts = computeEllipsePoints(
    [EllipseState.center.lat, EllipseState.center.lng],
    rx,
    ry,
    rotation,
    segments
  );

  if (!EllipseState.layer) {
    EllipseState.layer = L.polygon(pts, ELLIPSE_STYLE);
    DrawnItems.clearLayers();
    DrawnItems.addLayer(EllipseState.layer);
  } else {
    EllipseState.layer.setLatLngs(pts);
    if (!DrawnItems.hasLayer(EllipseState.layer)) {
      DrawnItems.clearLayers();
      DrawnItems.addLayer(EllipseState.layer);
    }
  }

  LastBoundaryFeature = EllipseState.layer.toGeoJSON();
  LastCoverageModel = null;
}

function createHandle(latlng, onDrag, onDragEnd, variant = "default") {
  const isRotation = variant === "rotate";
  const html = isRotation
    ? '<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:#ff8c00;font-size:18px;transform:rotate(-20deg);text-shadow:0 0 6px rgba(0,0,0,0.6);">&#8635;</div>'
    : '<div class="drawVertexDot"></div>';
  const marker = L.marker(latlng, {
    draggable: true,
    icon: L.divIcon({
      className: isRotation ? "ellipseHandle" : "ellipseHandle drawVertexIcon",
      html,
      iconSize: isRotation ? [22, 22] : [16, 16],
      iconAnchor: isRotation ? [11, 11] : [8, 8],
    }),
  });
  if (onDrag) marker.on("drag", (ev) => onDrag(ev.latlng));
  if (onDragEnd) {
    marker.on("dragend", (ev) => {
      onDragEnd(ev.latlng);
      PushHistory();
    });
  }
  marker.addTo(MapObj);
  return marker;
}

function wrapLngNearCenter(lng, centerLng) {
  const diff = lng - centerLng;
  const wrapped = ((diff + 180) % 360 + 360) % 360 - 180;
  return centerLng + wrapped;
}

function wrapLatLngNearCenter(latlng, center) {
  return L.latLng(latlng.lat, wrapLngNearCenter(latlng.lng, center.lng));
}

function getEllipseSegments(center, rx, ry) {
  if (!MapObj || !center) return 360;
  const centerPt = MapObj.latLngToLayerPoint(center);
  const east = wrapLatLngNearCenter(localMetersToLatLng(center, rx, 0), center);
  const north = wrapLatLngNearCenter(localMetersToLatLng(center, 0, ry), center);
  const eastPt = MapObj.latLngToLayerPoint(east);
  const northPt = MapObj.latLngToLayerPoint(north);
  const rxPx = Math.max(1, Math.abs(eastPt.x - centerPt.x));
  const ryPx = Math.max(1, Math.abs(northPt.y - centerPt.y));
  const approxCirc =
    Math.PI * (3 * (rxPx + ryPx) - Math.sqrt((3 * rxPx + ryPx) * (rxPx + 3 * ryPx)));
  const segments = Math.ceil(approxCirc / 0.6);
  return Math.min(Math.max(segments, 360), 20000);
}

function refreshHandles() {
  if (!EllipseState) return;
  clearEllipseHandles();
  const center = EllipseState.center;
  if (!center) return;
  const rotRad = (EllipseState.rotationDeg || 0) * (Math.PI / 180);
  const rx = EllipseState.rx || 10;
  const ry = EllipseState.ry || 10;

  const axisX = rotateXY(rx, 0, rotRad);
  const axisY = rotateXY(0, ry, rotRad);
  const rotVec = rotateXY(rx * 1.2, 0, rotRad);

  const east = wrapLatLngNearCenter(localMetersToLatLng(center, axisX[0], axisX[1]), center);
  const north = wrapLatLngNearCenter(localMetersToLatLng(center, axisY[0], axisY[1]), center);
  const rotHandle = wrapLatLngNearCenter(localMetersToLatLng(center, rotVec[0], rotVec[1]), center);

  const centerHandle = createHandle(
    center,
    (ll) => {
      EllipseState.center = wrapLatLngNearCenter(ll, EllipseState.center || ll);
      updateEllipseLayer();
      syncEllipseHandles();
    },
    () => refreshHandles()
  );

  const rxHandle = createHandle(
    east,
    (ll) => {
      const centerNow = EllipseState.center;
      if (!centerNow) return;
      const wrapped = wrapLatLngNearCenter(ll, centerNow);
      const rotNow = ((EllipseState.rotationDeg || 0) * Math.PI) / 180;
      const { x, y } = latLngToLocalMeters(centerNow, wrapped);
      const [xr] = rotateXY(x, y, -rotNow);
      EllipseState.rx = Math.max(1, Math.abs(xr));
      updateEllipseLayer();
      syncEllipseHandles();
    },
    () => refreshHandles()
  );

  const ryHandle = createHandle(
    north,
    (ll) => {
      const centerNow = EllipseState.center;
      if (!centerNow) return;
      const wrapped = wrapLatLngNearCenter(ll, centerNow);
      const rotNow = ((EllipseState.rotationDeg || 0) * Math.PI) / 180;
      const { x, y } = latLngToLocalMeters(centerNow, wrapped);
      const [, yr] = rotateXY(x, y, -rotNow);
      EllipseState.ry = Math.max(1, Math.abs(yr));
      updateEllipseLayer();
      syncEllipseHandles();
    },
    () => refreshHandles()
  );

  const rotHandleMarker = createHandle(
    rotHandle,
    (ll) => {
      const centerNow = EllipseState.center;
      if (!centerNow) return;
      const wrapped = wrapLatLngNearCenter(ll, centerNow);
      const { x, y } = latLngToLocalMeters(centerNow, wrapped);
      const ang = (Math.atan2(y, x) * 180) / Math.PI;
      EllipseState.rotationDeg = (ang + 360) % 360;
      updateEllipseLayer();
      syncEllipseHandles();
    },
    () => refreshHandles(),
    "rotate"
  );

  EllipseState.handles.push(centerHandle, rxHandle, ryHandle, rotHandleMarker);
}

function syncEllipseHandles() {
  if (!EllipseState || !EllipseState.center || !EllipseState.handles || EllipseState.handles.length < 4)
    return;
  const center = EllipseState.center;
  const rotRad = (EllipseState.rotationDeg || 0) * (Math.PI / 180);
  const rx = EllipseState.rx || 10;
  const ry = EllipseState.ry || 10;
  const axisX = rotateXY(rx, 0, rotRad);
  const axisY = rotateXY(0, ry, rotRad);
  const rotVec = rotateXY(rx * 1.2, 0, rotRad);

  const centerHandle = EllipseState.handles[0];
  const rxHandle = EllipseState.handles[1];
  const ryHandle = EllipseState.handles[2];
  const rotHandle = EllipseState.handles[3];

  if (centerHandle) centerHandle.setLatLng(center);
  if (rxHandle) {
    rxHandle.setLatLng(
      wrapLatLngNearCenter(localMetersToLatLng(center, axisX[0], axisX[1]), center)
    );
  }
  if (ryHandle) {
    ryHandle.setLatLng(
      wrapLatLngNearCenter(localMetersToLatLng(center, axisY[0], axisY[1]), center)
    );
  }
  if (rotHandle) {
    rotHandle.setLatLng(
      wrapLatLngNearCenter(localMetersToLatLng(center, rotVec[0], rotVec[1]), center)
    );
  }
}

function startEllipseInteraction() {
  EllipseState = {
    center: null,
    rx: 30,
    ry: 30,
    rotationDeg: 0,
    layer: null,
    handles: [],
    moveHandler: null,
    clickHandler: null,
  };
  let step = 0;

  const clickHandler = (ev) => {
    if (ActiveDrawMode !== "ellipse") return;
    if (step === 0) {
      EllipseState.center = ev.latlng;
      // live preview radius: follow mouse
      const moveHandler = (mv) => {
        if (!EllipseState.center) return;
        const wrapped = wrapLatLngNearCenter(mv.latlng, EllipseState.center);
        const { x, y } = latLngToLocalMeters(EllipseState.center, wrapped);
        const dist = Math.sqrt(x * x + y * y);
        EllipseState.rx = Math.max(1, dist);
        EllipseState.ry = Math.max(1, dist);
        updateEllipseLayer();
      };
      EllipseState.moveHandler = moveHandler;
      MapObj.on("mousemove", moveHandler);
      step = 1;
    } else if (step === 1) {
      const wrapped = wrapLatLngNearCenter(ev.latlng, EllipseState.center);
      const { x, y } = latLngToLocalMeters(EllipseState.center, wrapped);
      const dist = Math.sqrt(x * x + y * y);
      EllipseState.rx = Math.max(1, dist);
      EllipseState.ry = EllipseState.rx;
      updateEllipseLayer();
      refreshHandles();
      if (EllipseState.moveHandler) {
        MapObj.off("mousemove", EllipseState.moveHandler);
        EllipseState.moveHandler = null;
      }
      step = 2;
      ActiveDrawMode = null;
      MapObj.off("click", clickHandler);
      EllipseState.clickHandler = null;
      UpdateToolsUi();
      PushHistory();
    }
  };

  EllipseState.clickHandler = clickHandler;
  MapObj.on("click", clickHandler);
}

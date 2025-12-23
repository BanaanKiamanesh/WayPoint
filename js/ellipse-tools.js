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
  const pts = computeEllipsePoints(
    [EllipseState.center.lat, EllipseState.center.lng],
    EllipseState.rx || 10,
    EllipseState.ry || 10,
    EllipseState.rotationDeg || 0
  );
  DrawnItems.clearLayers();
  const poly = L.polygon(pts, ELLIPSE_STYLE);
  DrawnItems.addLayer(poly);
  LastBoundaryFeature = poly.toGeoJSON();
  LastCoverageModel = null;
}

function createHandle(latlng, onDrag, onDragEnd, variant = "default") {
  const isRotation = variant === "rotate";
  const html = isRotation
    ? '<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:#ff8c00;font-size:18px;transform:rotate(-20deg);text-shadow:0 0 6px rgba(0,0,0,0.6);">&#8635;</div>'
    : '<div style="width:12px;height:12px;border-radius:6px;background:#ff8c00;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>';
  const marker = L.marker(latlng, {
    draggable: true,
    icon: L.divIcon({
      className: "ellipseHandle",
      html,
      iconSize: isRotation ? [22, 22] : [14, 14],
      iconAnchor: isRotation ? [11, 11] : [7, 7],
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

function refreshHandles() {
  if (!EllipseState) return;
  clearEllipseHandles();
  const center = EllipseState.center;
  if (!center) return;
  const rotRad = (EllipseState.rotationDeg || 0) * (Math.PI / 180);
  const rx = EllipseState.rx || 10;
  const ry = EllipseState.ry || 10;

  // Axis end points in local frame, then rotate to world
  const axisX = rotateXY(rx, 0, rotRad);
  const axisY = rotateXY(0, ry, rotRad);
  const rotVec = rotateXY(rx * 1.2, 0, rotRad);

  const east = localMetersToLatLng(center, axisX[0], axisX[1]);
  const north = localMetersToLatLng(center, axisY[0], axisY[1]);
  const rotHandle = localMetersToLatLng(center, rotVec[0], rotVec[1]);

  const centerHandle = createHandle(
    center,
    (ll) => {
      EllipseState.center = ll;
      updateEllipseLayer();
    },
    () => refreshHandles()
  );

  const rxHandle = createHandle(
    east,
    (ll) => {
      const { x, y } = latLngToLocalMeters(center, ll);
      const [xr] = rotateXY(x, y, -rotRad);
      EllipseState.rx = Math.max(1, Math.abs(xr));
      updateEllipseLayer();
      const snappedVec = rotateXY(EllipseState.rx, 0, rotRad);
      rxHandle.setLatLng(localMetersToLatLng(center, snappedVec[0], snappedVec[1]));
    },
    () => refreshHandles()
  );

  const ryHandle = createHandle(
    north,
    (ll) => {
      const { x, y } = latLngToLocalMeters(center, ll);
      const [, yr] = rotateXY(x, y, -rotRad);
      EllipseState.ry = Math.max(1, Math.abs(yr));
      updateEllipseLayer();
      const vec = rotateXY(0, EllipseState.ry, rotRad);
      ryHandle.setLatLng(localMetersToLatLng(center, vec[0], vec[1]));
    },
    () => refreshHandles()
  );

  const rotHandleMarker = createHandle(
    rotHandle,
    (ll) => {
      const { x, y } = latLngToLocalMeters(center, ll);
      const ang = (Math.atan2(y, x) * 180) / Math.PI;
      EllipseState.rotationDeg = (ang + 360) % 360;
      updateEllipseLayer();
      const vec = rotateXY(rx * 1.2, 0, (EllipseState.rotationDeg * Math.PI) / 180);
      rotHandleMarker.setLatLng(localMetersToLatLng(center, vec[0], vec[1]));
    },
    () => refreshHandles(),
    "rotate"
  );

  EllipseState.handles.push(centerHandle, rxHandle, ryHandle, rotHandleMarker);
}

function startEllipseInteraction() {
  EllipseState = {
    center: null,
    rx: 30,
    ry: 30,
    rotationDeg: 0,
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
        const dist =
          turf.distance(
            [EllipseState.center.lng, EllipseState.center.lat],
            [mv.latlng.lng, mv.latlng.lat],
            { units: "kilometers" }
          ) * 1000;
        EllipseState.rx = Math.max(1, dist);
        EllipseState.ry = Math.max(1, dist);
        updateEllipseLayer();
      };
      EllipseState.moveHandler = moveHandler;
      MapObj.on("mousemove", moveHandler);
      step = 1;
    } else if (step === 1) {
      const d = turf.distance(
        [EllipseState.center.lng, EllipseState.center.lat],
        [ev.latlng.lng, ev.latlng.lat],
        { units: "kilometers" }
      );
      EllipseState.rx = Math.max(1, d * 1000);
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

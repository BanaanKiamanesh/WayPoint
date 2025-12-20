// Ellipse utilities
function rotateXY(x, y, angleRad) {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  return [x * cosA - y * sinA, x * sinA + y * cosA];
}

function latLngToLocalMeters(center, ll) {
  const c = turf.toMercator([center.lng, center.lat]);
  const p = turf.toMercator([ll.lng, ll.lat]);
  return { x: p[0] - c[0], y: p[1] - c[1] };
}

function localMetersToLatLng(center, x, y) {
  const c = turf.toMercator([center.lng, center.lat]);
  const wgs = turf.toWgs84([c[0] + x, c[1] + y]);
  return L.latLng(wgs[1], wgs[0]);
}

function computeEllipsePoints(center, rx, ry, rotationDeg, segments = 180) {
  const pts = [];
  const rotRad = (rotationDeg * Math.PI) / 180;
  const centerMerc = turf.toMercator([center[1], center[0]]);
  for (let i = 0; i <= segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const x = rx * Math.cos(theta);
    const y = ry * Math.sin(theta);
    const xr = x * Math.cos(rotRad) - y * Math.sin(rotRad);
    const yr = x * Math.sin(rotRad) + y * Math.cos(rotRad);
    const wgs = turf.toWgs84([centerMerc[0] + xr, centerMerc[1] + yr]);
    pts.push([wgs[1], wgs[0]]);
  }
  return pts;
}

function bearingBetweenPoints(latlngA, latlngB) {
  const lat1 = (latlngA.lat * Math.PI) / 180;
  const lat2 = (latlngB.lat * Math.PI) / 180;
  const dLon = ((latlngB.lng - latlngA.lng) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

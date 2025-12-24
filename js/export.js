function formatKmlNumber(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return "0";
  return num.toFixed(7);
}

function getWaypointAltitudeMeters(Wp) {
  const alt = Number(Wp && Wp.Alt);
  if (!Number.isFinite(alt)) return 0;
  return SettingsState.units === "imperial" ? alt * METERS_PER_FOOT : alt;
}

function buildKmlForWaypoints() {
  const placemarks = Waypoints.map((Wp, idx) => {
    const name = EscapeHtml("Waypoint " + (idx + 1));
    const lon = formatKmlNumber(Wp.Lon);
    const lat = formatKmlNumber(Wp.Lat);
    const alt = formatKmlNumber(getWaypointAltitudeMeters(Wp));

    return (
      "    <Placemark>\n" +
      "      <name>" +
      name +
      "</name>\n" +
      "      <Point>\n" +
      "        <altitudeMode>absolute</altitudeMode>\n" +
      "        <coordinates>" +
      lon +
      "," +
      lat +
      "," +
      alt +
      "</coordinates>\n" +
      "      </Point>\n" +
      "    </Placemark>"
    );
  }).join("\n");

  const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const body =
    '<kml xmlns="http://www.opengis.net/kml/2.2">\n' +
    "  <Document>\n" +
    "    <name>Waypoints</name>\n" +
    (placemarks ? placemarks + "\n" : "") +
    "  </Document>\n" +
    "</kml>\n";
  return header + body;
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function downloadBlobFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function ExportWaypointsToKml() {
  const kml = buildKmlForWaypoints();
  const filename = "waypoints.kml";
  downloadTextFile(filename, kml, "application/vnd.google-earth.kml+xml");
}

async function ExportWaypointsToKmz() {
  if (typeof JSZip === "undefined") {
    ExportWaypointsToKml();
    return;
  }
  const kml = buildKmlForWaypoints();
  const zip = new JSZip();
  zip.file("doc.kml", kml);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.google-earth.kmz",
  });
  downloadBlobFile("waypoints.kmz", blob);
}

async function ExportWaypoints(format) {
  const fmt = String(format || "kml").toLowerCase();
  try {
    if (fmt === "kmz") {
      await ExportWaypointsToKmz();
      return;
    }
    ExportWaypointsToKml();
  } catch (Err) {
    console.error("Export failed", Err);
  }
}

function parseKmlCoordinateText(text) {
  if (!text) return [];
  const chunks = text.trim().split(/\s+/);
  const coords = [];
  chunks.forEach((chunk) => {
    if (!chunk) return;
    const parts = chunk.split(",");
    if (parts.length < 2) return;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    const hasAlt = parts.length >= 3 && parts[2] !== "";
    const alt = hasAlt ? parseFloat(parts[2]) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    coords.push({
      lat,
      lon,
      alt: Number.isFinite(alt) ? alt : null,
      altProvided: hasAlt && Number.isFinite(alt),
    });
  });
  return coords;
}

function extractWaypointsFromKml(kmlText) {
  if (!kmlText) return [];
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(kmlText, "application/xml");
  if (xmlDoc.getElementsByTagName("parsererror").length) return [];

  const coords = [];
  const pointNodes = xmlDoc.getElementsByTagName("Point");
  if (pointNodes.length) {
    for (let i = 0; i < pointNodes.length; i++) {
      const point = pointNodes[i];
      const coordNodes = point.getElementsByTagName("coordinates");
      for (let j = 0; j < coordNodes.length; j++) {
        coords.push(...parseKmlCoordinateText(coordNodes[j].textContent || ""));
      }
    }
    return coords;
  }

  const coordNodes = xmlDoc.getElementsByTagName("coordinates");
  for (let i = 0; i < coordNodes.length; i++) {
    coords.push(...parseKmlCoordinateText(coordNodes[i].textContent || ""));
  }
  return coords;
}

function clearWaypointsForImport() {
  Waypoints.length = 0;
  SelectedIds.clear();
  ExpandedIds.clear();
  for (const [, Marker] of MarkerById.entries()) {
    MapObj.removeLayer(Marker);
  }
  MarkerById.clear();
}

function focusMapOnImported(coords) {
  if (!coords.length || !MapObj) return;
  if (coords.length === 1) {
    MapObj.setView([coords[0].lat, coords[0].lon], MapObj.getZoom());
    return;
  }
  const bounds = L.latLngBounds(coords.map((c) => [c.lat, c.lon]));
  MapObj.fitBounds(bounds.pad(0.15));
}

function applyImportedWaypoints(coords) {
  if (!coords || !coords.length) return;
  const shouldReplace = !Waypoints.length || window.confirm("Replace existing waypoints?");
  if (shouldReplace) {
    clearWaypointsForImport();
  }

  SelectedIds.clear();
  coords.forEach((coord) => {
    const wp = AddWaypoint(coord.lat, coord.lon, {
      selectionMode: "add",
      skipRender: true,
      skipHistory: true,
    });
    if (coord.altProvided) {
      const altVal =
        SettingsState.units === "imperial"
          ? coord.alt / METERS_PER_FOOT
          : coord.alt;
      wp.Alt = altVal;
      wp.UseGlobalAlt = false;
    }
  });

  RenderAll();
  focusMapOnImported(coords);
  PushHistory();
}

async function ImportWaypointsFromFile(file) {
  if (!file) return;
  const name = (file.name || "").toLowerCase();
  let kmlText = "";

  if (name.endsWith(".kmz")) {
    if (typeof JSZip === "undefined") {
      alert("KMZ import requires JSZip.");
      return;
    }
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlFiles = zip.file(/\.kml$/i);
    if (!kmlFiles || !kmlFiles.length) {
      alert("No KML file found in KMZ.");
      return;
    }
    const docKml =
      kmlFiles.find((entry) => entry.name.toLowerCase().endsWith("doc.kml")) || kmlFiles[0];
    kmlText = await docKml.async("text");
  } else if (name.endsWith(".kml")) {
    kmlText = await file.text();
  } else {
    alert("Unsupported file type. Please use KML or KMZ.");
    return;
  }

  const coords = extractWaypointsFromKml(kmlText);
  if (!coords.length) {
    alert("No waypoints found in file.");
    return;
  }
  applyImportedWaypoints(coords);
}

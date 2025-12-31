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

function formatCsvNumber(val, decimals) {
  const num = Number(val);
  if (!Number.isFinite(num)) return "";
  if (Number.isFinite(decimals)) return num.toFixed(decimals);
  return String(num);
}

const WPML_NS = "http://www.dji.com/wpmz/1.0.2";
const DJI_DEFAULT_DRONE_ENUM = 77; // Mavic 3 Enterprise series (best-effort default)
const DJI_DEFAULT_DRONE_SUB = 0;
const DJI_DEFAULT_PAYLOAD_ENUM = 66; // M3E camera (best-effort default)
const DJI_DEFAULT_PAYLOAD_POS = 0;
const DJI_DEFAULT_RTH_HEIGHT_M = 100;
const DJI_DEFAULT_SAFE_HEIGHT_M = 20;

function clampNumber(val, min, max, fallback) {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function formatWpmlNumber(val, decimals) {
  const num = Number(val);
  if (!Number.isFinite(num)) return "0";
  const places = Number.isFinite(decimals) ? decimals : 2;
  return num.toFixed(places);
}

function toMetersDistance(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return SettingsState.units === "imperial" ? num * METERS_PER_FOOT : num;
}

function toSpeedMs(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return SettingsState.units === "imperial" ? num * MS_PER_MPH : num;
}

function getGlobalAltMeters() {
  return toMetersDistance(SettingsState.globalAlt);
}

function getGlobalSpeedMs() {
  const speedMs = toSpeedMs(SettingsState.globalSpeed);
  return clampNumber(speedMs, 1, 15, 5);
}

function getWaypointAltMeters(Wp, globalAltMeters) {
  if (!Wp) return 0;
  if (Wp.UseGlobalAlt) return globalAltMeters;
  return toMetersDistance(Wp.Alt);
}

function getWaypointSpeedMs(Wp, globalSpeedMs) {
  if (!Wp) return globalSpeedMs;
  if (Wp.UseGlobalSpeed) return globalSpeedMs;
  const speedMs = toSpeedMs(Wp.Speed);
  return clampNumber(speedMs, 1, 15, globalSpeedMs);
}

function getWpmlTurnSettings() {
  const isStraight =
    ExportPathModeSelect && ExportPathModeSelect.value === "straight";
  if (isStraight) {
    return {
      turnMode: "toPointAndStopWithDiscontinuityCurvature",
      useStraightLine: null,
      includeUseStraightLine: false,
      turnDampingDist: null,
    };
  }
  return {
    turnMode: "toPointAndStopWithContinuityCurvature",
    useStraightLine: 0,
    includeUseStraightLine: true,
    turnDampingDist: null,
  };
}

function buildWpmlHeadingParam(indent) {
  const lines = [];
  lines.push(indent + "<wpml:waypointHeadingParam>");
  lines.push(
    indent + "  <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>"
  );
  lines.push(
    indent + "  <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>"
  );
  lines.push(indent + "</wpml:waypointHeadingParam>");
  return lines.join("\n");
}

function buildWpmlTurnParam(indent, turnMode, turnDampingDist) {
  const lines = [];
  lines.push(indent + "<wpml:waypointTurnParam>");
  lines.push(
    indent + "  <wpml:waypointTurnMode>" + turnMode + "</wpml:waypointTurnMode>"
  );
  if (Number.isFinite(turnDampingDist)) {
    lines.push(
      indent +
        "  <wpml:waypointTurnDampingDist>" +
        formatWpmlNumber(turnDampingDist, 1) +
        "</wpml:waypointTurnDampingDist>"
    );
  }
  lines.push(indent + "</wpml:waypointTurnParam>");
  return lines.join("\n");
}

function buildWpmlMissionConfig(indent, takeoffRefPoint, takeoffRefPointAgl) {
  const globalSpeedMs = getGlobalSpeedMs();
  const safeHeight = clampNumber(DJI_DEFAULT_SAFE_HEIGHT_M, 1.2, 1500, 20);
  const rthHeight = clampNumber(DJI_DEFAULT_RTH_HEIGHT_M, 2, 1500, 100);
  const finishAction =
    typeof GetMissionFinishActionValue === "function"
      ? GetMissionFinishActionValue()
      : "hover";
  const lines = [];
  lines.push(indent + "<wpml:missionConfig>");
  lines.push(indent + "  <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>");
  lines.push(indent + "  <wpml:finishAction>" + finishAction + "</wpml:finishAction>");
  lines.push(indent + "  <wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>");
  lines.push(indent + "  <wpml:executeRCLostAction>hover</wpml:executeRCLostAction>");
  lines.push(
    indent + "  <wpml:takeOffSecurityHeight>" + formatWpmlNumber(safeHeight, 1) + "</wpml:takeOffSecurityHeight>"
  );
  if (takeoffRefPoint) {
    lines.push(indent + "  <wpml:takeOffRefPoint>" + takeoffRefPoint + "</wpml:takeOffRefPoint>");
  }
  if (Number.isFinite(takeoffRefPointAgl)) {
    lines.push(
      indent +
        "  <wpml:takeOffRefPointAGLHeight>" +
        formatWpmlNumber(takeoffRefPointAgl, 1) +
        "</wpml:takeOffRefPointAGLHeight>"
    );
  }
  lines.push(
    indent +
      "  <wpml:globalTransitionalSpeed>" +
      formatWpmlNumber(globalSpeedMs, 2) +
      "</wpml:globalTransitionalSpeed>"
  );
  lines.push(
    indent +
      "  <wpml:globalRTHHeight>" +
      formatWpmlNumber(rthHeight, 1) +
      "</wpml:globalRTHHeight>"
  );
  lines.push(indent + "  <wpml:droneInfo>");
  lines.push(
    indent + "    <wpml:droneEnumValue>" + DJI_DEFAULT_DRONE_ENUM + "</wpml:droneEnumValue>"
  );
  lines.push(
    indent + "    <wpml:droneSubEnumValue>" + DJI_DEFAULT_DRONE_SUB + "</wpml:droneSubEnumValue>"
  );
  lines.push(indent + "  </wpml:droneInfo>");
  lines.push(indent + "  <wpml:payloadInfo>");
  lines.push(
    indent + "    <wpml:payloadEnumValue>" + DJI_DEFAULT_PAYLOAD_ENUM + "</wpml:payloadEnumValue>"
  );
  lines.push(
    indent +
      "    <wpml:payloadPositionIndex>" +
      DJI_DEFAULT_PAYLOAD_POS +
      "</wpml:payloadPositionIndex>"
  );
  lines.push(indent + "  </wpml:payloadInfo>");
  lines.push(indent + "</wpml:missionConfig>");
  return lines.join("\n");
}

function buildWpmlTemplateKml() {
  const now = Date.now();
  const globalAltMeters = getGlobalAltMeters();
  const globalSpeedMs = getGlobalSpeedMs();
  const { turnMode, useStraightLine, includeUseStraightLine } = getWpmlTurnSettings();
  const takeoffPoint =
    Waypoints.length > 0
      ? [
          formatWpmlNumber(Waypoints[0].Lat, 6),
          formatWpmlNumber(Waypoints[0].Lon, 6),
          formatWpmlNumber(getWaypointAltMeters(Waypoints[0], globalAltMeters), 1),
        ].join(",")
      : null;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="' + WPML_NS + '">'
  );
  lines.push("  <Document>");
  lines.push("    <wpml:author>Waypoint Planner</wpml:author>");
  lines.push("    <wpml:createTime>" + now + "</wpml:createTime>");
  lines.push("    <wpml:updateTime>" + now + "</wpml:updateTime>");
  lines.push(buildWpmlMissionConfig("    ", takeoffPoint, 0));
  lines.push("    <Folder>");
  lines.push("      <wpml:templateType>waypoint</wpml:templateType>");
  lines.push("      <wpml:templateId>0</wpml:templateId>");
  lines.push("      <wpml:waylineCoordinateSysParam>");
  lines.push("        <wpml:coordinateMode>WGS84</wpml:coordinateMode>");
  lines.push("        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>");
  lines.push("        <wpml:positioningType>GPS</wpml:positioningType>");
  lines.push(
    "        <wpml:globalShootHeight>" +
      formatWpmlNumber(globalAltMeters, 1) +
      "</wpml:globalShootHeight>"
  );
  lines.push("        <wpml:surfaceFollowModeEnable>0</wpml:surfaceFollowModeEnable>");
  lines.push(
    "        <wpml:surfaceRelativeHeight>" +
      formatWpmlNumber(globalAltMeters, 1) +
      "</wpml:surfaceRelativeHeight>"
  );
  lines.push("      </wpml:waylineCoordinateSysParam>");
  lines.push(
    "      <wpml:autoFlightSpeed>" +
      formatWpmlNumber(globalSpeedMs, 2) +
      "</wpml:autoFlightSpeed>"
  );
  lines.push("      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>");
  lines.push("      <wpml:globalWaypointHeadingParam>");
  lines.push(
    "        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>"
  );
  lines.push(
    "        <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>"
  );
  lines.push("      </wpml:globalWaypointHeadingParam>");
  lines.push(
    "      <wpml:globalWaypointTurnMode>" +
      turnMode +
      "</wpml:globalWaypointTurnMode>"
  );
  if (includeUseStraightLine) {
    lines.push(
      "      <wpml:globalUseStraightLine>" +
        useStraightLine +
        "</wpml:globalUseStraightLine>"
    );
  }
  lines.push(
    "      <wpml:globalHeight>" +
      formatWpmlNumber(globalAltMeters, 1) +
      "</wpml:globalHeight>"
  );

  Waypoints.forEach((Wp, idx) => {
    const altMeters = getWaypointAltMeters(Wp, globalAltMeters);
    const useGlobalAlt = Wp.UseGlobalAlt ? 1 : 0;
    const useGlobalSpeed = Wp.UseGlobalSpeed ? 1 : 0;
    const gimbalPitch = Number.isFinite(Wp.Gimbal) ? Wp.Gimbal : 0;

    lines.push("      <Placemark>");
    lines.push("        <Point>");
    lines.push(
      "          <coordinates>" +
        formatWpmlNumber(Wp.Lon, 7) +
        "," +
        formatWpmlNumber(Wp.Lat, 7) +
        "</coordinates>"
    );
    lines.push("        </Point>");
    lines.push("        <wpml:index>" + idx + "</wpml:index>");
    lines.push(
      "        <wpml:ellipsoidHeight>" +
        formatWpmlNumber(altMeters, 1) +
        "</wpml:ellipsoidHeight>"
    );
    lines.push(
      "        <wpml:height>" +
        formatWpmlNumber(altMeters, 1) +
        "</wpml:height>"
    );
    lines.push("        <wpml:useGlobalHeight>" + useGlobalAlt + "</wpml:useGlobalHeight>");
    lines.push("        <wpml:useGlobalSpeed>" + useGlobalSpeed + "</wpml:useGlobalSpeed>");
    lines.push("        <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>");
    lines.push("        <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>");
    lines.push(
      "        <wpml:gimbalPitchAngle>" + formatWpmlNumber(gimbalPitch, 1) + "</wpml:gimbalPitchAngle>"
    );
    lines.push("      </Placemark>");
  });

  lines.push("    </Folder>");
  lines.push("  </Document>");
  lines.push("</kml>");
  return lines.join("\n");
}

function buildWpmlWaylines() {
  const globalAltMeters = getGlobalAltMeters();
  const globalSpeedMs = getGlobalSpeedMs();
  const { turnMode, useStraightLine, includeUseStraightLine, turnDampingDist } =
    getWpmlTurnSettings();
  const takeoffPoint =
    Waypoints.length > 0
      ? [
          formatWpmlNumber(Waypoints[0].Lat, 6),
          formatWpmlNumber(Waypoints[0].Lon, 6),
          formatWpmlNumber(getWaypointAltMeters(Waypoints[0], globalAltMeters), 1),
        ].join(",")
      : null;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="' + WPML_NS + '">'
  );
  lines.push("  <Document>");
  lines.push(buildWpmlMissionConfig("    ", takeoffPoint, 0));
  lines.push("    <Folder>");
  lines.push("      <wpml:templateId>0</wpml:templateId>");
  lines.push("      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>");
  lines.push("      <wpml:waylineId>0</wpml:waylineId>");
  lines.push(
    "      <wpml:autoFlightSpeed>" +
      formatWpmlNumber(globalSpeedMs, 2) +
      "</wpml:autoFlightSpeed>"
  );

  Waypoints.forEach((Wp, idx) => {
    const altMeters = getWaypointAltMeters(Wp, globalAltMeters);
    const speedMs = getWaypointSpeedMs(Wp, globalSpeedMs);
    lines.push("      <Placemark>");
    lines.push("        <Point>");
    lines.push(
      "          <coordinates>" +
        formatWpmlNumber(Wp.Lon, 7) +
        "," +
        formatWpmlNumber(Wp.Lat, 7) +
        "</coordinates>"
    );
    lines.push("        </Point>");
    lines.push("        <wpml:index>" + idx + "</wpml:index>");
    lines.push(
      "        <wpml:executeHeight>" + formatWpmlNumber(altMeters, 1) + "</wpml:executeHeight>"
    );
    lines.push(
      "        <wpml:waypointSpeed>" + formatWpmlNumber(speedMs, 2) + "</wpml:waypointSpeed>"
    );
    lines.push(buildWpmlHeadingParam("        "));
    lines.push(buildWpmlTurnParam("        ", turnMode, turnDampingDist));
    if (includeUseStraightLine) {
      lines.push(
        "        <wpml:useStraightLine>" + useStraightLine + "</wpml:useStraightLine>"
      );
    }
    lines.push("      </Placemark>");
  });

  lines.push("    </Folder>");
  lines.push("  </Document>");
  lines.push("</kml>");
  return lines.join("\n");
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

function buildCsvForWaypoints() {
  const lines = [];
  lines.push(
    "lat,lon,alt,speed,heading,gimbal,gimbalRoll,hover,cameraAction,zoom,useGlobalAlt,useGlobalSpeed"
  );
  Waypoints.forEach((Wp) => {
    const zoomVal = Number.isFinite(Wp.Zoom) ? formatCsvNumber(Wp.Zoom) : "";
    lines.push(
      [
        formatCsvNumber(Wp.Lat, 7),
        formatCsvNumber(Wp.Lon, 7),
        formatCsvNumber(Wp.Alt),
        formatCsvNumber(Wp.Speed),
        formatCsvNumber(Wp.Heading),
        formatCsvNumber(Wp.Gimbal),
        formatCsvNumber(Wp.GimbalRoll),
        formatCsvNumber(Wp.Hover),
        Wp.CameraAction || "",
        zoomVal,
        Wp.UseGlobalAlt ? "1" : "0",
        Wp.UseGlobalSpeed ? "1" : "0",
      ].join(",")
    );
  });
  return lines.join("\n");
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

function ExportWaypointsToCsv() {
  const csv = buildCsvForWaypoints();
  const filename = "waypoints.csv";
  downloadTextFile(filename, csv, "text/csv");
}

async function ExportWaypointsToKmz() {
  if (typeof JSZip === "undefined") {
    ExportWaypointsToKml();
    return;
  }
  const templateKml = buildWpmlTemplateKml();
  const waylinesWpml = buildWpmlWaylines();
  const zip = new JSZip();
  zip.file("wpmz/template.kml", templateKml);
  zip.file("wpmz/waylines.wpml", waylinesWpml);
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
    if (fmt === "csv") {
      ExportWaypointsToCsv();
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
    const altProvided = hasAlt && Number.isFinite(alt);
    const entry = {
      lat,
      lon,
      alt: altProvided ? alt : null,
      altProvided,
    };
    if (altProvided) {
      entry.altUnit = "meters";
    }
    coords.push(entry);
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

function wpmlMatchesLocalName(Node, Name) {
  if (!Node) return false;
  if (Node.localName === Name) return true;
  const nodeName = Node.nodeName || "";
  return nodeName === Name || nodeName.endsWith(":" + Name);
}

function wpmlFindFirstText(root, name) {
  if (!root) return null;
  const nodes = root.getElementsByTagName("*");
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (wpmlMatchesLocalName(node, name)) {
      const text = node.textContent;
      return text ? text.trim() : null;
    }
  }
  return null;
}

function parseWpmlBoolean(text) {
  if (text === null || text === undefined) return null;
  const norm = String(text).trim().toLowerCase();
  if (norm === "1" || norm === "true") return true;
  if (norm === "0" || norm === "false") return false;
  return null;
}

function resolveWpmlPathMode(turnMode, useStraightLine) {
  const mode = String(turnMode || "").trim();
  if (!mode) {
    if (useStraightLine === true) return "straight";
    if (useStraightLine === false) return "curved";
    return null;
  }
  if (mode === "toPointAndStopWithDiscontinuityCurvature") {
    return "straight";
  }
  if (mode === "coordinateTurn") {
    return "curved";
  }
  if (
    mode === "toPointAndStopWithContinuityCurvature" ||
    mode === "toPointAndPassWithContinuityCurvature"
  ) {
    if (useStraightLine === true) return "straight";
    if (useStraightLine === false) return "curved";
    return "curved";
  }
  return null;
}

function getWpmlPathModeFromDoc(xmlDoc) {
  if (!xmlDoc) return null;
  let sawCurved = false;
  let sawStraight = false;

  const folders = xmlDoc.getElementsByTagName("Folder");
  const targets = folders.length ? folders : [xmlDoc];
  for (let i = 0; i < targets.length; i++) {
    const folder = targets[i];
    const globalTurnMode = wpmlFindFirstText(folder, "globalWaypointTurnMode");
    const globalUseStraight = parseWpmlBoolean(
      wpmlFindFirstText(folder, "globalUseStraightLine")
    );
    const globalMode = resolveWpmlPathMode(globalTurnMode, globalUseStraight);
    if (globalMode === "curved") sawCurved = true;
    if (globalMode === "straight") sawStraight = true;

    const placemarks = folder.getElementsByTagName("Placemark");
    for (let j = 0; j < placemarks.length; j++) {
      const placemark = placemarks[j];
      const turnMode = wpmlFindFirstText(placemark, "waypointTurnMode");
      const useStraight = parseWpmlBoolean(
        wpmlFindFirstText(placemark, "useStraightLine")
      );
      const localMode = resolveWpmlPathMode(turnMode, useStraight);
      if (localMode === "curved") sawCurved = true;
      if (localMode === "straight") sawStraight = true;
    }
  }

  if (sawCurved) return "curved";
  if (sawStraight) return "straight";
  return null;
}

function parseXmlDocument(text) {
  if (!text) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  return doc;
}

function getWpmlPathMode(templateText, waylinesText) {
  const templateDoc = parseXmlDocument(templateText);
  const waylinesDoc = parseXmlDocument(waylinesText);
  const templateMode = getWpmlPathModeFromDoc(templateDoc);
  const waylinesMode = getWpmlPathModeFromDoc(waylinesDoc);
  if (templateMode === "curved" || waylinesMode === "curved") return "curved";
  if (templateMode === "straight" || waylinesMode === "straight") return "straight";
  return null;
}

function getWpmlFinishActionFromDoc(xmlDoc) {
  if (!xmlDoc) return null;
  const raw = wpmlFindFirstText(xmlDoc, "finishAction");
  if (typeof NormalizeMissionFinishAction === "function") {
    return NormalizeMissionFinishAction(raw);
  }
  return raw ? String(raw).trim() : null;
}

function getWpmlFinishAction(templateText, waylinesText) {
  const templateDoc = parseXmlDocument(templateText);
  const waylinesDoc = parseXmlDocument(waylinesText);
  const templateAction = getWpmlFinishActionFromDoc(templateDoc);
  if (templateAction) return templateAction;
  const waylinesAction = getWpmlFinishActionFromDoc(waylinesDoc);
  return waylinesAction;
}

function normalizeCsvHeaderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseCsvText(text) {
  if (!text) return [];
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") {
      rows.push(row);
    }
  }

  return rows;
}

function parseCsvBoolean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (text === "1" || text === "true" || text === "yes" || text === "y") return true;
  if (text === "0" || text === "false" || text === "no" || text === "n") return false;
  return null;
}

function normalizeCameraAction(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  if (text === "none" || text === "off" || text === "no") return "none";
  if (text === "takephoto" || text === "photo" || text === "take_photo") {
    return "takePhoto";
  }
  if (
    text === "startrecording" ||
    text === "startrecord" ||
    text === "record"
  ) {
    return "startRecording";
  }
  if (text === "stoprecording" || text === "stoprecord") {
    return "stopRecording";
  }
  return null;
}

function extractWaypointsFromCsv(csvText) {
  const rows = parseCsvText(csvText);
  if (!rows.length) return [];
  const cleanRows = rows.map((row) => row.map((cell) => String(cell || "").trim()));
  if (!cleanRows.length) return [];

  const headerRow = cleanRows[0];
  const hasHeader = headerRow.some((cell) => /[a-zA-Z]/.test(cell));
  const headerIndex = {};

  if (hasHeader) {
    headerRow.forEach((cell, idx) => {
      const key = normalizeCsvHeaderName(cell);
      if (key) {
        headerIndex[key] = idx;
      }
    });
  }

  const headerAliases = {
    lat: ["lat", "latitude", "y"],
    lon: ["lon", "lng", "longitude", "x"],
    alt: ["alt", "altitude", "elevation", "height"],
    speed: ["speed", "velocity"],
    heading: ["heading", "yaw", "bearing"],
    gimbal: ["gimbal", "pitch"],
    gimbalRoll: ["gimbalroll", "roll", "rollangle"],
    hover: ["hover", "hoversec", "hoverseconds", "delay", "dwell"],
    cameraAction: ["cameraaction", "action", "camera", "cameraactiontype"],
    zoom: ["zoom", "zoomlevel", "zoomx"],
    useGlobalAlt: ["useglobalalt", "globalalt", "useglobalaltitude"],
    useGlobalSpeed: ["useglobalspeed", "globalspeed"],
  };

  function getIndex(aliases) {
    for (let i = 0; i < aliases.length; i += 1) {
      const key = normalizeCsvHeaderName(aliases[i]);
      if (headerIndex[key] !== undefined) return headerIndex[key];
    }
    return -1;
  }

  const fallbackIndexV1 = {
    lat: 0,
    lon: 1,
    alt: 2,
    speed: 3,
    heading: 4,
    gimbal: 5,
    useGlobalAlt: 6,
    useGlobalSpeed: 7,
  };
  const fallbackIndexV2 = {
    lat: 0,
    lon: 1,
    alt: 2,
    speed: 3,
    heading: 4,
    gimbal: 5,
    gimbalRoll: 6,
    hover: 7,
    cameraAction: 8,
    zoom: 9,
    useGlobalAlt: 10,
    useGlobalSpeed: 11,
  };

  const startRow = hasHeader ? 1 : 0;
  const coords = [];

  for (let i = startRow; i < cleanRows.length; i += 1) {
    const row = cleanRows[i];
    if (!row.length || row.every((cell) => cell === "")) continue;

    const useV2Fallback = !hasHeader && row.length >= 10;
    const fallbackIndex = useV2Fallback ? fallbackIndexV2 : fallbackIndexV1;

    const latIdx = hasHeader ? getIndex(headerAliases.lat) : fallbackIndex.lat;
    const lonIdx = hasHeader ? getIndex(headerAliases.lon) : fallbackIndex.lon;
    const latVal = parseFloat(row[latIdx] || "");
    const lonVal = parseFloat(row[lonIdx] || "");
    if (!Number.isFinite(latVal) || !Number.isFinite(lonVal)) continue;

    const altIdx = hasHeader ? getIndex(headerAliases.alt) : fallbackIndex.alt;
    const speedIdx = hasHeader ? getIndex(headerAliases.speed) : fallbackIndex.speed;
    const headingIdx = hasHeader ? getIndex(headerAliases.heading) : fallbackIndex.heading;
    const gimbalIdx = hasHeader ? getIndex(headerAliases.gimbal) : fallbackIndex.gimbal;
    const gimbalRollIdx = hasHeader
      ? getIndex(headerAliases.gimbalRoll)
      : fallbackIndex.gimbalRoll;
    const hoverIdx = hasHeader ? getIndex(headerAliases.hover) : fallbackIndex.hover;
    const cameraActionIdx = hasHeader
      ? getIndex(headerAliases.cameraAction)
      : fallbackIndex.cameraAction;
    const zoomIdx = hasHeader ? getIndex(headerAliases.zoom) : fallbackIndex.zoom;
    const useAltIdx = hasHeader ? getIndex(headerAliases.useGlobalAlt) : fallbackIndex.useGlobalAlt;
    const useSpeedIdx =
      hasHeader ? getIndex(headerAliases.useGlobalSpeed) : fallbackIndex.useGlobalSpeed;

    const altVal = parseFloat(row[altIdx] || "");
    const speedVal = parseFloat(row[speedIdx] || "");
    const headingVal = parseFloat(row[headingIdx] || "");
    const gimbalVal = parseFloat(row[gimbalIdx] || "");
    const gimbalRollVal = parseFloat(row[gimbalRollIdx] || "");
    const hoverVal = parseFloat(row[hoverIdx] || "");
    const zoomVal = parseFloat(row[zoomIdx] || "");
    const cameraActionVal = normalizeCameraAction(row[cameraActionIdx] || "");

    const useGlobalAlt = parseCsvBoolean(row[useAltIdx]);
    const useGlobalSpeed = parseCsvBoolean(row[useSpeedIdx]);

    const entry = {
      lat: latVal,
      lon: lonVal,
    };

    if (Number.isFinite(altVal)) {
      entry.alt = altVal;
      entry.altProvided = true;
    }
    if (Number.isFinite(speedVal)) {
      entry.speed = speedVal;
      entry.speedProvided = true;
    }
    if (Number.isFinite(headingVal)) {
      entry.heading = headingVal;
    }
    if (Number.isFinite(gimbalVal)) {
      entry.gimbal = gimbalVal;
    }
    if (Number.isFinite(gimbalRollVal)) {
      entry.gimbalRoll = gimbalRollVal;
    }
    if (Number.isFinite(hoverVal)) {
      entry.hover = hoverVal;
    }
    if (Number.isFinite(zoomVal)) {
      entry.zoom = zoomVal;
    }
    if (cameraActionVal) {
      entry.cameraAction = cameraActionVal;
    }
    if (useGlobalAlt !== null) {
      entry.useGlobalAlt = useGlobalAlt;
    }
    if (useGlobalSpeed !== null) {
      entry.useGlobalSpeed = useGlobalSpeed;
    }

    coords.push(entry);
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

function applyImportedWaypoints(coords, pathMode) {
  if (!coords || !coords.length) return;
  const shouldReplace = !Waypoints.length || window.confirm("Replace existing waypoints?");
  if (shouldReplace) {
    clearWaypointsForImport();
  }
  if (pathMode) {
    PathDisplayMode = pathMode;
  } else if (shouldReplace) {
    PathDisplayMode = "straight";
  }
  if (shouldReplace && ExportPathModeSelect) {
    ExportPathModeSelect.value = pathMode ? pathMode : "straight";
  }

  SelectedIds.clear();
  coords.forEach((coord) => {
    const wp = AddWaypoint(coord.lat, coord.lon, {
      selectionMode: "add",
      skipRender: true,
      skipHistory: true,
    });
    const hasAlt = Boolean(coord.altProvided);
    const hasSpeed = Boolean(coord.speedProvided);
    const useGlobalAlt =
      coord.useGlobalAlt !== undefined && coord.useGlobalAlt !== null
        ? Boolean(coord.useGlobalAlt)
        : !hasAlt;
    const useGlobalSpeed =
      coord.useGlobalSpeed !== undefined && coord.useGlobalSpeed !== null
        ? Boolean(coord.useGlobalSpeed)
        : !hasSpeed;

    wp.UseGlobalAlt = useGlobalAlt;
    wp.UseGlobalSpeed = useGlobalSpeed;

    if (hasAlt) {
      const isMeters = coord.altUnit === "meters";
      const altVal =
        isMeters && SettingsState.units === "imperial"
          ? coord.alt / METERS_PER_FOOT
          : coord.alt;
      wp.Alt = altVal;
    } else if (!useGlobalAlt) {
      wp.Alt = SettingsState.globalAlt;
    }

    if (hasSpeed) {
      wp.Speed = coord.speed;
    } else if (!useGlobalSpeed) {
      wp.Speed = SettingsState.globalSpeed;
    }

    if (Number.isFinite(coord.heading)) {
      wp.Heading = coord.heading;
    }
    if (Number.isFinite(coord.gimbal)) {
      wp.Gimbal = coord.gimbal;
    }
    if (Number.isFinite(coord.gimbalRoll)) {
      wp.GimbalRoll = coord.gimbalRoll;
    }
    if (Number.isFinite(coord.hover)) {
      wp.Hover = Math.max(0, coord.hover);
    }
    if (Number.isFinite(coord.zoom)) {
      wp.Zoom = Math.max(1, coord.zoom);
    }
    if (coord.cameraAction) {
      wp.CameraAction = coord.cameraAction;
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
  let coords = [];
  let pathMode = null;
  let finishAction = null;

  if (name.endsWith(".kmz")) {
    if (typeof JSZip === "undefined") {
      alert("KMZ import requires JSZip.");
      return;
    }
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const wpmlFiles = zip.file(/\.wpml$/i);
    const templateFiles = zip.file(/template\.kml$/i);
    const wpmlEntry =
      (wpmlFiles && wpmlFiles.find((entry) => /waylines\.wpml$/i.test(entry.name))) ||
      (wpmlFiles && wpmlFiles[0]);
    const templateEntry =
      (templateFiles && templateFiles.find((entry) => /template\.kml$/i.test(entry.name))) ||
      (templateFiles && templateFiles[0]);
    const wpmlText = wpmlEntry ? await wpmlEntry.async("text") : "";
    const templateText = templateEntry ? await templateEntry.async("text") : "";
    pathMode = getWpmlPathMode(templateText, wpmlText);
    finishAction = getWpmlFinishAction(templateText, wpmlText);

    if (wpmlText) {
      kmlText = wpmlText;
      coords = extractWaypointsFromKml(kmlText);
    } else if (templateText) {
      kmlText = templateText;
      coords = extractWaypointsFromKml(kmlText);
    } else {
      const kmlFiles = zip.file(/\.kml$/i);
      if (!kmlFiles || !kmlFiles.length) {
        alert("No KML file found in KMZ.");
        return;
      }
      const docKml =
        kmlFiles.find((entry) => entry.name.toLowerCase().endsWith("doc.kml")) ||
        kmlFiles[0];
      kmlText = await docKml.async("text");
      coords = extractWaypointsFromKml(kmlText);
    }
  } else if (name.endsWith(".kml")) {
    kmlText = await file.text();
    coords = extractWaypointsFromKml(kmlText);
    pathMode = getWpmlPathMode(kmlText, "");
    finishAction = getWpmlFinishAction(kmlText, "");
  } else if (name.endsWith(".csv")) {
    const csvText = await file.text();
    coords = extractWaypointsFromCsv(csvText);
  } else {
    alert("Unsupported file type. Please use KML, KMZ, or CSV.");
    return;
  }

  if (!coords.length) {
    alert("No waypoints found in file.");
    return;
  }
  if (finishAction) {
    SettingsState.missionFinishAction = finishAction;
    if (MissionFinishSelect) {
      MissionFinishSelect.value = finishAction;
    }
  }
  applyImportedWaypoints(coords, pathMode);
}

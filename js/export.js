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
const DJI_DEFAULT_TURN_DAMPING_DIST_M = 0.2;

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
  return {
    turnMode: "toPointAndStopWithContinuityCurvature",
    useStraightLine: isStraight ? 1 : 0,
    turnDampingDist: isStraight ? 0 : DJI_DEFAULT_TURN_DAMPING_DIST_M,
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
  const lines = [];
  lines.push(indent + "<wpml:missionConfig>");
  lines.push(indent + "  <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>");
  lines.push(indent + "  <wpml:finishAction>goHome</wpml:finishAction>");
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
  const { turnMode, useStraightLine, turnDampingDist } = getWpmlTurnSettings();
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
  lines.push("    <wpml:author>Waypoint KMZ Planner</wpml:author>");
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
  lines.push(
    "      <wpml:globalUseStraightLine>" + useStraightLine + "</wpml:globalUseStraightLine>"
  );
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
    lines.push(buildWpmlHeadingParam("        "));
    lines.push(buildWpmlTurnParam("        ", turnMode, turnDampingDist));
    lines.push("        <wpml:useStraightLine>" + useStraightLine + "</wpml:useStraightLine>");
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
  const { turnMode, useStraightLine, turnDampingDist } = getWpmlTurnSettings();
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
    lines.push("        <wpml:useStraightLine>" + useStraightLine + "</wpml:useStraightLine>");
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
    "lat,lon,alt,speed,heading,gimbal,useGlobalAlt,useGlobalSpeed"
  );
  Waypoints.forEach((Wp) => {
    lines.push(
      [
        formatCsvNumber(Wp.Lat, 7),
        formatCsvNumber(Wp.Lon, 7),
        formatCsvNumber(Wp.Alt),
        formatCsvNumber(Wp.Speed),
        formatCsvNumber(Wp.Heading),
        formatCsvNumber(Wp.Gimbal),
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

  const fallbackIndex = {
    lat: 0,
    lon: 1,
    alt: 2,
    speed: 3,
    heading: 4,
    gimbal: 5,
    useGlobalAlt: 6,
    useGlobalSpeed: 7,
  };

  const startRow = hasHeader ? 1 : 0;
  const coords = [];

  for (let i = startRow; i < cleanRows.length; i += 1) {
    const row = cleanRows[i];
    if (!row.length || row.every((cell) => cell === "")) continue;

    const latIdx = hasHeader ? getIndex(headerAliases.lat) : fallbackIndex.lat;
    const lonIdx = hasHeader ? getIndex(headerAliases.lon) : fallbackIndex.lon;
    const latVal = parseFloat(row[latIdx] || "");
    const lonVal = parseFloat(row[lonIdx] || "");
    if (!Number.isFinite(latVal) || !Number.isFinite(lonVal)) continue;

    const altIdx = hasHeader ? getIndex(headerAliases.alt) : fallbackIndex.alt;
    const speedIdx = hasHeader ? getIndex(headerAliases.speed) : fallbackIndex.speed;
    const headingIdx = hasHeader ? getIndex(headerAliases.heading) : fallbackIndex.heading;
    const gimbalIdx = hasHeader ? getIndex(headerAliases.gimbal) : fallbackIndex.gimbal;
    const useAltIdx = hasHeader ? getIndex(headerAliases.useGlobalAlt) : fallbackIndex.useGlobalAlt;
    const useSpeedIdx =
      hasHeader ? getIndex(headerAliases.useGlobalSpeed) : fallbackIndex.useGlobalSpeed;

    const altVal = parseFloat(row[altIdx] || "");
    const speedVal = parseFloat(row[speedIdx] || "");
    const headingVal = parseFloat(row[headingIdx] || "");
    const gimbalVal = parseFloat(row[gimbalIdx] || "");

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
    coords = extractWaypointsFromKml(kmlText);
  } else if (name.endsWith(".kml")) {
    kmlText = await file.text();
    coords = extractWaypointsFromKml(kmlText);
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
  applyImportedWaypoints(coords);
}

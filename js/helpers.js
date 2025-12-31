// ----- Helpers -----
function EscapeHtml(Str) {
  return String(Str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ClearResults() {
  ResultsDiv.innerHTML = "";
  ResultsDiv.style.display = "none";
}

function ShowResults(ResultsArr) {
  if (!ResultsArr || ResultsArr.length === 0) {
    ResultsDiv.innerHTML =
      '<div class="resultItem"><div class="resultMain">No results</div><div class="resultSub">Try a different query.</div></div>';
    ResultsDiv.style.display = "block";
    return;
  }

  ResultsDiv.innerHTML = "";
  for (const Item of ResultsArr) {
    const MainText = Item.display_name || "(unknown)";
    const SubText = [Item.type, Item.class].filter(Boolean).join(" / ");

    const Row = document.createElement("div");
    Row.className = "resultItem";
    Row.innerHTML =
      '<div class="resultMain">' +
      EscapeHtml(MainText) +
      "</div>" +
      '<div class="resultSub">' +
      EscapeHtml(SubText) +
      "</div>";

    Row.addEventListener("click", () => {
      const LatNum = parseFloat(Item.lat);
      const LonNum = parseFloat(Item.lon);
      if (!Number.isFinite(LatNum) || !Number.isFinite(LonNum)) return;

      if (SearchMarker) {
        MapObj.removeLayer(SearchMarker);
        SearchMarker = null;
      }

      SearchMarker = L.marker([LatNum, LonNum]).addTo(MapObj);
      SearchMarker.bindPopup(EscapeHtml(MainText)).openPopup();

      const Bb = Item.boundingbox;
      if (Bb && Bb.length === 4) {
        const South = parseFloat(Bb[0]);
        const North = parseFloat(Bb[1]);
        const West = parseFloat(Bb[2]);
        const East = parseFloat(Bb[3]);
        if ([South, North, West, East].every(Number.isFinite)) {
          MapObj.fitBounds(
            [
              [South, West],
              [North, East],
            ],
            { padding: [30, 30] }
          );
        } else {
          MapObj.setView([LatNum, LonNum], 16);
        }
      } else {
        MapObj.setView([LatNum, LonNum], 16);
      }

      ClearResults();
      if (typeof UpdateToolsUi === "function") {
        UpdateToolsUi();
      }
    });

    ResultsDiv.appendChild(Row);
  }

  ResultsDiv.style.display = "block";
}

function FormatCoord(Num) {
  return Number(Num).toFixed(5);
}

function GetDistanceUnitLabel() {
  return SettingsState.units === "imperial" ? "ft" : "m";
}

function ConvertDistanceToMeters(ValueNum) {
  if (!Number.isFinite(ValueNum) || ValueNum <= 0) return null;
  return SettingsState.units === "imperial" ? ValueNum * METERS_PER_FOOT : ValueNum;
}

function ConvertMetersToDistance(MetersVal) {
  if (!Number.isFinite(MetersVal)) return null;
  return SettingsState.units === "imperial" ? MetersVal / METERS_PER_FOOT : MetersVal;
}

const MPH_PER_MS = 2.2369362920544;
const MS_PER_MPH = 0.44704;

function RoundNumber(ValueNum, decimals) {
  if (!Number.isFinite(ValueNum)) return ValueNum;
  const places = Number.isFinite(decimals) ? decimals : 0;
  const factor = Math.pow(10, places);
  return Math.round(ValueNum * factor) / factor;
}

function ConvertDistanceBetweenUnits(ValueNum, FromUnits, ToUnits) {
  if (!Number.isFinite(ValueNum)) return ValueNum;
  if (FromUnits === ToUnits) return ValueNum;
  if (FromUnits === "metric" && ToUnits === "imperial") {
    return ValueNum / METERS_PER_FOOT;
  }
  if (FromUnits === "imperial" && ToUnits === "metric") {
    return ValueNum * METERS_PER_FOOT;
  }
  return ValueNum;
}

function ConvertSpeedBetweenUnits(ValueNum, FromUnits, ToUnits) {
  if (!Number.isFinite(ValueNum)) return ValueNum;
  if (FromUnits === ToUnits) return ValueNum;
  if (FromUnits === "metric" && ToUnits === "imperial") {
    return ValueNum * MPH_PER_MS;
  }
  if (FromUnits === "imperial" && ToUnits === "metric") {
    return ValueNum * MS_PER_MPH;
  }
  return ValueNum;
}

function NormalizeMissionFinishAction(Value) {
  if (Value === null || Value === undefined) return null;
  const raw = String(Value).trim();
  if (!raw) return null;
  const clean = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (clean === "hover" || clean === "none" || clean === "noaction") {
    return "hover";
  }
  if (
    clean === "gohome" ||
    clean === "returnhome" ||
    clean === "returntohome" ||
    clean === "rth"
  ) {
    return "goHome";
  }
  if (clean === "autoland" || clean === "land") {
    return "autoLand";
  }
  return null;
}

function GetMissionFinishActionValue() {
  return NormalizeMissionFinishAction(SettingsState.missionFinishAction) || "hover";
}

function UpdateDistanceLabels() {
  const UnitLabel = GetDistanceUnitLabel();
  const SpacingLabel = document.querySelector('label[for="ShapeSpacingInput"]');
  if (SpacingLabel) {
    SpacingLabel.textContent = "Spacing (" + UnitLabel + ")";
  }
  const ResolutionLabel = document.querySelector('label[for="ShapeResolutionSlider"]');
  if (ResolutionLabel) {
    ResolutionLabel.textContent = "Resolution (" + UnitLabel + ")";
  }
  const EllipseLabel = document.querySelector('label[for="EllipseResolutionInput"]');
  if (EllipseLabel) {
    EllipseLabel.textContent = "Circumf. spacing (" + UnitLabel + ")";
  }
  const AltLabel = document.querySelector('label[for="GlobalAltInput"]');
  if (AltLabel) {
    AltLabel.textContent = "Global altitude (" + UnitLabel + ")";
  }
  const SpeedLabel = document.querySelector('label[for="GlobalSpeedInput"]');
  if (SpeedLabel) {
    const speedUnit = SettingsState.units === "imperial" ? "mph" : "m/s";
    SpeedLabel.textContent = "Global speed (" + speedUnit + ")";
  }
  const BatchAltLabel = document.querySelector('label[for="BatchAltInput"]');
  if (BatchAltLabel) {
    BatchAltLabel.textContent = "Altitude (" + UnitLabel + ")";
  }
  const BatchSpeedLabel = document.querySelector('label[for="BatchSpeedInput"]');
  if (BatchSpeedLabel) {
    const speedUnit = SettingsState.units === "imperial" ? "mph" : "m/s";
    BatchSpeedLabel.textContent = "Speed (" + speedUnit + ")";
  }
  const NudgeStepLabel = document.querySelector('label[for="NudgeStepInput"]');
  if (NudgeStepLabel) {
    NudgeStepLabel.textContent = "Step (" + UnitLabel + ")";
  }
  const OffsetDistanceLabel = document.querySelector(
    'label[for="OffsetDistanceInput"]'
  );
  if (OffsetDistanceLabel) {
    OffsetDistanceLabel.textContent = "Distance (" + UnitLabel + ")";
  }
  const TerrainTargetLabel = document.querySelector('label[for="TerrainTargetInput"]');
  if (TerrainTargetLabel) {
    TerrainTargetLabel.textContent = "Target AGL (" + UnitLabel + ")";
  }
  const TerrainMaxAltLabel = document.querySelector('label[for="TerrainMaxAltInput"]');
  if (TerrainMaxAltLabel) {
    TerrainMaxAltLabel.textContent = "Max altitude (" + UnitLabel + ")";
  }
}

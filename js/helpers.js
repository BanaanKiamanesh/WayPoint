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

function UpdateDistanceLabels() {
  const UnitLabel = GetDistanceUnitLabel();
  const SpacingLabel = document.querySelector('label[for="ShapeSpacingInput"]');
  if (SpacingLabel) {
    SpacingLabel.textContent = "Spacing (" + UnitLabel + ")";
  }
  const EllipseLabel = document.querySelector('label[for="EllipseResolutionInput"]');
  if (EllipseLabel) {
    EllipseLabel.textContent = "Circumf. spacing (" + UnitLabel + ")";
  }
}

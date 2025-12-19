// ----- Map setup -----
const MapObj = L.map("map", {
    zoomControl: false, // We'll add it manually at bottom left
    preferCanvas: true
}).setView([0, 0], 2); // World map default

// OSM tile layer
const OsmTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
});
OsmTiles.addTo(MapObj);

// Add zoom control at bottom left
L.control.zoom({
    position: 'bottomleft'
}).addTo(MapObj);

// Marker for search result
let SearchMarker = null;

// ----- UI elements -----
const SearchInput = document.getElementById("SearchInput");
const SearchBtn = document.getElementById("SearchBtn");
const ResultsDiv = document.getElementById("Results");

// ----- Helpers -----
function EscapeHtml(Str) {
    return String(Str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function ClearResults() {
    ResultsDiv.innerHTML = "";
    ResultsDiv.style.display = "none";
}

function ShowResults(ResultsArr) {
    if (!ResultsArr || ResultsArr.length === 0) {
        ResultsDiv.innerHTML = "<div class=\"resultItem\"><div class=\"resultMain\">No results</div><div class=\"resultSub\">Try a different query.</div></div>";
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
            '<div class="resultMain">' + EscapeHtml(MainText) + '</div>' +
            '<div class="resultSub">' + EscapeHtml(SubText) + '</div>';

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
                    MapObj.fitBounds([[South, West], [North, East]], { padding: [30, 30] });
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

// ----- Nominatim search (OpenStreetMap geocoder) -----
// IMPORTANT:
// - This is a simple MVP that calls the public Nominatim endpoint.
// - Keep request volume low (debounce, no continuous typing queries).
// - For production, consider your own hosted geocoder or a provider with an API key.

let LastSearchTs = 0;

async function RunSearch() {
    const QueryText = (SearchInput.value || "").trim();
    if (!QueryText) {
        return;
    }

    // Very simple client-side throttle: at most 1 request per 1.2 seconds
    const NowTs = Date.now();
    if (NowTs - LastSearchTs < 1200) {
        return;
    }
    LastSearchTs = NowTs;

    SearchBtn.disabled = true;

    try {
        const UrlObj = new URL("https://nominatim.openstreetmap.org/search");
        UrlObj.searchParams.set("format", "jsonv2");
        UrlObj.searchParams.set("q", QueryText);
        UrlObj.searchParams.set("limit", "6");
        UrlObj.searchParams.set("addressdetails", "1");

        const Resp = await fetch(UrlObj.toString(), {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!Resp.ok) {
            throw new Error("HTTP " + Resp.status);
        }

        const JsonObj = await Resp.json();
        ShowResults(JsonObj);
    } catch (ErrObj) {
        ClearResults();
    } finally {
        SearchBtn.disabled = false;
    }
}

// ----- Wire up events -----
SearchBtn.addEventListener("click", RunSearch);

SearchInput.addEventListener("keydown", (Ev) => {
    if (Ev.key === "Enter") {
        Ev.preventDefault();
        RunSearch();
    }
    if (Ev.key === "Escape") {
        ClearResults();
    }
});

// Click on map closes results
MapObj.on("click", () => {
    ClearResults();
});


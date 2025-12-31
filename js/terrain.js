const TERRAIN_TILE_ZOOM = 13;
const TERRAIN_TILE_SIZE = 256;
const TERRAIN_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRAIN_REQUEST_DELAY_MS = 300;
const TERRAIN_MAX_CONCURRENCY = 6;

const TerrainTileCache = new Map();
const TerrainCorrectionState = {
  running: false,
  pending: false,
  timer: null,
  suppressHistory: false,
};

function getTerrainTileUrl(z, x, y) {
  return TERRAIN_TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

function clampTerrainLat(lat) {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function latLngToTilePixel(lat, lon, zoom) {
  const z = Number.isFinite(zoom) ? zoom : TERRAIN_TILE_ZOOM;
  const scale = Math.pow(2, z);
  const clampedLat = clampTerrainLat(lat);
  const latRad = (clampedLat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * scale;
  const y =
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
    scale;

  const xWrapped = ((x % scale) + scale) % scale;
  const yClamped = Math.min(scale - 1, Math.max(0, y));

  const tileX = Math.floor(xWrapped);
  const tileY = Math.floor(yClamped);
  const pixelX = Math.min(
    TERRAIN_TILE_SIZE - 1,
    Math.max(0, Math.floor((xWrapped - tileX) * TERRAIN_TILE_SIZE))
  );
  const pixelY = Math.min(
    TERRAIN_TILE_SIZE - 1,
    Math.max(0, Math.floor((yClamped - tileY) * TERRAIN_TILE_SIZE))
  );

  return { tileX, tileY, pixelX, pixelY, zoom: z };
}

async function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

async function loadTerrariumTile(z, x, y) {
  const key = z + "/" + x + "/" + y;
  if (TerrainTileCache.has(key)) {
    return TerrainTileCache.get(key);
  }

  const tilePromise = (async () => {
    try {
      const resp = await fetch(getTerrainTileUrl(z, x, y));
      if (!resp.ok) return null;
      const blob = await resp.blob();
      let image = null;
      if (typeof createImageBitmap === "function") {
        image = await createImageBitmap(blob);
      } else {
        image = await loadImageFromBlob(blob);
      }
      const canvas = document.createElement("canvas");
      canvas.width = TERRAIN_TILE_SIZE;
      canvas.height = TERRAIN_TILE_SIZE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
      return ctx.getImageData(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
    } catch (err) {
      console.warn("Terrain tile load failed", err);
      return null;
    }
  })();

  TerrainTileCache.set(key, tilePromise);
  return tilePromise;
}

async function getTerrariumElevation(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const { tileX, tileY, pixelX, pixelY, zoom } = latLngToTilePixel(
    lat,
    lon,
    TERRAIN_TILE_ZOOM
  );
  const img = await loadTerrariumTile(zoom, tileX, tileY);
  if (!img || !img.data) return null;
  const idx = (pixelY * TERRAIN_TILE_SIZE + pixelX) * 4;
  const r = img.data[idx];
  const g = img.data[idx + 1];
  const b = img.data[idx + 2];
  const elev = r * 256 + g + b / 256 - 32768;
  return Number.isFinite(elev) ? elev : null;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (index < items.length) {
      const i = index;
      index += 1;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function RequestTerrainCorrection() {
  if (!SettingsState.terrainCorrectionEnabled) return;
  if (!Waypoints.length) return;
  if (TerrainCorrectionState.timer) {
    clearTimeout(TerrainCorrectionState.timer);
  }
  TerrainCorrectionState.timer = setTimeout(() => {
    TerrainCorrectionState.timer = null;
    ApplyTerrainCorrection();
  }, TERRAIN_REQUEST_DELAY_MS);
}

async function ApplyTerrainCorrection() {
  if (TerrainCorrectionState.running) {
    TerrainCorrectionState.pending = true;
    return;
  }
  TerrainCorrectionState.running = true;
  TerrainCorrectionState.pending = false;

  try {
    if (!SettingsState.terrainCorrectionEnabled || Waypoints.length === 0) return;
    const targetVal = parseFloat(SettingsState.terrainTargetAgl);
    if (!Number.isFinite(targetVal)) return;
    const targetMeters =
      SettingsState.units === "imperial" ? targetVal * METERS_PER_FOOT : targetVal;
    if (!Number.isFinite(targetMeters)) return;

    const maxVal = Number.isFinite(SettingsState.terrainMaxAlt)
      ? SettingsState.terrainMaxAlt
      : null;
    const maxMeters =
      Number.isFinite(maxVal) && maxVal !== null
        ? SettingsState.units === "imperial"
          ? maxVal * METERS_PER_FOOT
          : maxVal
        : null;

    const takeoff = Waypoints[0];
    if (!takeoff) return;
    const takeoffElev = await getTerrariumElevation(takeoff.Lat, takeoff.Lon);
    if (!Number.isFinite(takeoffElev)) return;

    const elevations = await mapWithConcurrency(
      Waypoints,
      TERRAIN_MAX_CONCURRENCY,
      async (Wp) => getTerrariumElevation(Wp.Lat, Wp.Lon)
    );

    let updated = false;
    Waypoints.forEach((Wp, idx) => {
      const elev = elevations[idx];
      if (!Number.isFinite(elev)) return;
      let desiredMsl = elev + targetMeters;
      if (Number.isFinite(maxMeters)) {
        desiredMsl = Math.min(desiredMsl, maxMeters);
      }
      const relMeters = desiredMsl - takeoffElev;
      const relUnits =
        SettingsState.units === "imperial" ? relMeters / METERS_PER_FOOT : relMeters;
      if (!Number.isFinite(relUnits)) return;
      const rounded =
        typeof RoundNumber === "function" ? RoundNumber(relUnits, 1) : relUnits;
      if (Wp.UseGlobalAlt || Wp.Alt !== rounded) {
        Wp.UseGlobalAlt = false;
        Wp.Alt = rounded;
        updated = true;
      }
    });

    if (updated) {
      RenderWaypointList();
      RefreshMarkers();
      TerrainCorrectionState.suppressHistory = true;
      PushHistory();
      TerrainCorrectionState.suppressHistory = false;
    }
  } finally {
    TerrainCorrectionState.running = false;
    if (TerrainCorrectionState.pending) {
      TerrainCorrectionState.pending = false;
      RequestTerrainCorrection();
    }
  }
}

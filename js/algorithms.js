// Shape sampling + coverage planning utilities.

// Create a coverage path for a polygon, with an optional target spacing in meters.
function coveragePlanningMeters(polygonFeature, spacingMeters, resolutionMeters) {
  if (typeof turf === "undefined") return [];
  const normalized = normalizeBoundaryFeature(polygonFeature, spacingMeters);
  const model = buildCoverageModelFromFeature(normalized, spacingMeters);
  if (!model) return [];
  const levelMax = (model.maxLevel || 0) + 1;
  let levelVal = levelMax;
  if (Number.isFinite(resolutionMeters) && resolutionMeters <= 0) {
    levelVal = 1;
  } else if (Number.isFinite(resolutionMeters) && resolutionMeters > 0) {
    // Convert target spacing to a nearest dyadic resolution level.
    const desiredSpacing = resolutionMeters;
    const kApprox = desiredSpacing / Math.max(model.baseStepVal, 1e-6);
    const kExp = Math.round(Math.log2(Math.max(kApprox, 1)));
    const kVal = Math.pow(2, kExp);
    const levelFromK = model.maxLevel - Math.round(Math.log2(Math.max(kVal, 1))) + 1;
    levelVal = clamp(levelFromK, 1, levelMax);
  }
  const Res = generatePhotoWaypointsForLevel(model, levelVal);
  return Res ? Res.latLngs : [];
}

// Normalize a shape into a polygon for coverage planning.
function normalizeBoundaryFeature(feature, spacingMeters) {
  if (!feature || !feature.geometry) return null;
  const type = feature.geometry.type;
  if (type === "Polygon" || type === "MultiPolygon") {
    return feature;
  }
  if (type === "LineString" || type === "MultiLineString") {
    const bufferDistanceKm = Math.max(spacingMeters || 10, 5) / 1000;
    const buffered = turf.buffer(feature, bufferDistanceKm, { units: "kilometers" });
    return buffered;
  }
  return null;
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

// Sample the circumference of a polygon/ellipse at roughly uniform spacing.
function ellipseCircumferenceWaypoints(feature, spacingMeters, rotationDeg) {
  const spacing = Number.isFinite(spacingMeters) && spacingMeters > 0 ? spacingMeters : 20;
  if (!feature) return [];

  // Prefer sampling the actual boundary polygon if present.
  const polyFeature =
    feature && feature.geometry && feature.geometry.type === "Polygon"
      ? feature
      : normalizeBoundaryFeature(feature, spacing);

  if (polyFeature && polyFeature.geometry && polyFeature.geometry.type === "Polygon") {
    const ring = (polyFeature.geometry.coordinates[0] || []).slice();
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push([...ring[0]]);
    }
    const line = turf.lineString(ring);
    const totalM = turf.length(line, { units: "kilometers" }) * 1000;
    const step = Math.max(1, spacing);
    const steps = Math.max(3, Math.ceil(totalM / step));
    const out = [];
    for (let i = 0; i < steps; i++) {
      const distKm = (totalM * i) / steps / 1000;
      const pt = turf.along(line, distKm, { units: "kilometers" });
      if (pt && pt.geometry && pt.geometry.coordinates) {
        out.push(pt.geometry.coordinates);
      }
    }
    return out;
  }

  // Fallback: rebuild ellipse samples from the current ellipse state.
  let centerLL = null;
  let rx = null;
  let ry = null;
  let rotDeg = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  if (EllipseState && EllipseState.center) {
    centerLL = EllipseState.center;
    rx = EllipseState.rx || spacing;
    ry = EllipseState.ry || spacing;
    rotDeg = EllipseState.rotationDeg || rotDeg;
  } else {
    return [];
  }

  const approxCirc = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
  const steps = Math.max(12, Math.ceil(approxCirc / spacing));
  const pts = computeEllipsePoints([centerLL.lat, centerLL.lng], rx, ry, rotDeg, steps);
  return pts.map((p) => [p[1], p[0]]);
}

// Build a coverage model in Mercator space for photo-style lawnmower paths.
function buildCoverageModelFromFeature(boundaryFeature, spacingMeters) {
  try {
    const mercator = turf.toMercator(boundaryFeature);
    const coords =
      mercator.geometry.type === "Polygon"
        ? mercator.geometry.coordinates[0]
        : mercator.geometry.coordinates[0][0];

    const [ox, oy] = closePolygon(
      coords.map((c) => c[0]),
      coords.map((c) => c[1])
    );

    const [rx, ry] = planning(
      ox,
      oy,
      spacingMeters,
      MovingDirection.RIGHT,
      SweepDirection.UP
    );

    const resModel = buildResolutionModel(rx, ry);
    return {
      boundaryFeature,
      spacingMeters,
      rx,
      ry,
      baseStepVal: resModel.baseStepVal,
      baseDistArr: resModel.baseDistArr,
      turnDistArr: resModel.turnDistArr,
      maxLevel: resModel.maxLevel,
    };
  } catch (Err) {
    console.error("Failed to build coverage model", Err);
    return null;
  }
}

// Convert a model level into WGS84 waypoint coordinates.
function generatePhotoWaypointsForLevel(model, levelVal) {
  if (!model || !model.rx || !model.ry) return null;
  const levelMin = 1;
  const levelMax = (model.maxLevel || 0) + 1;
  const level = clamp(levelVal || levelMax, levelMin, levelMax);

  const Result = generatePhotoWaypointsByResolutionLevel(
    model.rx,
    model.ry,
    level,
    model.baseStepVal,
    model.baseDistArr,
    model.turnDistArr,
    model.maxLevel
  );

  const latLngs = [];
  for (let i = 0; i < Result.wx.length; i++) {
    const [lon, lat] = turf.toWgs84([Result.wx[i], Result.wy[i]]);
    latLngs.push([lat, lon]);
  }

  return {
    latLngs,
    levelUsed: Result.levelUsed,
    photoSpacingUsed: Result.photoSpacingUsed,
    count: Result.count,
  };
}

// Keep coordinate sampling stable by removing duplicates.
function PushUniqueCoord(List, CoordArr) {
  if (!CoordArr || CoordArr.length < 2) return;
  const Last = List[List.length - 1];
  if (
    Last &&
    Math.abs(Last[0] - CoordArr[0]) < 1e-6 &&
    Math.abs(Last[1] - CoordArr[1]) < 1e-6
  ) {
    return;
  }
  List.push([CoordArr[0], CoordArr[1]]);
}

// Sample a line (or multilines) into evenly spaced points in meters.
function SampleLineFeature(LineFeature, SpacingMeters) {
  const Points = [];
  if (!LineFeature || !Number.isFinite(SpacingMeters) || SpacingMeters <= 0) {
    return Points;
  }

  // Flatten to handle both LineString and MultiLineString
  turf.flattenEach(LineFeature, (CurFeat) => {
    const LengthKm = turf.length(CurFeat, { units: "kilometers" });
    if (!Number.isFinite(LengthKm) || LengthKm <= 0) return;

    const TotalMeters = LengthKm * 1000;
    for (let Dist = 0; Dist <= TotalMeters; Dist += SpacingMeters) {
      const Pt = turf.along(CurFeat, Dist / 1000, { units: "kilometers" });
      if (Pt && Pt.geometry && Pt.geometry.coordinates) {
        PushUniqueCoord(Points, Pt.geometry.coordinates);
      }
    }

    // Ensure the final vertex is included
    const Coords = CurFeat.geometry && CurFeat.geometry.coordinates;
    if (Coords && Coords.length) {
      PushUniqueCoord(Points, Coords[Coords.length - 1]);
    }
  });

  return Points;
}

// Generate waypoint coordinates from any drawn feature.
function GenerateWaypointCoordsFromShape(Feature, SpacingMeters, ResolutionMeters) {
  if (typeof turf === "undefined") return [];
  if (!Feature || !Feature.geometry) return [];
  const GeomType = Feature.geometry.type;
  if (GeomType === "LineString" || GeomType === "MultiLineString") {
    return SampleLineFeature(Feature, SpacingMeters);
  }
  const pathLatLngs = coveragePlanningMeters(Feature, SpacingMeters, ResolutionMeters);
  // return as [lng, lat] pairs to match AddWaypoint usage in the UI layer
  return pathLatLngs.map((ll) => [ll[1], ll[0]]);
}

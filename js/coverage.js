// Coverage / geometry utilities
const SweepDirection = { UP: 1, DOWN: -1 };
const MovingDirection = { RIGHT: 1, LEFT: -1 };

function rotMat2d(th) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [
    [c, -s],
    [s, c],
  ];
}

function applyRot(mat, x, y) {
  return [mat[0][0] * x + mat[0][1] * y, mat[1][0] * x + mat[1][1] * y];
}

class GridMap {
  constructor(width, height, resolution, centerX, centerY) {
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.centerX = centerX;
    this.centerY = centerY;
    this.data = Array.from({ length: height }, () => new Float32Array(width));
  }

  worldToIndex(x, y) {
    const ix = Math.round((x - this.centerX) / this.resolution + this.width / 2.0);
    const iy = Math.round((y - this.centerY) / this.resolution + this.height / 2.0);
    return [ix, iy];
  }

  indexToWorld(ix, iy) {
    const x = (ix - this.width / 2.0) * this.resolution + this.centerX;
    const y = (iy - this.height / 2.0) * this.resolution + this.centerY;
    return [x, y];
  }

  checkOccupied(ix, iy, occupiedVal = 0.5) {
    ix = Math.trunc(ix);
    iy = Math.trunc(iy);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return true;
    return this.data[iy][ix] >= occupiedVal;
  }

  setValue(ix, iy, val) {
    ix = Math.trunc(ix);
    iy = Math.trunc(iy);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return false;
    this.data[iy][ix] = val;
    return true;
  }

  setPolygonFreeArea(ox, oy) {
    const polygon = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ox.map((v, i) => [v, oy[i]])] },
      properties: {},
    };
    for (let iy = 0; iy < this.height; iy++) {
      for (let ix = 0; ix < this.width; ix++) {
        const [x, y] = this.indexToWorld(ix, iy);
        const inside = turf.booleanPointInPolygon([x, y], polygon);
        if (!inside) this.data[iy][ix] = 1.0;
      }
    }
  }
}

function searchFreeGridIndexAtEdgeY(gridMap, fromUpper = false) {
  const yRange = fromUpper
    ? [...Array(gridMap.height).keys()].reverse()
    : [...Array(gridMap.height).keys()];
  const xRange = fromUpper
    ? [...Array(gridMap.width).keys()].reverse()
    : [...Array(gridMap.width).keys()];

  let yIndex = null;
  const xIndexes = [];

  for (const iy of yRange) {
    for (const ix of xRange) {
      if (!gridMap.checkOccupied(ix, iy)) {
        yIndex = iy;
        xIndexes.push(ix);
      }
    }
    if (yIndex !== null) break;
  }

  return [xIndexes, yIndex];
}

function findSweepDirectionAndStartPosition(ox, oy) {
  let maxDist = 0.0;
  let vec = [0.0, 0.0];
  let sweepStart = [0.0, 0.0];
  for (let i = 0; i < ox.length - 1; i++) {
    const dx = ox[i + 1] - ox[i];
    const dy = oy[i + 1] - oy[i];
    const d = Math.hypot(dx, dy);
    if (d > maxDist) {
      maxDist = d;
      vec = [dx, dy];
      sweepStart = [ox[i], oy[i]];
    }
  }
  return { vec, sweepStart };
}

function convertGridCoordinate(ox, oy, sweepVec, sweepStart) {
  const tx = ox.map((v) => v - sweepStart[0]);
  const ty = oy.map((v) => v - sweepStart[1]);
  const th = Math.atan2(sweepVec[1], sweepVec[0]);
  const rot = rotMat2d(th);
  const rx = [];
  const ry = [];
  for (let i = 0; i < tx.length; i++) {
    const [nx, ny] = applyRot(rot, tx[i], ty[i]);
    rx.push(nx);
    ry.push(ny);
  }
  return [rx, ry];
}

function convertGlobalCoordinate(x, y, sweepVec, sweepStart) {
  const th = Math.atan2(sweepVec[1], sweepVec[0]);
  const rot = rotMat2d(-th);
  const rx = [];
  const ry = [];
  for (let i = 0; i < x.length; i++) {
    const [nx, ny] = applyRot(rot, x[i], y[i]);
    rx.push(nx + sweepStart[0]);
    ry.push(ny + sweepStart[1]);
  }
  return [rx, ry];
}

function closePolygon(ox, oy) {
  if (!ox.length || !oy.length) return [ox, oy];
  if (ox[0] === ox[ox.length - 1] && oy[0] === oy[oy.length - 1]) {
    return [ox.slice(), oy.slice()];
  }
  return [ox.concat([ox[0]]), oy.concat([oy[0]])];
}

function horizontalLineIntersectionsX(ox, oy, y, eps) {
  const xs = [];
  for (let i = 0; i < ox.length - 1; i++) {
    const x1 = ox[i];
    const y1 = oy[i];
    const x2 = ox[i + 1];
    const y2 = oy[i + 1];
    const dy = y2 - y1;
    if (Math.abs(dy) < eps) {
      if (Math.abs(y - y1) < eps) {
        xs.push(x1, x2);
      }
      continue;
    }
    if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
      const t = (y - y1) / dy;
      xs.push(x1 + t * (x2 - x1));
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

function pickBoundaryX(xs, xRef, direction, tol) {
  if (direction > 0) {
    for (const x of xs) {
      if (x >= xRef - tol) return x;
    }
  } else {
    for (let i = xs.length - 1; i >= 0; i--) {
      if (xs[i] <= xRef + tol) return xs[i];
    }
  }
  return null;
}

function snapSegmentEndpointsToBorder(px, py, start, end, ox, oy, resolution) {
  if (end <= start) return;
  const dx = px[end] - px[start];
  if (Math.abs(dx) < resolution * 1e-6) return;
  const dirSign = dx > 0 ? 1.0 : -1.0;
  const y = py[start];
  const xs = horizontalLineIntersectionsX(ox, oy, y, resolution * 1e-9);
  if (xs.length < 2) return;
  const tol = resolution * 1e-6;
  const startX = pickBoundaryX(xs, px[start], -dirSign, tol);
  const endX = pickBoundaryX(xs, px[end], dirSign, tol);
  if (startX !== null) px[start] = startX;
  if (endX !== null) px[end] = endX;
}

function snapTurningPointsToBorder(px, py, ox, oy, resolution) {
  if (!px.length) return [px, py];
  const [cOx, cOy] = closePolygon(ox, oy);
  const nx = px.slice();
  const ny = py.slice();
  const yTol = resolution * 1e-6;

  let start = 0;
  for (let i = 1; i < nx.length; i++) {
    if (Math.abs(ny[i] - ny[i - 1]) > yTol) {
      snapSegmentEndpointsToBorder(nx, ny, start, i - 1, cOx, cOy, resolution);
      start = i;
    }
  }
  snapSegmentEndpointsToBorder(nx, ny, start, nx.length - 1, cOx, cOy, resolution);
  return [nx, ny];
}

function setupGridMap(ox, oy, resolution, sweepDirection, offsetGrid = 10) {
  let width = Math.ceil((Math.max(...ox) - Math.min(...ox)) / resolution) + offsetGrid;
  let height = Math.ceil((Math.max(...oy) - Math.min(...oy)) / resolution) + offsetGrid;
  width = Math.max(3, width);
  height = Math.max(3, height);

  const MaxCells = 3000000;
  if (width * height > MaxCells) {
    throw new Error(
      `Grid too large (${width} x ${height}). Increase spacing to reduce resolution.`
    );
  }

  const centerX = (Math.max(...ox) + Math.min(...ox)) / 2.0;
  const centerY = (Math.max(...oy) + Math.min(...oy)) / 2.0;

  const gridMap = new GridMap(width, height, resolution, centerX, centerY);
  gridMap.setPolygonFreeArea(ox, oy);

  const [xGoal, goalY] =
    sweepDirection === SweepDirection.UP
      ? searchFreeGridIndexAtEdgeY(gridMap, true)
      : searchFreeGridIndexAtEdgeY(gridMap, false);

  return { gridMap, xGoal, goalY };
}

class SweepSearcher {
  constructor(movingDirection, sweepDirection, xIndexesGoalY, goalY) {
    this.movingDirection = movingDirection;
    this.sweepDirection = sweepDirection;
    this.turingWindow = [];
    this.updateTurningWindow();
    this.xIndexesGoalY = xIndexesGoalY;
    this.goalY = goalY;
  }

  static checkOccupied(cX, cY, gridMap, occupiedVal = 0.5) {
    return gridMap.checkOccupied(cX, cY, occupiedVal);
  }

  updateTurningWindow() {
    this.turingWindow = [
      [this.movingDirection, 0.0],
      [this.movingDirection, this.sweepDirection],
      [0, this.sweepDirection],
      [-this.movingDirection, this.sweepDirection],
    ];
  }

  swapMovingDirection() {
    this.movingDirection *= -1;
    this.updateTurningWindow();
  }

  findSafeTurningGrid(cX, cY, gridMap) {
    for (const [dx, dy] of this.turingWindow) {
      const nextX = dx + cX;
      const nextY = dy + cY;
      if (!SweepSearcher.checkOccupied(nextX, nextY, gridMap)) {
        return [nextX, nextY];
      }
    }
    return [null, null];
  }

  isSearchDone(gridMap) {
    for (const ix of this.xIndexesGoalY) {
      if (!SweepSearcher.checkOccupied(ix, this.goalY, gridMap)) return false;
    }
    return true;
  }

  searchStartGrid(gridMap) {
    const [xInds, yInd] = searchFreeGridIndexAtEdgeY(
      gridMap,
      this.sweepDirection === SweepDirection.DOWN
    );
    if (this.movingDirection === MovingDirection.RIGHT) {
      return [Math.min(...xInds), yInd];
    }
    if (this.movingDirection === MovingDirection.LEFT) {
      return [Math.max(...xInds), yInd];
    }
    return [xInds[0], yInd];
  }

  moveTargetGrid(cX, cY, gridMap) {
    let nX = this.movingDirection + cX;
    let nY = cY;

    if (!SweepSearcher.checkOccupied(nX, nY, gridMap)) {
      return [nX, nY];
    }

    let [nextX, nextY] = this.findSafeTurningGrid(cX, cY, gridMap);
    if (nextX === null && nextY === null) {
      nextX = -this.movingDirection + cX;
      nextY = cY;
      if (SweepSearcher.checkOccupied(nextX, nextY, gridMap, 1.0)) {
        return [null, null];
      }
    } else {
      while (
        !SweepSearcher.checkOccupied(
          nextX + this.movingDirection,
          nextY,
          gridMap
        )
      ) {
        nextX += this.movingDirection;
      }
      this.swapMovingDirection();
    }
    return [nextX, nextY];
  }
}

function sweepPathSearch(sweepSearcher, gridMap) {
  let [cX, cY] = sweepSearcher.searchStartGrid(gridMap);
  if (!gridMap.setValue(cX, cY, 0.5)) {
    return [[], []];
  }

  const px = [];
  const py = [];
  const [sx, sy] = gridMap.indexToWorld(cX, cY);
  px.push(sx);
  py.push(sy);

  while (true) {
    [cX, cY] = sweepSearcher.moveTargetGrid(cX, cY, gridMap);
    if (sweepSearcher.isSearchDone(gridMap) || cX === null || cY === null) break;
    const [wx, wy] = gridMap.indexToWorld(cX, cY);
    px.push(wx);
    py.push(wy);
    gridMap.setValue(cX, cY, 0.5);
  }

  return [px, py];
}

function planning(ox, oy, spacingMeters, movingDirection, sweepDirection) {
  const { vec: sweepVec, sweepStart } = findSweepDirectionAndStartPosition(ox, oy);
  const [rox, roy] = convertGridCoordinate(ox, oy, sweepVec, sweepStart);
  const { gridMap, xGoal, goalY } = setupGridMap(rox, roy, spacingMeters, sweepDirection);
  const sweeper = new SweepSearcher(movingDirection, sweepDirection, xGoal, goalY);
  let [px, py] = sweepPathSearch(sweeper, gridMap);
  [px, py] = snapTurningPointsToBorder(px, py, rox, roy, spacingMeters);
  const [rx, ry] = convertGlobalCoordinate(px, py, sweepVec, sweepStart);
  return [rx, ry];
}

function extractTurningIndices(rx, ry, angleTolDeg = 1.0) {
  const n = rx.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const dx = [];
  const dy = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(rx[i + 1] - rx[i]);
    dy.push(ry[i + 1] - ry[i]);
  }
  const dirX = [];
  const dirY = [];
  for (let i = 0; i < dx.length; i++) {
    const len = Math.hypot(dx[i], dy[i]) || 1;
    dirX.push(dx[i] / len);
    dirY.push(dy[i] / len);
  }
  const turnInds = [0];
  const cosTol = Math.cos((angleTolDeg * Math.PI) / 180.0);
  for (let i = 0; i < dirX.length - 1; i++) {
    const dot = dirX[i] * dirX[i + 1] + dirY[i] * dirY[i + 1];
    if (dot < cosTol) {
      turnInds.push(i + 1);
    }
  }
  turnInds.push(n - 1);
  return Array.from(new Set(turnInds)).sort((a, b) => a - b);
}

function samplePolylineAtDistances(rx, ry, distQueryArr) {
  const n = rx.length;
  if (n === 0) return [[], [], 0, [0]];
  const dx = [];
  const dy = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(rx[i + 1] - rx[i]);
    dy.push(ry[i + 1] - ry[i]);
  }
  const segLen = dx.map((v, i) => Math.hypot(v, dy[i]));
  const cumLen = [0];
  for (let i = 0; i < segLen.length; i++) {
    cumLen.push(cumLen[i] + segLen[i]);
  }
  const totalLen = cumLen[cumLen.length - 1] || 0;

  const distArr = distQueryArr.map((d) => {
    if (!Number.isFinite(d)) return 0;
    return Math.min(Math.max(d, 0), totalLen);
  });

  if (segLen.length === 0) {
    return [[rx[0]], [ry[0]], totalLen, cumLen];
  }

  const outX = [];
  const outY = [];
  distArr.forEach((dist) => {
    let segIdx = 0;
    while (segIdx < segLen.length - 1 && dist > cumLen[segIdx + 1]) {
      segIdx++;
    }
    const segLength = segLen[segIdx];
    const t = segLength > 0 ? (dist - cumLen[segIdx]) / segLength : 0;
    outX.push(rx[segIdx] + dx[segIdx] * t);
    outY.push(ry[segIdx] + dy[segIdx] * t);
  });

  return [outX, outY, totalLen, cumLen];
}

function mergeDistancesWithTurnPriority(distArr, isTurnArr, tolVal) {
  if (!distArr.length) return [];
  const out = [];
  let i = 0;
  const n = distArr.length;
  while (i < n) {
    let j = i;
    while (j + 1 < n && distArr[j + 1] - distArr[i] <= tolVal) {
      j++;
    }
    let keepIdx = i;
    for (let k = i; k <= j; k++) {
      if (isTurnArr[k]) {
        keepIdx = k;
        break;
      }
    }
    out.push(distArr[keepIdx]);
    i = j + 1;
  }
  return out;
}

function buildResolutionModel(
  rx,
  ry,
  maxWaypoints = 5000,
  minBaseStep = 0.1,
  turningAngleTolDeg = 1.0
) {
  if (rx.length < 2 || ry.length < 2) {
    return {
      baseStepVal: 1,
      baseDistArr: [0],
      turnDistArr: [0],
      totalLen: 0,
      maxLevel: 0,
    };
  }

  const dx = [];
  const dy = [];
  for (let i = 0; i < rx.length - 1; i++) {
    dx.push(rx[i + 1] - rx[i]);
    dy.push(ry[i + 1] - ry[i]);
  }
  const segLen = dx.map((v, i) => Math.hypot(v, dy[i]));
  const cumLen = [0];
  for (let i = 0; i < segLen.length; i++) {
    cumLen.push(cumLen[i] + segLen[i]);
  }
  const totalLen = cumLen[cumLen.length - 1] || 0;
  if (totalLen <= 0 || !Number.isFinite(totalLen)) {
    return {
      baseStepVal: 1,
      baseDistArr: [0],
      turnDistArr: [0],
      totalLen: 0,
      maxLevel: 0,
    };
  }

  const desiredCount = Math.floor(totalLen / Math.max(minBaseStep, 1e-6)) + 1;
  const candidateCount = Math.min(
    Math.max(2, desiredCount),
    Math.max(2, maxWaypoints)
  );
  const candidateMinusOne = Math.max(1, candidateCount - 1);
  const maxLevel = Math.max(0, Math.floor(Math.log2(candidateMinusOne)));
  const baseCount = Math.pow(2, maxLevel) + 1;
  const baseDistArr = [];
  for (let i = 0; i < baseCount; i++) {
    baseDistArr.push((totalLen * i) / (baseCount - 1));
  }
  const baseStepVal = totalLen / (baseCount - 1);

  const turnInds = extractTurningIndices(rx, ry, turningAngleTolDeg);
  const turnDistArr = turnInds.map((idx) => cumLen[Math.min(idx, cumLen.length - 1)]);
  const turnSet = Array.from(new Set(turnDistArr.concat([0, totalLen]))).sort(
    (a, b) => a - b
  );

  return { baseStepVal, baseDistArr, turnDistArr: turnSet, totalLen, maxLevel };
}

function generatePhotoWaypointsByResolutionLevel(
  rx,
  ry,
  resolutionLevelVal,
  baseStepVal,
  baseDistArr,
  turnDistArr,
  maxLevel
) {
  if (!baseDistArr.length) {
    return { wx: [], wy: [], levelUsed: 1, photoSpacingUsed: baseStepVal, count: 0 };
  }

  const levelMin = 1;
  const levelMax = maxLevel + 1;
  const levelVal = Math.min(
    Math.max(Math.round(resolutionLevelVal), levelMin),
    levelMax
  );
  const levelIdx = levelVal - 1;
  const kExp = maxLevel - levelIdx;
  const kVal = Math.max(1, Math.pow(2, kExp));

  const selDistArr = baseDistArr.filter((_, idx) => idx % kVal === 0);
  const selIsTurn = selDistArr.map(() => false);
  const turnIsTurn = turnDistArr.map(() => true);

  const allDist = selDistArr.concat(turnDistArr);
  const allIsTurn = selIsTurn.concat(turnIsTurn);
  const order = allDist
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d - b.d)
    .map((o) => o.i);
  const sortedDist = order.map((idx) => allDist[idx]);
  const sortedIsTurn = order.map((idx) => allIsTurn[idx]);

  const tolVal = Math.max(1e-7, 0.25 * baseStepVal);
  const mergedDist = mergeDistancesWithTurnPriority(sortedDist, sortedIsTurn, tolVal);

  const [wx, wy] = samplePolylineAtDistances(rx, ry, mergedDist);
  const photoSpacingUsed = baseStepVal * kVal;
  return {
    wx,
    wy,
    levelUsed: levelVal,
    photoSpacingUsed,
    count: mergedDist.length,
  };
}

function resolutionLevelFromMeters(resolutionMeters, baseStepVal, maxLevel) {
  if (!Number.isFinite(resolutionMeters) || resolutionMeters <= 0) {
    return 1;
  }
  const desiredK = resolutionMeters / Math.max(baseStepVal, 1e-6);
  const kExp = Math.round(Math.log2(Math.max(desiredK, 1e-6)));
  const maxK = Math.pow(2, maxLevel);
  const kVal = Math.min(Math.max(1, Math.pow(2, kExp)), maxK);
  const level = maxLevel - Math.round(Math.log2(kVal)) + 1;
  return Math.min(Math.max(level, 1), maxLevel + 1);
}

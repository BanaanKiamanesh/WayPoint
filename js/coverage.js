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
    this.freeCount = 0;
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
    this.freeCount = 0;
    const polygon = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ox.map((v, i) => [v, oy[i]])] },
      properties: {},
    };
    for (let iy = 0; iy < this.height; iy++) {
      for (let ix = 0; ix < this.width; ix++) {
        const [x, y] = this.indexToWorld(ix, iy);
        const inside = turf.booleanPointInPolygon([x, y], polygon);
        if (!inside) {
          this.data[iy][ix] = 1.0;
        } else {
          this.data[iy][ix] = 0.0;
          this.freeCount += 1;
        }
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

function getBoundsCenter(ox, oy) {
  if (!ox.length || !oy.length) return [0, 0];
  const minX = Math.min(...ox);
  const maxX = Math.max(...ox);
  const minY = Math.min(...oy);
  const maxY = Math.max(...oy);
  return [(minX + maxX) / 2.0, (minY + maxY) / 2.0];
}

function getSweepVectorAndStart(ox, oy, orientation) {
  const mode = String(orientation || "").toLowerCase();
  if (mode === "east-west") {
    return { vec: [1.0, 0.0], sweepStart: getBoundsCenter(ox, oy) };
  }
  if (mode === "north-south") {
    return { vec: [0.0, 1.0], sweepStart: getBoundsCenter(ox, oy) };
  }
  return findSweepDirectionAndStartPosition(ox, oy);
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

function sanitizePolyline(rx, ry, tol = 1e-6) {
  if (!rx || !ry || rx.length !== ry.length) return [rx || [], ry || []];
  const outX = [];
  const outY = [];
  for (let i = 0; i < rx.length; i++) {
    const x = rx[i];
    const y = ry[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (outX.length) {
      const dx = x - outX[outX.length - 1];
      const dy = y - outY[outY.length - 1];
      if (Math.hypot(dx, dy) <= tol) {
        continue;
      }
    }
    outX.push(x);
    outY.push(y);
  }
  return [outX, outY];
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
  if (gridMap.checkOccupied(cX, cY, 1.0)) {
    return { px: [], py: [], visitedCount: 0 };
  }

  let visitedCount = 0;
  const markVisited = (ix, iy) => {
    ix = Math.trunc(ix);
    iy = Math.trunc(iy);
    if (ix < 0 || ix >= gridMap.width || iy < 0 || iy >= gridMap.height) {
      return;
    }
    const prev = gridMap.data[iy][ix];
    if (prev >= 1.0) return;
    if (prev < 0.5) {
      gridMap.data[iy][ix] = 0.5;
      visitedCount += 1;
    }
  };
  markVisited(cX, cY);

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
    markVisited(cX, cY);
  }

  return { px, py, visitedCount };
}

function buildRowSegments(gridMap) {
  const rows = Array.from({ length: gridMap.height }, () => []);
  for (let iy = 0; iy < gridMap.height; iy++) {
    let ix = 0;
    while (ix < gridMap.width) {
      if (gridMap.data[iy][ix] < 1.0) {
        const start = ix;
        while (ix + 1 < gridMap.width && gridMap.data[iy][ix + 1] < 1.0) {
          ix += 1;
        }
        rows[iy].push({ x0: start, x1: ix });
      }
      ix += 1;
    }
  }
  return rows;
}

function compressGridPath(path) {
  if (path.length <= 2) return path.slice();
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [px, py] = path[i - 1];
    const [cx, cy] = path[i];
    const [nx, ny] = path[i + 1];
    const dx1 = cx - px;
    const dy1 = cy - py;
    const dx2 = nx - cx;
    const dy2 = ny - cy;
    if (dx1 !== dx2 || dy1 !== dy2) {
      out.push([cx, cy]);
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

function createGridPathfinder(gridMap) {
  const width = gridMap.width;
  const height = gridMap.height;
  const size = width * height;
  const visitStamp = new Int32Array(size);
  const gScore = new Int32Array(size);
  const cameFrom = new Int32Array(size);
  let stamp = 1;

  const heap = {
    idx: [],
    f: [],
  };

  const heapPush = (idx, f) => {
    heap.idx.push(idx);
    heap.f.push(f);
    let i = heap.idx.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (heap.f[parent] <= heap.f[i]) break;
      [heap.f[parent], heap.f[i]] = [heap.f[i], heap.f[parent]];
      [heap.idx[parent], heap.idx[i]] = [heap.idx[i], heap.idx[parent]];
      i = parent;
    }
  };

  const heapPop = () => {
    if (!heap.idx.length) return null;
    const idx = heap.idx[0];
    const f = heap.f[0];
    const lastIdx = heap.idx.pop();
    const lastF = heap.f.pop();
    if (heap.idx.length) {
      heap.idx[0] = lastIdx;
      heap.f[0] = lastF;
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < heap.f.length && heap.f[left] < heap.f[smallest]) {
          smallest = left;
        }
        if (right < heap.f.length && heap.f[right] < heap.f[smallest]) {
          smallest = right;
        }
        if (smallest === i) break;
        [heap.f[i], heap.f[smallest]] = [heap.f[smallest], heap.f[i]];
        [heap.idx[i], heap.idx[smallest]] = [heap.idx[smallest], heap.idx[i]];
        i = smallest;
      }
    }
    return { idx, f };
  };

  const isFree = (ix, iy) =>
    ix >= 0 &&
    ix < width &&
    iy >= 0 &&
    iy < height &&
    gridMap.data[iy][ix] < 1.0;

  const findPath = (start, goal) => {
    if (!start || !goal) return [];
    const [sx, sy] = start;
    const [gx, gy] = goal;
    if (sx === gx && sy === gy) return [start];
    if (!isFree(sx, sy) || !isFree(gx, gy)) {
      return [start, goal];
    }

    stamp += 1;
    if (stamp >= 0x7fffffff) {
      visitStamp.fill(0);
      stamp = 1;
    }

    heap.idx.length = 0;
    heap.f.length = 0;
    const startIdx = sy * width + sx;
    const goalIdx = gy * width + gx;
    const hStart = Math.abs(gx - sx) + Math.abs(gy - sy);
    gScore[startIdx] = 0;
    visitStamp[startIdx] = stamp;
    cameFrom[startIdx] = -1;
    heapPush(startIdx, hStart);

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    while (heap.idx.length) {
      const node = heapPop();
      if (!node) break;
      const idx = node.idx;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (idx === goalIdx) break;

      const currentG = visitStamp[idx] === stamp ? gScore[idx] : 0;
      const expectedF = currentG + Math.abs(gx - x) + Math.abs(gy - y);
      if (expectedF !== node.f) {
        continue;
      }

      for (let i = 0; i < dirs.length; i++) {
        const nx = x + dirs[i][0];
        const ny = y + dirs[i][1];
        if (!isFree(nx, ny)) continue;
        const nIdx = ny * width + nx;
        const tentativeG = currentG + 1;
        if (visitStamp[nIdx] !== stamp || tentativeG < gScore[nIdx]) {
          gScore[nIdx] = tentativeG;
          visitStamp[nIdx] = stamp;
          cameFrom[nIdx] = idx;
          const f = tentativeG + Math.abs(gx - nx) + Math.abs(gy - ny);
          heapPush(nIdx, f);
        }
      }
    }

    if (visitStamp[goalIdx] !== stamp) {
      return [start, goal];
    }

    const path = [];
    let cur = goalIdx;
    while (cur !== -1) {
      path.push([cur % width, Math.floor(cur / width)]);
      cur = cameFrom[cur];
    }
    path.reverse();
    return compressGridPath(path);
  };

  return { findPath };
}

function buildRowSweepPath(gridMap, movingDirection, sweepDirection) {
  const segmentsByRow = buildRowSegments(gridMap);
  const pathfinder = createGridPathfinder(gridMap);
  const indices = [];
  let last = null;
  let dir = movingDirection;

  const pushIndex = (ix, iy) => {
    if (!indices.length) {
      indices.push([ix, iy]);
      return;
    }
    const prev = indices[indices.length - 1];
    if (prev[0] === ix && prev[1] === iy) return;
    indices.push([ix, iy]);
  };

  const appendPath = (path, skipFirst) => {
    if (!path || !path.length) return;
    for (let i = skipFirst ? 1 : 0; i < path.length; i++) {
      pushIndex(path[i][0], path[i][1]);
    }
  };

  const rowStart = sweepDirection === SweepDirection.UP ? 0 : gridMap.height - 1;
  const rowEnd = sweepDirection === SweepDirection.UP ? gridMap.height : -1;
  const rowStep = sweepDirection === SweepDirection.UP ? 1 : -1;

  for (let iy = rowStart; iy !== rowEnd; iy += rowStep) {
    const segs = segmentsByRow[iy];
    if (!segs || !segs.length) continue;
    const ordered = segs.slice().sort((a, b) =>
      dir === MovingDirection.RIGHT ? a.x0 - b.x0 : b.x1 - a.x1
    );

    for (let s = 0; s < ordered.length; s++) {
      const seg = ordered[s];
      const start = dir === MovingDirection.RIGHT ? [seg.x0, iy] : [seg.x1, iy];
      const end = dir === MovingDirection.RIGHT ? [seg.x1, iy] : [seg.x0, iy];

      if (last) {
        const connector = pathfinder.findPath(last, start);
        appendPath(connector, true);
      } else {
        pushIndex(start[0], start[1]);
      }

      pushIndex(end[0], end[1]);
      last = end;
    }
    dir *= -1;
  }

  const px = [];
  const py = [];
  indices.forEach(([ix, iy]) => {
    const [wx, wy] = gridMap.indexToWorld(ix, iy);
    px.push(wx);
    py.push(wy);
  });

  return { px, py, visitedCount: gridMap.freeCount };
}

function planning(
  ox,
  oy,
  spacingMeters,
  movingDirection,
  sweepDirection,
  orientation
) {
  const { vec: sweepVec, sweepStart } = getSweepVectorAndStart(
    ox,
    oy,
    orientation
  );
  const [rox, roy] = convertGridCoordinate(ox, oy, sweepVec, sweepStart);
  const { gridMap, xGoal, goalY } = setupGridMap(rox, roy, spacingMeters, sweepDirection);
  const sweeper = new SweepSearcher(movingDirection, sweepDirection, xGoal, goalY);
  const sweepRes = sweepPathSearch(sweeper, gridMap);
  let px = sweepRes.px;
  let py = sweepRes.py;
  const needsFallback =
    Number.isFinite(gridMap.freeCount) &&
    gridMap.freeCount > 0 &&
    sweepRes.visitedCount < gridMap.freeCount;
  if (needsFallback) {
    const fallback = buildRowSweepPath(
      gridMap,
      movingDirection,
      sweepDirection
    );
    px = fallback.px;
    py = fallback.py;
  } else {
    [px, py] = snapTurningPointsToBorder(px, py, rox, roy, spacingMeters);
  }
  let [rx, ry] = convertGlobalCoordinate(px, py, sweepVec, sweepStart);
  const tol = Number.isFinite(spacingMeters)
    ? Math.max(1e-6, spacingMeters * 1e-6)
    : 1e-6;
  [rx, ry] = sanitizePolyline(rx, ry, tol);
  return [rx, ry];
}

function extractTurningIndices(rx, ry, angleTolDeg = 1.0) {
  const n = rx.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const dirs = [];
  const segIdx = [];
  const minSeg = 1e-6;
  for (let i = 0; i < n - 1; i++) {
    const dx = rx[i + 1] - rx[i];
    const dy = ry[i + 1] - ry[i];
    const len = Math.hypot(dx, dy);
    if (len <= minSeg) continue;
    dirs.push([dx / len, dy / len]);
    segIdx.push(i);
  }
  if (!dirs.length) return [0, n - 1];
  const turnInds = [0];
  const cosTol = Math.cos((angleTolDeg * Math.PI) / 180.0);
  for (let i = 0; i < dirs.length - 1; i++) {
    const dot = dirs[i][0] * dirs[i + 1][0] + dirs[i][1] * dirs[i + 1][1];
    if (dot < cosTol) {
      turnInds.push(segIdx[i] + 1);
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

function resolutionSpacingFromLevel(levelVal, baseStepVal, maxLevel, maxSpacing, minSpacing) {
  const levelMin = 1;
  const levelMax = Math.max(1, (maxLevel || 0) + 1);
  const levelUsed = Math.min(
    Math.max(Math.round(levelVal || levelMax), levelMin),
    levelMax
  );
  const hasLinear =
    Number.isFinite(maxSpacing) &&
    Number.isFinite(minSpacing) &&
    maxSpacing > 0 &&
    minSpacing > 0 &&
    maxSpacing >= minSpacing;
  if (hasLinear) {
    if (maxSpacing === minSpacing || (maxLevel || 0) <= 0) {
      return { levelUsed, spacing: maxSpacing, kVal: null };
    }
    const span = maxSpacing - minSpacing;
    const t = (levelUsed - 1) / (maxLevel || 1);
    const spacing = maxSpacing - span * t;
    return { levelUsed, spacing, kVal: null };
  }

  const kExp = (maxLevel || 0) - (levelUsed - 1);
  const kVal = Math.max(1, Math.pow(2, kExp));
  const spacing = Number.isFinite(baseStepVal) ? baseStepVal * kVal : NaN;
  return { levelUsed, spacing, kVal };
}

// Midpoint refinement keeps existing points fixed while increasing density.
function buildMidpointDistances(turnDistArr, spacingTarget, minSpacing) {
  if (!turnDistArr || turnDistArr.length < 2) return [];
  const spacing = Math.max(spacingTarget, 1e-6);
  const minSpace =
    Number.isFinite(minSpacing) && minSpacing > 0 ? minSpacing : spacing;
  const tol = Math.max(1e-7, spacing * 1e-6);
  const out = [];

  for (let i = 0; i < turnDistArr.length - 1; i++) {
    const start = turnDistArr[i];
    const end = turnDistArr[i + 1];
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const segLen = end - start;
    if (segLen <= tol) {
      if (!out.length || Math.abs(end - out[out.length - 1]) > tol) {
        out.push(end);
      }
      continue;
    }

    const ratio = segLen / spacing;
    // Slight bias so early levels add midpoints sooner.
    const ratioBoost = 1.3;
    const boostedRatio = ratio * ratioBoost;
    const desiredLevel = Math.max(
      0,
      Math.round(Math.log2(Math.max(boostedRatio, 1e-6)))
    );
    const minRatio = segLen / minSpace;
    const maxRefineLevel = Math.max(
      0,
      Math.floor(Math.log2(Math.max(minRatio, 1e-6)))
    );
    const refineLevel = Math.min(desiredLevel, maxRefineLevel);
    const subdiv = Math.pow(2, refineLevel);

    for (let k = 0; k <= subdiv; k++) {
      const dist = start + (segLen * k) / subdiv;
      if (!out.length || Math.abs(dist - out[out.length - 1]) > tol) {
        out.push(dist);
      } else {
        out[out.length - 1] = dist;
      }
    }
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
      rx,
      ry,
      baseStepVal: 1,
      baseDistArr: [0],
      turnDistArr: [0],
      totalLen: 0,
      maxLevel: 0,
      minSpacing: 1,
      maxSpacing: 1,
    };
  }

  [rx, ry] = sanitizePolyline(rx, ry);
  if (rx.length < 2 || ry.length < 2) {
    return {
      rx,
      ry,
      baseStepVal: 1,
      baseDistArr: [0],
      turnDistArr: [0],
      totalLen: 0,
      maxLevel: 0,
      minSpacing: 1,
      maxSpacing: 1,
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
      rx,
      ry,
      baseStepVal: 1,
      baseDistArr: [0],
      turnDistArr: [0],
      totalLen: 0,
      maxLevel: 0,
      minSpacing: 1,
      maxSpacing: 1,
    };
  }

  const turnInds = extractTurningIndices(rx, ry, turningAngleTolDeg);
  const turnDistArr = turnInds.map((idx) => cumLen[Math.min(idx, cumLen.length - 1)]);
  const turnSet = Array.from(new Set(turnDistArr.concat([0, totalLen]))).sort(
    (a, b) => a - b
  );

  const segmentLens = [];
  for (let i = 0; i < turnSet.length - 1; i++) {
    const segLen = turnSet[i + 1] - turnSet[i];
    if (Number.isFinite(segLen) && segLen > 0) {
      segmentLens.push(segLen);
    }
  }

  const maxPoints = Math.max(2, maxWaypoints);
  const segmentCount = Math.max(1, segmentLens.length || turnSet.length - 1);
  const minSpacingByCount = totalLen / Math.max(1, maxPoints - segmentCount);
  const minSpacing = Math.max(minBaseStep, minSpacingByCount);
  const maxSegLen = segmentLens.length ? Math.max(...segmentLens) : totalLen;
  const maxSpacing = Math.max(maxSegLen, minSpacing);
  const spacingRatio = maxSpacing / Math.max(minSpacing, 1e-6);
  let maxLevel = 0;
  if (spacingRatio > 1 + 1e-6) {
    maxLevel = Math.round(Math.log2(spacingRatio) * 5);
    maxLevel = Math.min(Math.max(maxLevel, 1), 60);
  }

  const baseStepVal = minSpacing;
  const baseDistArr = [0];

  return {
    rx,
    ry,
    baseStepVal,
    baseDistArr,
    turnDistArr: turnSet,
    totalLen,
    maxLevel,
    minSpacing,
    maxSpacing,
  };
}

function generatePhotoWaypointsByResolutionLevel(
  rx,
  ry,
  resolutionLevelVal,
  baseStepVal,
  turnDistArr,
  maxLevel,
  maxSpacing,
  minSpacing
) {
  if (
    !turnDistArr ||
    !turnDistArr.length ||
    !Number.isFinite(baseStepVal) ||
    !rx ||
    !ry ||
    rx.length < 2 ||
    ry.length < 2
  ) {
    return { wx: [], wy: [], levelUsed: 1, photoSpacingUsed: baseStepVal, count: 0 };
  }

  const spacingInfo = resolutionSpacingFromLevel(
    resolutionLevelVal,
    baseStepVal,
    maxLevel,
    maxSpacing,
    minSpacing
  );
  if (!Number.isFinite(spacingInfo.spacing)) {
    return { wx: [], wy: [], levelUsed: spacingInfo.levelUsed, photoSpacingUsed: spacingInfo.spacing, count: 0 };
  }
  const distArr = buildMidpointDistances(
    turnDistArr,
    spacingInfo.spacing,
    minSpacing
  );
  if (!distArr.length) {
    return { wx: [], wy: [], levelUsed: spacingInfo.levelUsed, photoSpacingUsed: spacingInfo.spacing, count: 0 };
  }

  const [wx, wy] = samplePolylineAtDistances(rx, ry, distArr);
  return {
    wx,
    wy,
    levelUsed: spacingInfo.levelUsed,
    photoSpacingUsed: spacingInfo.spacing,
    count: distArr.length,
  };
}

function resolutionLevelFromMeters(
  resolutionMeters,
  baseStepVal,
  maxLevel,
  maxSpacing,
  minSpacing
) {
  if (!Number.isFinite(resolutionMeters) || resolutionMeters <= 0) {
    return 1;
  }
  const maxLevelVal = Math.max(0, maxLevel || 0);
  const levelMax = maxLevelVal + 1;
  const hasLinear =
    Number.isFinite(maxSpacing) &&
    Number.isFinite(minSpacing) &&
    maxSpacing > 0 &&
    minSpacing > 0 &&
    maxSpacing >= minSpacing;
  if (hasLinear && maxSpacing !== minSpacing && maxLevelVal > 0) {
    const spacing = Math.min(Math.max(resolutionMeters, minSpacing), maxSpacing);
    const span = maxSpacing - minSpacing;
    const t = (maxSpacing - spacing) / span;
    const level = 1 + Math.round(t * maxLevelVal);
    return Math.min(Math.max(level, 1), levelMax);
  }
  if (hasLinear && maxSpacing === minSpacing) {
    return 1;
  }
  if (!Number.isFinite(baseStepVal) || baseStepVal <= 0) {
    return 1;
  }
  const desiredK = resolutionMeters / Math.max(baseStepVal, 1e-6);
  const kExp = Math.round(Math.log2(Math.max(desiredK, 1e-6)));
  const clampedExp = Math.min(Math.max(0, kExp), maxLevelVal);
  const level = maxLevelVal - clampedExp + 1;
  return Math.min(Math.max(level, 1), levelMax);
}

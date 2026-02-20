import { PathCellConfig } from "./types";
import { createSeededRandom, shuffledCopy } from "./random";

export interface GeneratedMapData {
  path: PathCellConfig[];
  obstacles: PathCellConfig[];
  usedFallback: boolean;
}

export interface ProceduralMapGenerationParams {
  cols: number;
  rows: number;
  seed: number;
  obstacleDensity: number;
  maxAttempts: number;
  start?: PathCellConfig;
  end?: PathCellConfig;
}

export function generateProceduralMap(
  params: ProceduralMapGenerationParams
): GeneratedMapData {
  const random = createSeededRandom(params.seed);
  const start = clampAnchor(params.start ?? { col: 0, row: Math.floor(params.rows / 2) }, params.cols, params.rows);
  const end = clampAnchor(
    params.end ?? { col: params.cols - 1, row: Math.floor(params.rows / 2) },
    params.cols,
    params.rows
  );

  const totalCells = params.cols * params.rows;
  const baseObstacleCount = Math.max(
    0,
    Math.min(totalCells - 2, Math.round(totalCells * params.obstacleDensity))
  );
  const candidateIndexes: number[] = [];
  const startIndex = toCellIndex(start.col, start.row, params.cols);
  const endIndex = toCellIndex(end.col, end.row, params.cols);

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    if (cellIndex !== startIndex && cellIndex !== endIndex) {
      candidateIndexes.push(cellIndex);
    }
  }

  const attempts = Math.max(1, params.maxAttempts);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const reductionFactor = Math.max(0.55, 1 - attempt * 0.07);
    const targetObstacleCount = Math.max(
      0,
      Math.min(
        candidateIndexes.length,
        Math.round(baseObstacleCount * reductionFactor)
      )
    );
    const obstacleSet = pickObstacleSet(
      random,
      candidateIndexes,
      targetObstacleCount
    );
    const pathIndexes = findPathIndexes(
      params.cols,
      params.rows,
      startIndex,
      endIndex,
      obstacleSet
    );
    if (pathIndexes.length >= 2) {
      return {
        path: pathIndexes.map((cellIndex) => fromCellIndex(cellIndex, params.cols)),
        obstacles: Array.from(obstacleSet)
          .sort((left, right) => left - right)
          .map((cellIndex) => fromCellIndex(cellIndex, params.cols)),
        usedFallback: false
      };
    }
  }

  // Guaranteed fallback path without obstacles.
  const fallbackPathIndexes = findPathIndexes(
    params.cols,
    params.rows,
    startIndex,
    endIndex,
    new Set<number>()
  );
  if (fallbackPathIndexes.length >= 2) {
    return {
      path: fallbackPathIndexes.map((cellIndex) => fromCellIndex(cellIndex, params.cols)),
      obstacles: [],
      usedFallback: true
    };
  }

  const directPath = buildDirectPath(start, end, params.cols);
  return {
    path: directPath,
    obstacles: [],
    usedFallback: true
  };
}

function pickObstacleSet(
  random: () => number,
  candidates: number[],
  count: number
): Set<number> {
  if (count <= 0) {
    return new Set<number>();
  }

  const shuffled = shuffledCopy(random, candidates);
  const obstacleSet = new Set<number>();
  for (let index = 0; index < count && index < shuffled.length; index += 1) {
    obstacleSet.add(shuffled[index]);
  }
  return obstacleSet;
}

function findPathIndexes(
  cols: number,
  rows: number,
  startIndex: number,
  endIndex: number,
  blocked: Set<number>
): number[] {
  if (blocked.has(startIndex) || blocked.has(endIndex)) {
    return [];
  }
  if (startIndex === endIndex) {
    return [startIndex];
  }

  const total = cols * rows;
  const visited = new Uint8Array(total);
  const parents = new Int32Array(total);
  parents.fill(-1);

  const queue: number[] = [startIndex];
  visited[startIndex] = 1;

  let queueIndex = 0;
  let found = false;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    if (current === endIndex) {
      found = true;
      break;
    }

    const neighbours = getNeighbourIndexes(current, cols, rows);
    for (const neighbour of neighbours) {
      if (visited[neighbour] === 1 || blocked.has(neighbour)) {
        continue;
      }
      visited[neighbour] = 1;
      parents[neighbour] = current;
      queue.push(neighbour);
    }
  }

  if (!found) {
    return [];
  }

  const path: number[] = [];
  let cursor = endIndex;
  while (cursor >= 0) {
    path.push(cursor);
    if (cursor === startIndex) {
      break;
    }
    cursor = parents[cursor];
  }

  path.reverse();
  return path;
}

function getNeighbourIndexes(
  cellIndex: number,
  cols: number,
  rows: number
): number[] {
  const col = cellIndex % cols;
  const row = Math.floor(cellIndex / cols);
  const neighbours: number[] = [];
  if (col > 0) {
    neighbours.push(toCellIndex(col - 1, row, cols));
  }
  if (col < cols - 1) {
    neighbours.push(toCellIndex(col + 1, row, cols));
  }
  if (row > 0) {
    neighbours.push(toCellIndex(col, row - 1, cols));
  }
  if (row < rows - 1) {
    neighbours.push(toCellIndex(col, row + 1, cols));
  }
  return neighbours;
}

function buildDirectPath(
  start: PathCellConfig,
  end: PathCellConfig,
  cols: number
): PathCellConfig[] {
  const path: PathCellConfig[] = [];
  let currentCol = start.col;
  let currentRow = start.row;
  path.push({ col: currentCol, row: currentRow });

  while (currentCol !== end.col) {
    currentCol += end.col > currentCol ? 1 : -1;
    path.push({ col: currentCol, row: currentRow });
  }
  while (currentRow !== end.row) {
    currentRow += end.row > currentRow ? 1 : -1;
    path.push({ col: currentCol, row: currentRow });
  }

  // Safety for tiny maps where start and end may collapse after clamping.
  if (path.length < 2) {
    const fallbackCol = Math.max(0, Math.min(cols - 1, currentCol + 1));
    path.push({ col: fallbackCol, row: currentRow });
  }

  return path;
}

function clampAnchor(
  point: PathCellConfig,
  cols: number,
  rows: number
): PathCellConfig {
  return {
    col: Math.max(0, Math.min(cols - 1, Math.floor(point.col))),
    row: Math.max(0, Math.min(rows - 1, Math.floor(point.row)))
  };
}

function toCellIndex(col: number, row: number, cols: number): number {
  return row * cols + col;
}

function fromCellIndex(cellIndex: number, cols: number): PathCellConfig {
  return {
    col: cellIndex % cols,
    row: Math.floor(cellIndex / cols)
  };
}

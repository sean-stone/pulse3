export function distance(a: number[], b: number[]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const az = Number(a[2]);
  const bz = Number(b[2]);
  if (Number.isFinite(az) && Number.isFinite(bz)) {
    return Math.hypot(dx, dy, bz - az);
  }
  return Math.hypot(dx, dy);
}

function cloneCoord(coord: number[]) {
  return [...coord];
}

function interpolateCoord(prev: number[], curr: number[], t: number) {
  const interpolated: number[] = [
    prev[0] + (curr[0] - prev[0]) * t,
    prev[1] + (curr[1] - prev[1]) * t
  ];

  const maxDimensions = Math.max(prev.length, curr.length);
  for (let dim = 2; dim < maxDimensions; dim += 1) {
    const prevValue = Number(prev[dim]);
    const currValue = Number(curr[dim]);
    if (Number.isFinite(prevValue) && Number.isFinite(currValue)) {
      interpolated.push(prevValue + (currValue - prevValue) * t);
      continue;
    }
    if (Number.isFinite(prevValue)) {
      interpolated.push(prevValue);
      continue;
    }
    if (Number.isFinite(currValue)) {
      interpolated.push(currValue);
    }
  }

  return interpolated;
}

export function polylineLength(paths: number[][][]) {
  let total = 0;
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      total += distance(path[i - 1], path[i]);
    }
  }
  return total;
}

export function buildPartialPaths(
  paths: number[][][],
  progress: number,
  reverse: boolean
) {
  if (progress <= 0) {
    const endpointPath = reverse
      ? [...paths].reverse().find((path) => Array.isArray(path) && path.length > 0) || []
      : paths.find((path) => Array.isArray(path) && path.length > 0) || [];
    const endpointCoord = reverse ? endpointPath[endpointPath.length - 1] : endpointPath[0];
    const firstPoint = endpointCoord ? cloneCoord(endpointCoord) : [];
    return firstPoint.length ? [[firstPoint]] : [];
  }

  if (progress >= 1) {
    return paths.map((path) => path.map((coord) => cloneCoord(coord)));
  }

  const ordered = reverse
    ? paths.map((path) => [...path].reverse()).reverse()
    : paths;

  const totalLength = polylineLength(ordered);
  if (totalLength <= 0) {
    return paths.map((path) => path.map((coord) => cloneCoord(coord)));
  }
  const targetLength = totalLength * progress;

  const resultPaths: number[][][] = [];
  let remaining = targetLength;

  for (const path of ordered) {
    if (path.length === 0) continue;
    const resultPath: number[][] = [cloneCoord(path[0])];

    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const segmentLength = distance(prev, curr);

      if (remaining <= 0) {
        break;
      }

      if (segmentLength <= remaining) {
        resultPath.push(cloneCoord(curr));
        remaining -= segmentLength;
      } else {
        const t = remaining / segmentLength;
        resultPath.push(interpolateCoord(prev, curr, t));
        remaining = 0;
        break;
      }
    }

    resultPaths.push(resultPath);

    if (remaining <= 0) break;
  }

  return resultPaths;
}

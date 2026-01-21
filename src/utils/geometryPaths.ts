export function distance(a: number[], b: number[]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
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
    const firstPath = paths[0] || [];
    const firstPoint = firstPath[0] ? [firstPath[0][0], firstPath[0][1]] : [];
    return firstPoint.length ? [[firstPoint]] : [];
  }

  if (progress >= 1) {
    return paths.map((path) => path.map((coord) => [coord[0], coord[1]]));
  }

  const ordered = reverse
    ? paths.map((path) => [...path].reverse()).reverse()
    : paths;

  const totalLength = polylineLength(ordered);
  if (totalLength <= 0) {
    return paths.map((path) => path.map((coord) => [coord[0], coord[1]]));
  }
  const targetLength = totalLength * progress;

  const resultPaths: number[][][] = [];
  let remaining = targetLength;

  for (const path of ordered) {
    if (path.length === 0) continue;
    const resultPath: number[][] = [path[0]];

    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const segmentLength = distance(prev, curr);

      if (remaining <= 0) {
        break;
      }

      if (segmentLength <= remaining) {
        resultPath.push(curr);
        remaining -= segmentLength;
      } else {
        const t = remaining / segmentLength;
        resultPath.push([
          prev[0] + (curr[0] - prev[0]) * t,
          prev[1] + (curr[1] - prev[1]) * t
        ]);
        remaining = 0;
        break;
      }
    }

    resultPaths.push(resultPath);

    if (remaining <= 0) break;
  }

  return resultPaths;
}

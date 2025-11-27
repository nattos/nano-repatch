export interface GridPoint {
  x: number;
  y: number;
}

export interface WireDef {
  id: string;
  start: GridPoint;
  end: GridPoint;
  // Stable hash inputs
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
}

export interface WireLayout {
  path: GridPoint[];
  // Map of segment key "x1,y1:x2,y2" to lane info
  lanes: Record<string, { index: number; count: number }>;
}

export interface LayoutResult {
  wires: Record<string, WireLayout>;
}

export interface LayoutOptions {
  obstacles?: GridPoint[]; // Points occupied by nodes
  previousResult?: LayoutResult;
  changedWireIds?: string[]; // IDs of wires that need re-routing
}

function manhattan(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function pointsEqual(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function getKey(p: GridPoint): string {
  return `${p.x},${p.y}`;
}

export function computeWireLayout(wires: WireDef[], options: LayoutOptions = {}): LayoutResult {
  const result: LayoutResult = { wires: {} };
  const obstacles = new Set((options.obstacles || []).map(getKey));
  const changedSet = options.changedWireIds ? new Set(options.changedWireIds) : null;

  for (const wire of wires) {
    // Check if we can reuse the previous path
    if (options.previousResult && changedSet && !changedSet.has(wire.id) && options.previousResult.wires[wire.id]) {
      result.wires[wire.id] = {
        path: options.previousResult.wires[wire.id].path,
        lanes: {} // Lanes are always recomputed
      };
      continue;
    }

    // A* Search on 2x Grid
    // Scale coordinates: 1x grid point (x,y) -> 2x grid point (2x, 2y)
    const start2x = { x: wire.start.x * 2, y: wire.start.y * 2 };
    const end2x = { x: wire.end.x * 2, y: wire.end.y * 2 };

    const openSet: GridPoint[] = [start2x];
    const cameFrom = new Map<string, GridPoint>();
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();

    gScore.set(getKey(start2x), 0);
    fScore.set(getKey(start2x), manhattan(start2x, end2x));

    let path2x: GridPoint[] = [];

    while (openSet.length > 0) {
      openSet.sort((a, b) => (fScore.get(getKey(a)) ?? Infinity) - (fScore.get(getKey(b)) ?? Infinity));
      const current = openSet.shift()!;

      if (pointsEqual(current, end2x)) {
        let curr = current;
        path2x = [curr];
        while (cameFrom.has(getKey(curr))) {
          curr = cameFrom.get(getKey(curr))!;
          path2x.unshift(curr);
        }
        break;
      }

      const neighbors: GridPoint[] = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ];

      for (const neighbor of neighbors) {
        const neighborKey = getKey(neighbor);

        // Check obstacles
        // In 2x grid, obstacles are at (even, even).
        // We allow the start and end points even if they are obstacles (ports are inside nodes).
        const isObstacle = (neighbor.x % 2 === 0 && neighbor.y % 2 === 0) &&
          obstacles.has(getKey({ x: neighbor.x / 2, y: neighbor.y / 2 }));

        if (isObstacle && !pointsEqual(neighbor, end2x) && !pointsEqual(neighbor, start2x)) {
          continue;
        }

        const tentativeGScore = (gScore.get(getKey(current)) ?? Infinity) + 1;

        // Cost Modification for H-V-H Preference
        let moveCost = 1;
        const isVertical = neighbor.x === current.x; // Moving in Y (x is constant)

        if (isVertical) {
          // 1. Port Constraint: Penalize Vertical at Start/End
          // We want to leave/enter ports horizontally.
          if (pointsEqual(current, start2x)) moveCost += 50;
          if (pointsEqual(neighbor, end2x)) moveCost += 50;

          // 2. Centering: Prefer vertical segments near middle
          // Calculate midpoint of the gap
          const midX = (start2x.x + end2x.x) / 2;
          // Add small penalty proportional to distance from midX
          // This biases towards the center without overriding the main path
          moveCost += 0.05 * Math.abs(neighbor.x - midX);
        }

        const newGScore = (gScore.get(getKey(current)) ?? Infinity) + moveCost;

        if (newGScore < (gScore.get(neighborKey) ?? Infinity)) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, newGScore);
          fScore.set(neighborKey, newGScore + manhattan(neighbor, end2x));

          if (!openSet.some(p => pointsEqual(p, neighbor))) {
            openSet.push(neighbor);
          }
        }
      }
    }

    // Convert path back to 1x coordinates (fractional)
    const path = path2x.length > 0 ? path2x.map(p => ({ x: p.x / 2, y: p.y / 2 })) : [wire.start, wire.end];

    result.wires[wire.id] = {
      path,
      lanes: {}
    };
  }

  // Lane Assignment
  const segmentMap = new Map<string, string[]>(); // key -> wireIds[]

  for (const wire of wires) {
    const layout = result.wires[wire.id];
    for (let i = 0; i < layout.path.length - 1; i++) {
      const p1 = layout.path[i];
      const p2 = layout.path[i + 1];
      const k1 = getKey(p1);
      const k2 = getKey(p2);
      const key = k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;

      if (!segmentMap.has(key)) {
        segmentMap.set(key, []);
      }
      segmentMap.get(key)!.push(wire.id);
    }
  }

  // Assign indices
  for (const [key, wireIds] of segmentMap.entries()) {
    // Sort wires by stable hash
    wireIds.sort((a, b) => {
      const wa = wires.find(w => w.id === a)!;
      const wb = wires.find(w => w.id === b)!;
      const ha = simpleHash(`${wa.fromNodeId}:${wa.fromPort}:${wa.toNodeId}:${wa.toPort}`);
      const hb = simpleHash(`${wb.fromNodeId}:${wb.fromPort}:${wb.toNodeId}:${wb.toPort}`);
      return ha - hb;
    });

    for (let i = 0; i < wireIds.length; i++) {
      const wireId = wireIds[i];
      result.wires[wireId].lanes[key] = {
        index: i,
        count: wireIds.length
      };
    }
  }

  return result;
}

function simpleHash(str: string) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    let chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

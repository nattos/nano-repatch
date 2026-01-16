import { MinHeap } from '../utils/min-heap';

/**
 * Wire Layout Engine
 *
 * Computes wires on a Logical Grid using A* with Gap bias.
 */

export interface GridPoint {
    x: number;
    y: number;
}

export interface WireDef {
    id: string;
    start: GridPoint; // Node coordinates (x,y)
    end: GridPoint;   // Node coordinates (x,y)
    fromPort: string;
    toPort: string;
    startOffset?: number; // Row offset from start node top
    endOffset?: number;   // Row offset from end node top
}

export enum SegmentType {
    Horizontal = 'h',
    Vertical = 'v',
    CornerTL = 'ctl',
    CornerTR = 'ctr',
    CornerBL = 'cbl',
    CornerBR = 'cbr',
    Start = 'start', // Stub?
    End = 'end'
}

export interface WireSegment {
    id: string;
    wireId: string;
    x: number;
    y: number;
    type: SegmentType;
    lane?: number; // Deprecated, use laneH for Y-spread
    totalLanes?: number; // Deprecated, use totalHLanes

    // Vertical Spreading (X-offset)
    laneV?: number;
    totalVLanes?: number;

    // Horizontal Spreading (Y-offset)
    laneH?: number;
    totalHLanes?: number;

    length?: number;
    clipTopRem?: number; // If set, clip vertical top to this Rem's offset
    clipBotRem?: number; // If set, clip vertical bot to this Rem's offset
}

export interface LayoutResult {
    segments: WireSegment[];
    wires: Record<string, { path: GridPoint[] }>;
}

// Obstacle Map: "x,y" -> Set of Logical Lanes blocked?
// Or simpler: We just block coordinate strings "x,logicY".
// BUT to support "Wormholes", we need to know the 'Height' of each Node Column.
// Map: `${x},${gridRow}` -> Height (number of used lanes 0..H-1).
interface Obstacle {
    x: number;
    y: number;
    height?: number; // Logical height (1..32)
}

interface InternalObstacle {
    x: number;
    y: number; // Logical Y
}

export interface LayoutOptions {
    obstacles?: Obstacle[];
    algorithm?: 'astar' | 'greedy';
    previousResult?: LayoutResult;
}

function pack(x: number, y: number): number {
    return (x & 0xFFFF) | (y << 16);
}

function unpack(key: number): GridPoint {
    return { x: key & 0xFFFF, y: key >>> 16 };
}

function getKey(p: GridPoint) { return `${p.x},${p.y}`; }
function pointsEqual(a: GridPoint, b: GridPoint) { return a.x === b.x && a.y === b.y; }

export function computeWireLayout(wires: WireDef[], options: LayoutOptions = {}): LayoutResult {
    const segments: WireSegment[] = [];
    const wirePaths: Record<string, { path: GridPoint[] }> = {};

    // 1. Build Obstacle Map (Logical Coordinates) using Packed Integers
    const obstacles = new Set<number>();
    const colHeightMap = new Map<string, number>();

    // Config: Logical Scale
    // X: Odd = Node, Even = Gap. (Base x*2+1).
    // Y: 1 Logical Unit = 1 Grid Row (Possible Lanes).
    // Increased to 32 to support high port count nodes.
    const LOGICAL_Y_SCALE = 32;

    for (const obs of (options.obstacles || [])) {
        const lx = obs.x * 2 + 1;
        const basePathY = obs.y * LOGICAL_Y_SCALE;

        if (obs.height && obs.height > 1) {
            // Register Column Height
            colHeightMap.set(`${lx},${obs.y}`, obs.height);

            const effectiveH = Math.min(obs.height, 31); // Don't block gap lane
            for (let i = 0; i < effectiveH; i++) {
                obstacles.add(pack(lx, basePathY + i));
            }
        } else {
            // Default
            colHeightMap.set(`${lx},${obs.y}`, 1);
            obstacles.add(pack(lx, basePathY));
        }
    }

    const toLogical = (p: GridPoint) => ({
        // Logical Grid aligned with GraphGrid:
        // Nodes are at Odd X (1, 3, 5).
        // Gaps are at Even X (0, 2, 4, 6).
        // Y: 1 Unit = 1 Row.
        x: p.x * 2 + 1,
        y: p.y * LOGICAL_Y_SCALE
    });

    const gridUsage = new Map<number, number>();
    const gridUsageH = new Map<number, number>();
    const currentUsageH = new Map<number, number>();
    const gridUsageV = new Map<number, number>();
    const currentUsageV = new Map<number, number>();

    // 2. Route Wires
    for (const wire of wires) {
        // const startNode = toLogical(wire.start);
        // const endNode = toLogical(wire.end);

        const startP = { x: wire.start.x * 2 + 2, y: wire.start.y * LOGICAL_Y_SCALE + (wire.startOffset || 0) };
        const endP = { x: wire.end.x * 2, y: wire.end.y * LOGICAL_Y_SCALE + (wire.endOffset || 0) };

        let path: GridPoint[] = [];

        // Simple case: Direct connection?
        if (pointsEqual(startP, endP)) {
            path = [startP];
        } else {
            // A* Search Optimized with MinHeap and Integer Keys
            const openSet = new MinHeap();
            const cameFrom = new Map<number, number>();
            const gScore = new Map<number, number>();
            // fScore is stored in the heap item

            const startKey = pack(startP.x, startP.y);
            const endKey = pack(endP.x, endP.y);

            gScore.set(startKey, 0);

            // Virtual Parent to enforce "Horizontal" start direction (Wire comes out of Right)
            // This forces any immediate vertical drop to be considered a 'Turn', incurring penalties.
            const virtualParentKey = pack(startP.x - 1, startP.y);
            cameFrom.set(startKey, virtualParentKey);

            // Heuristic
            const h = (ax: number, ay: number) => Math.abs(ax - endP.x) + Math.abs(ay - endP.y);

            openSet.push(startKey, h(startP.x, startP.y));

            const visited = new Set<number>();

            // Safety Bounds
            const searchMinY = -1;
            const searchMaxY = Math.max(startP.y, endP.y) + 256; // Allow some slack but prevent infinity
            const searchMinX = Math.min(startP.x, endP.x) - 100;
            const searchMaxX = Math.max(startP.x, endP.x) + 100;
            let safetyCounter = 0;
            const SAFETY_LIMIT = 500000; // Increased limit because heap is fast

            while (openSet.size() > 0) {
                safetyCounter++;
                if (safetyCounter > SAFETY_LIMIT) {
                    console.warn(`WireLayout: A* Safety Limit Reached (${SAFETY_LIMIT}) for wire ${wire.id}`);
                    break;
                }

                const currentItem = openSet.pop();
                if (!currentItem) break;
                const currentKey = currentItem.key;

                // If we found the goal
                if (currentKey === endKey) {
                    // Reconstruct
                    let currKey = currentKey;
                    path = [unpack(currKey)];
                    while (cameFrom.has(currKey)) {
                        const prev = cameFrom.get(currKey)!;
                        // Stop if we reach the virtual parent
                        if (prev === virtualParentKey) break;

                        currKey = prev;
                        path.unshift(unpack(currKey));
                    }
                    break;
                }

                // If already visited with a lower cost? Heap doesn't support update key easily,
                // so we might pop duplicates.
                if (visited.has(currentKey)) continue;
                visited.add(currentKey);

                const cP = unpack(currentKey);

                // Neighbors
                // Generate directly
                const neighborsX = [cP.x + 1, cP.x - 1];
                const neighborsY = [cP.y, cP.y];

                // Vertical Steps: Only allow Vertical movement in GAP Columns (Even X).
                if (cP.x % 2 === 0) {
                    if (cP.y > searchMinY) { neighborsX.push(cP.x); neighborsY.push(cP.y - 1); }
                    if (cP.y < searchMaxY) { neighborsX.push(cP.x); neighborsY.push(cP.y + 1); }
                }

                for (let i = 0; i < neighborsX.length; i++) {
                    const nx = neighborsX[i];
                    const ny = neighborsY[i];

                    if (nx < searchMinX || nx > searchMaxX || ny < searchMinY || ny > searchMaxY) continue; // Boundary Check

                    const nKey = pack(nx, ny);
                    // Checking visited here is optimization but technically handled by set check above.
                    // But good for perf.
                    if (visited.has(nKey)) continue;

                    let cost = 1;
                    const isEnd = (nKey === endKey);

                    // Obstacle Check
                    if (obstacles.has(nKey) && !isEnd) {
                        continue; // Blocked
                    }

                    // Turn Penalty (Direction Change)
                    const prevKey = cameFrom.get(currentKey);
                    if (prevKey !== undefined) {
                        const prevP = unpack(prevKey);
                        if (prevP.x !== nx && prevP.y !== ny) {
                            cost += 1;
                            // Gap Turn Penalty: Turning in Gap Column (Even X)
                            if (cP.x % 2 === 0) {
                                cost += 20;
                            }
                        }

                        // Midpoint Bias: Penalize turning Vertical if far from Midpoint
                        // We only care if we are turning FROM Horizontal TO Vertical.
                        // cP is 'current' (parent of neighbor 'n'). prevP is 'grandparent'.
                        // Direction prevP -> cP. Direction cP -> n(nx,ny).
                        const dx1 = cP.x - prevP.x;
                        const dy1 = cP.y - prevP.y;
                        const dx2 = nx - cP.x;
                        const dy2 = ny - cP.y;

                        // Check if turn: (dx1 != dx2 || dy1 != dy2).
                        // Specifically, check if we are turning Vertical (dy2 != 0) from Horizontal (dy1 == 0).
                        if (dy1 === 0 && dy2 !== 0) {
                            const midX = (startP.x + endP.x) / 2;
                            const dist = Math.abs(cP.x - midX);
                            // Penalty proportional to distance from midpoint.
                            // We want to encourage being CLOSE to midX.
                            // A linear penalty.
                            // We need this to optionally outweigh the cost of an extra turn (GapTurn ~20).
                            // If we turn at the end (L-shape), we save 1 turn.
                            // So (Penalty at End) must be > (Cost of Extra Turn).
                            // Penalty > 20.
                            // If End is 10 units away, Factor 2 => 20. Borderline.
                            // Factor 4 => 40. Clearly favors S-shape.
                            // To force S-shape even for close nodes (Dist=1), we need Factor > 20.
                            const midPenalty = dist * 25;
                            cost += midPenalty;
                        }
                    }

                    const tentativeG = (gScore.get(currentKey) || 0) + cost;

                    if (tentativeG < (gScore.get(nKey) || Infinity)) {
                        cameFrom.set(nKey, currentKey);
                        gScore.set(nKey, tentativeG);
                        const f = tentativeG + h(nx, ny);
                        openSet.push(nKey, f);
                    }
                }
            }
        }

        // Check if path found
        if (path.length === 0) {
            // Fallback
            path = [startP, endP];
        }

        // Deduplication
        if (path.length > 0) {
            const dedup: GridPoint[] = [path[0]];
            for (let i = 1; i < path.length; i++) {
                const prev = dedup[dedup.length - 1];
                const curr = path[i];
                if (!pointsEqual(prev, curr)) {
                    dedup.push(curr);
                }
            }
            path = dedup;
        }

        wirePaths[wire.id] = { path };
        for (let i = 0; i < path.length; i++) {
            const p = path[i];
            const k = pack(p.x, p.y);
            gridUsage.set(k, (gridUsage.get(k) || 0) + 1);

            // Determine if this point is part of a Horizontal Wire
            const prev = i > 0 ? path[i - 1] : null;
            const next = i < path.length - 1 ? path[i + 1] : null;

            let isH = false;
            // It is horizontal if we enter or exit horizontally
            if (prev && prev.x !== p.x) isH = true;
            if (next && next.x !== p.x) isH = true;
            // Single point path default to Horizontal (e.g. adjacent nodes)
            if (!prev && !next) isH = true;

            let isV = false;
            // It is vertical if we enter or exit vertically
            if (prev && prev.y !== p.y) isV = true;
            if (next && next.y !== p.y) isV = true;

            if (isH) {
                gridUsageH.set(k, (gridUsageH.get(k) || 0) + 1);
            }
            if (isV) {
                gridUsageV.set(k, (gridUsageV.get(k) || 0) + 1);
            }
        }
    }

    // 3. Assign Lanes
    const currentUsage = new Map<number, number>();
    const GAP_LANE_INDEX = LOGICAL_Y_SCALE - 1;

    for (const wire of wires) {
        const path = wirePaths[wire.id].path;
        if (!path || path.length === 0) continue;

        // Add Start Stub
        const startNode = toLogical(wire.start);
        segments.push({
            id: `${wire.id}-start`,
            wireId: wire.id,
            x: startNode.x,
            y: startNode.y + (wire.startOffset || 0),
            type: SegmentType.Start,
            lane: 0,
            totalLanes: 1,
            length: 1
        });

        // Add End Stub
        const endNode = toLogical(wire.end);
        const endStubY = endNode.y + (wire.endOffset || 0);
        segments.push({
            id: `${wire.id}-end`,
            wireId: wire.id,
            x: endNode.x,
            y: endStubY,
            type: SegmentType.End,
            lane: 0,
            totalLanes: 1,
            length: 1
        });

        for (let i = 0; i < path.length; i++) {
            const p = path[i];
            const k = pack(p.x, p.y); // Use packed key for usage map
            const total = gridUsage.get(k) || 1;
            const index = currentUsage.get(k) || 0;
            currentUsage.set(k, index + 1);


            // Determine Type
            const prev = i > 0 ? path[i - 1] : null;
            const next = i < path.length - 1 ? path[i + 1] : null;

            let type = SegmentType.Horizontal;

            if (prev && next) {
                const dx1 = p.x - prev.x;
                const dy1 = p.y - prev.y;
                const dx2 = next.x - p.x;
                const dy2 = next.y - p.y;

                if (dx1 !== 0 && dx2 !== 0) type = SegmentType.Horizontal;
                else if (dy1 !== 0 && dy2 !== 0) type = SegmentType.Vertical;
                else {
                    if (dx1 === 1 && dy2 > 0) type = SegmentType.CornerTR;
                    else if (dx1 === 1 && dy2 < 0) type = SegmentType.CornerBR;
                    else if (dx1 === -1 && dy2 > 0) type = SegmentType.CornerTL;
                    else if (dx1 === -1 && dy2 < 0) type = SegmentType.CornerBL;
                    else if (dy1 > 0 && dx2 === 1) type = SegmentType.CornerBL;
                    else if (dy1 > 0 && dx2 === -1) type = SegmentType.CornerBR;
                    else if (dy1 < 0 && dx2 === 1) type = SegmentType.CornerTL;
                    else if (dy1 < 0 && dx2 === -1) type = SegmentType.CornerTR;
                }
            } else if (!prev) {
                if (!next) {
                    type = SegmentType.Horizontal;
                } else {
                    type = (next.x !== p.x) ? SegmentType.Horizontal : SegmentType.Vertical;
                }
                if (next) {
                    if (next.y < p.y) type = SegmentType.CornerBR;
                    else if (next.y > p.y) type = SegmentType.CornerTR;
                }
            } else if (!next) {
                if (prev) {
                    const isRight = endNode.x > p.x;
                    if (prev.y < p.y) {
                        type = isRight ? SegmentType.CornerBL : SegmentType.CornerBR;
                    } else if (prev.y > p.y) {
                        type = isRight ? SegmentType.CornerTL : SegmentType.CornerTR;
                    } else {
                        type = SegmentType.Horizontal;
                    }
                }
            }

            let clipTopRem = undefined;
            let clipBotRem = undefined;

            const gridY = Math.floor(p.y / LOGICAL_Y_SCALE);
            const rem = p.y % LOGICAL_Y_SCALE;
            const isNodeRow = rem < GAP_LANE_INDEX;

            // Clipping Logic
            if (isNodeRow) {
                if (prev) {
                    if (prev.x === p.x && prev.y < p.y) {
                        const prevGridY = Math.floor(prev.y / LOGICAL_Y_SCALE);
                        if (prevGridY === gridY) {
                            if ((prev.y % LOGICAL_Y_SCALE) < GAP_LANE_INDEX) {
                                clipTopRem = prev.y % LOGICAL_Y_SCALE;
                            }
                        } else if (prevGridY === gridY - 1) {
                            if ((prev.y % LOGICAL_Y_SCALE) === GAP_LANE_INDEX) {
                                clipTopRem = -1;
                            }
                        }
                    }
                }
                if (next) {
                    if (next.x === p.x && next.y > p.y) {
                        const nextGridY = Math.floor(next.y / LOGICAL_Y_SCALE);
                        if (nextGridY === gridY) {
                            if ((next.y % LOGICAL_Y_SCALE) < GAP_LANE_INDEX) {
                                clipBotRem = next.y % LOGICAL_Y_SCALE;
                            } else if ((next.y % LOGICAL_Y_SCALE) === GAP_LANE_INDEX) {
                                clipBotRem = GAP_LANE_INDEX;
                            }
                        }
                    }
                }

                // Reverse Checks
                if (prev) {
                    if (prev.x === p.x && prev.y > p.y) {
                        const prevGridY = Math.floor(prev.y / LOGICAL_Y_SCALE);
                        if (prevGridY === gridY) {
                            if ((prev.y % LOGICAL_Y_SCALE) < GAP_LANE_INDEX) {
                                clipBotRem = prev.y % LOGICAL_Y_SCALE;
                            } else if ((prev.y % LOGICAL_Y_SCALE) === GAP_LANE_INDEX) {
                                clipBotRem = GAP_LANE_INDEX;
                            }
                        }
                    }
                }
                if (next) {
                    if (next.x === p.x && next.y < p.y) {
                        const nextGridY = Math.floor(next.y / LOGICAL_Y_SCALE);
                        if (nextGridY === gridY) {
                            if ((next.y % LOGICAL_Y_SCALE) < GAP_LANE_INDEX) {
                                clipTopRem = next.y % LOGICAL_Y_SCALE;
                            }
                        }
                    }
                }
            } else {
                if (prev && prev.x === p.x && prev.y < p.y) {
                    clipTopRem = -1;
                }
            }

            if (type === SegmentType.Horizontal || type === SegmentType.CornerBL || type === SegmentType.CornerBR || type === SegmentType.CornerTL || type === SegmentType.CornerTR) {
                const idx = currentUsageH.get(k) || 0;
                currentUsageH.set(k, idx + 1);
            }
            if (type === SegmentType.Vertical || type === SegmentType.CornerBL || type === SegmentType.CornerBR || type === SegmentType.CornerTL || type === SegmentType.CornerTR) {
                const idx = currentUsageV.get(k) || 0;
                currentUsageV.set(k, idx + 1);
            }

            segments.push({
                id: `${wire.id}-${i}`,
                wireId: wire.id,
                x: p.x,
                y: p.y,
                type,
                // Assign BOTH H and V lanes if applicable
                // For pure H, laneH is valid, laneV is undefined
                // For pure V, laneV is valid, laneH is undefined
                // For Corner, BOTH are valid.
                laneH: (type === SegmentType.Horizontal || type === SegmentType.CornerBL || type === SegmentType.CornerBR || type === SegmentType.CornerTL || type === SegmentType.CornerTR) ? (currentUsageH.get(k) || 1) : undefined,
                totalHLanes: (type === SegmentType.Horizontal || type === SegmentType.CornerBL || type === SegmentType.CornerBR || type === SegmentType.CornerTL || type === SegmentType.CornerTR) ? (gridUsageH.get(k) || 0) : undefined,

                laneV: (type === SegmentType.Vertical || type === SegmentType.CornerBL || type === SegmentType.CornerBR || type === SegmentType.CornerTL || type === SegmentType.CornerTR) ? (currentUsageV.get(k) || 1) : undefined,
                totalVLanes: (type === SegmentType.Vertical || type === SegmentType.CornerBL || type === SegmentType.CornerBR || type === SegmentType.CornerTL || type === SegmentType.CornerTR) ? (gridUsageV.get(k) || 0) : undefined,

                length: 1,
                clipTopRem,
                clipBotRem
            });
        }
    }

    // 4. Post-Process Coalescing
    const coalescedSegments: WireSegment[] = [];
    const slotMap = new Map<string, WireSegment[]>();

    for (const seg of segments) {
        const logicalSlot = Math.floor(seg.y / LOGICAL_Y_SCALE);
        const rem = seg.y % LOGICAL_Y_SCALE;

        let gridRowKey = '';
        if (rem < GAP_LANE_INDEX) {
            gridRowKey = `${seg.wireId}:${seg.x}:${logicalSlot}:node`;
        } else {
            gridRowKey = `${seg.wireId}:${seg.x}:${logicalSlot}:gap`;
        }

        if (!slotMap.has(gridRowKey)) slotMap.set(gridRowKey, []);
        slotMap.get(gridRowKey)!.push(seg);
    }

    // Process buckets
    for (const [key, bucket] of slotMap.entries()) {
        const hasCorner = bucket.some(s => s.type !== SegmentType.Horizontal && s.type !== SegmentType.Vertical && s.type !== SegmentType.Start && s.type !== SegmentType.End);

        const extendsHigher = (aRem: number | undefined, bRem: number | undefined) => {
            if (aRem === undefined && bRem !== undefined) return true;
            if (aRem !== undefined && bRem !== undefined && aRem < bRem) return true;
            return false;
        };

        const extendsLower = (aRem: number | undefined, bRem: number | undefined) => {
            if (aRem === undefined && bRem !== undefined) return true;
            if (aRem !== undefined && bRem !== undefined && aRem > bRem) return true;
            return false;
        };

        if (hasCorner) {
            const verticals = bucket.filter(s => s.type === SegmentType.Vertical);
            const corners = bucket.filter(s => s.type !== SegmentType.Vertical && s.type !== SegmentType.Horizontal && s.type !== SegmentType.Start && s.type !== SegmentType.End);

            for (const c of corners) {
                if (c.type === SegmentType.CornerBL || c.type === SegmentType.CornerBR) {
                    for (const v of verticals) {
                        if (extendsHigher(v.clipTopRem, c.clipTopRem)) {
                            c.clipTopRem = v.clipTopRem;
                        }
                    }
                } else if (c.type === SegmentType.CornerTL || c.type === SegmentType.CornerTR) {
                    for (const v of verticals) {
                        if (extendsLower(v.clipBotRem, c.clipBotRem)) {
                            c.clipBotRem = v.clipBotRem;
                        }
                    }
                }
            }

            for (const s of bucket) {
                if (s.type !== SegmentType.Vertical) {
                    coalescedSegments.push(s);
                }
            }
        } else {
            const verticals = bucket.filter(s => s.type === SegmentType.Vertical);
            const others = bucket.filter(s => s.type !== SegmentType.Vertical);

            if (verticals.length > 0) {
                let merged = { ...verticals[0] };
                for (let i = 1; i < verticals.length; i++) {
                    const v = verticals[i];
                    if (extendsHigher(v.clipTopRem, merged.clipTopRem)) {
                        merged.clipTopRem = v.clipTopRem;
                    }
                    if (extendsLower(v.clipBotRem, merged.clipBotRem)) {
                        merged.clipBotRem = v.clipBotRem;
                    }
                }
                coalescedSegments.push(merged);
            }
            coalescedSegments.push(...others);
        }
    }

    return {
        segments: coalescedSegments,
        wires: wirePaths
    };
}

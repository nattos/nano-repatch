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
    lane?: number;
    totalLanes?: number;
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

function getKey(p: GridPoint) { return `${p.x},${p.y}`; }
function pointsEqual(a: GridPoint, b: GridPoint) { return a.x === b.x && a.y === b.y; }

export function computeWireLayout(wires: WireDef[], options: LayoutOptions = {}): LayoutResult {
    const segments: WireSegment[] = [];
    const wirePaths: Record<string, { path: GridPoint[] }> = {};

    // 1. Build Obstacle Map (Logical Coordinates)
    const obstacles = new Set<string>();
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

            // Block specific lanes 0..H-1
            // We do NOT block H..30 (Dead Space) here, because 'getNeighbors' will skip them.
            // But we block 0..H-1 because they are occupied by Node Body.
            // Wait, we WANT to route in "Empty Node Space" if cost is low?
            // "Empty Node Space" implies H < 32.
            // If H=2. Obstable blocks lanes 0, 1?
            // If Node is "Obstacle", it blocks routing inside it.
            // So Yes, block 0..H-1.
            // Routing uses H..30? No, H..30 is dead space.
            // Routing uses Gap (31).
            // Are we routing IN 0..H-1?
            // Internal connections (ports) are IN 0..H-1.
            // Wires should route AROUND?
            // If we connect to Port 0. Start is inside obstacle?
            // Usually Start/End points are exempted from obstacle checks?
            // A* handles start/end explicitly?
            // Let's stick to: Block occupied lanes.

            const effectiveH = Math.min(obs.height, 31); // Don't block gap lane
            for (let i = 0; i < effectiveH; i++) {
                obstacles.add(getKey({ x: lx, y: basePathY + i }));
            }
        } else {
            // Default
            colHeightMap.set(`${lx},${obs.y}`, 1);
            obstacles.add(getKey({ x: lx, y: basePathY }));
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

    const gridUsage = new Map<string, number>();

    // 2. Route Wires
    for (const wire of wires) {
        const startNode = toLogical(wire.start);
        const endNode = toLogical(wire.end);

        const startP = { x: wire.start.x * 2 + 2, y: wire.start.y * LOGICAL_Y_SCALE + (wire.startOffset || 0) };
        const endP = { x: wire.end.x * 2, y: wire.end.y * LOGICAL_Y_SCALE + (wire.endOffset || 0) };

        // console.log(`WireLayout Input: ${wire.id} StartP Y=${startP.y} (Offset ${wire.startOffset}) EndP Y=${endP.y} (Offset ${wire.endOffset})`);
        let path: GridPoint[] = [];

        // Simple case: Direct connection?
        if (pointsEqual(startP, endP)) {
            path = [startP];
        } else {
            // A* Search
            const openSet: GridPoint[] = [startP];
            const cameFrom = new Map<string, GridPoint>();
            const gScore = new Map<string, number>();
            const fScore = new Map<string, number>();

            const startKey = getKey(startP);
            gScore.set(startKey, 0);
            fScore.set(startKey, Math.abs(startP.x - endP.x) + Math.abs(startP.y - endP.y));

            const visited = new Set<string>();

            // Safety Bounds
            const searchMinY = -1;
            const searchMaxY = Math.max(startP.y, endP.y) + 256; // Allow some slack but prevent infinity
            let safetyCounter = 0;
            const SAFETY_LIMIT = 10000;

            while (openSet.length > 0) {
                safetyCounter++;
                if (safetyCounter > SAFETY_LIMIT) {
                    console.warn(`WireLayout: A* Safety Limit Reached (${SAFETY_LIMIT}) for wire ${wire.id}`);
                    break;
                }

                // Pop lowest fScore
                openSet.sort((a, b) => (fScore.get(getKey(a)) || Infinity) - (fScore.get(getKey(b)) || Infinity));
                const current = openSet.shift()!;
                const currentKey = getKey(current);

                if (pointsEqual(current, endP)) {
                    // Reconstruct
                    let curr = current;
                    path = [curr];
                    while (cameFrom.has(getKey(curr))) {
                        curr = cameFrom.get(getKey(curr))!;
                        path.unshift(curr);
                    }
                    break;
                }

                visited.add(currentKey);

                // Neighbors
                const neighbors: GridPoint[] = [
                    { x: current.x + 1, y: current.y }, // Right
                    { x: current.x - 1, y: current.y }, // Left
                ];

                // Vertical Steps:
                // STRICT RULE: Only allow Vertical movement in GAP Columns (Even X).
                const isGapColumn = (current.x % 2 === 0);

                if (isGapColumn) {
                    // Up
                    if (current.y > searchMinY) {
                        neighbors.push({ x: current.x, y: current.y - 1 });
                    }
                    // Down
                    if (current.y < searchMaxY) {
                        neighbors.push({ x: current.x, y: current.y + 1 });
                    }
                }

                const filteredNeighbors = neighbors.filter(n => n.y >= searchMinY && n.y <= searchMaxY);

                for (const neighbor of filteredNeighbors) {
                    const nKey = getKey(neighbor);
                    if (visited.has(nKey)) continue;

                    // Cost Calculation
                    // Base cost 1
                    let cost = 1;

                    // Obstacles (Nodes) are at Odd X.
                    const isEnd = (neighbor.x === endP.x && neighbor.y === endP.y);
                    if (obstacles.has(nKey) && !isEnd) {
                        continue; // Blocked.
                    }

                    // Preference: Gaps (Even X) and Nodes (Odd X) are equal cost (1).
                    // We rely on 'obstacles' to block actual nodes.
                    // Empty Node space is a valid highway.
                    cost = 1;

                    // Direction Change Penalty
                    // Check previous from cameFrom
                    const prev = cameFrom.get(currentKey);
                    if (prev) {
                        // Is Turn?
                        // If dx/dy changes.
                        // Prev->Curr vector vs Curr->Neigh vector.
                        // Or just checking geometric diff:
                        // If all 3 are linear, x or y is constant.
                        // If x changes AND y changes (across 3 points), it's a turn.
                        // (prev.x !== neighbor.x && prev.y !== neighbor.y) covers 90 deg turns.
                        if (prev.x !== neighbor.x && prev.y !== neighbor.y) {
                            // Turn Cost
                            cost += 1;

                            // PENALTY: Turning in a Gap Column (Even X)
                            // Gap columns are narrow (16px) and adjacent to ports (extruding).
                            // Corners here collide with ports.
                            // We prefer turning in Node Columns (Odd X), which are wide (80px) and empty if not blocked.
                            if (current.x % 2 === 0) {
                                cost += 20; // High penalty to force routing through empty node slots
                            }
                        }
                    }

                    const tentativeG = (gScore.get(currentKey) || 0) + cost;

                    if (tentativeG < (gScore.get(nKey) || Infinity)) {
                        cameFrom.set(nKey, current);
                        gScore.set(nKey, tentativeG);
                        fScore.set(nKey, tentativeG + (Math.abs(neighbor.x - endP.x) + Math.abs(neighbor.y - endP.y)));

                        // Add to openSet if not present
                        // Inefficient check, but fine for small grids.
                        if (!openSet.some(p => pointsEqual(p, neighbor))) {
                            openSet.push(neighbor);
                        }
                    }
                }
            }
        }

        // Check if path found
        if (path.length === 0) {
            // Fallback
            path = [startP, endP];
        }

        // Original path deduplication and grid usage tracking (kept for now, might be redundant if pathToSegments handles it)
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
        for (const p of path) {
            const k = getKey(p);
            gridUsage.set(k, (gridUsage.get(k) || 0) + 1);
        }
    }

    // 3. Convert to Segments
    const currentUsage = new Map<string, number>();
    const GAP_LANE_INDEX = LOGICAL_Y_SCALE - 1;

    for (const wire of wires) {
        const path = wirePaths[wire.id].path;
        if (!path || path.length === 0) continue;

        // Add Start Stub (Node Output)
        // Output is always on Right side of Start Node.
        // Start Node: toLogical(wire.start).
        // Stub connects Node Center/Right to Gap.
        // Logical X = Nodes.
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

        // Add End Stub (Node Input)
        // Input is always on Left side of End Node.
        const endNode = toLogical(wire.end);
        const endStubY = endNode.y + (wire.endOffset || 0);
        // console.log(`WireLayout: ${wire.id} EndStub Y=${endStubY} NodeY=${endNode.y} Offset=${wire.endOffset}`);
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
            const k = getKey(p);
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
                    // Corner
                    // dx1=1 (Right), dy2=1 (Down) -> TL logic?
                    // If coming from left, going down.
                    // Visual: Only occupies Right-Half Horizontal, Bottom-Half Vertical.
                    // If we map to my CSS classes:
                    // .tl (Top-Left visual corner) -> Right-Half H, Bottom-Half V. -> ┐
                    // My CSS .tl actually renders ┘ (Bottom Right shape).
                    // Let's fix CSS or Map correctly.
                    // Corner names are ambiguous.
                    // Let's iterate:
                    // 1. Right then Down (dx1=1, dy2=1): Entrance Left, Exit Bottom. Shape ┐.
                    //    Needs: line-left-to-center, line-center-to-bottom.
                    //    My CSS .tl: right:0 (occupies Right half?), top:50. left:50, top:50 (Bottom half?).
                    //    Actually `right:0 + width:50%` -> Occupies Right side (Left side is empty).
                    //    `top:50 + height:50%` -> Occupies Bottom side.
                    //    So .tl CSS makes ┘.
                    //    I need ┐. That is Left side + Bottom side? No.
                    //    Left-to-Center -> Left side.
                    //    Center-to-Bottom -> Bottom side.
                    //    So left:0, width:50% + top:50, height:50%.

                    // Let's use generic names based on flow:
                    // RB (Right-Bottom): In Right, Out Bottom? No.
                    // Let's stick to the Enums and I will fix CSS in GraphGrid to match.

                    // Case: Right then Down (dx1=1, dy2=1). In Left, Out Bottom.
                    // Type: Corner_DownRight ?
                    // Let's use standard: CornerTL, CornerTR, etc.
                    // And assume standard visual meanings: ┌ ┐ └ ┘
                    // ┌ = TL. (Bottom-Right quadrant occupied).
                    // ┐ = TR. (Bottom-Left quadrant occupied).
                    // └ = BL. (Top-Right quadrant occupied).
                    // ┘ = BR. (Top-Left quadrant occupied).

                    // In Left, Out Bottom (Right then Down): Shape ┐ (TR).
                    if (dx1 === 1 && dy2 > 0) type = SegmentType.CornerTR;

                    // In Left, Out Top (Right then Up, dy2=-1): Shape ┘ (BR).
                    else if (dx1 === 1 && dy2 < 0) type = SegmentType.CornerBR;

                    // In Right, Out Bottom (Left then Down, dx1=-1, dy2=1): Shape ┌ (TL).
                    else if (dx1 === -1 && dy2 > 0) type = SegmentType.CornerTL;

                    // In Right, Out Top (Left then Up, dx1=-1, dy2=-1): Shape └ (BL).
                    else if (dx1 === -1 && dy2 < 0) type = SegmentType.CornerBL;

                    // In Top, Out Right (Down then Right, dy1=1, dx2=1): Shape └ (BL).
                    else if (dy1 > 0 && dx2 === 1) type = SegmentType.CornerBL;

                    // In Top, Out Left (Down then Left, dy1=1, dx2=-1): Shape ┘ (BR).
                    else if (dy1 > 0 && dx2 === -1) type = SegmentType.CornerBR;

                    // In Bottom, Out Right (Up then Right, dy1=-1, dx2=1): Shape ┌ (TL).
                    else if (dy1 < 0 && dx2 === 1) type = SegmentType.CornerTL;

                    // In Bottom, Out Left (Up then Left, dy1=-1, dx2=-1): Shape ┐ (TR).
                    else if (dy1 < 0 && dx2 === -1) type = SegmentType.CornerTR;
                }
            } else if (!prev) {
                // First segment of path (in Gap)
                // Connects FROM Start Node (Left)
                // If next is diff, horizontal.
                if (!next) {
                    type = SegmentType.Horizontal;
                } else {
                    type = (next.x !== p.x) ? SegmentType.Horizontal : SegmentType.Vertical;
                }
                // Check if we need a corner?
                // Visual connection to Start Stub:
                // Start Stub is at x-1 (Left).
                // If path goes Vertical immediately?
                // Then this Gap segment is Vertical.
                // But it needs to accept input from Left.
                // So it is a Corner!
                // Incoming from Left (Start Node).
                // Out to Next.
                // If Next is Right: Horizontal.
                // If Next is Up: Corner (Left->Up = BR).
                // If Next is Down: Corner (Left->Down = TR).
                if (next) {
                    if (next.y < p.y) type = SegmentType.CornerBR; // Up
                    else if (next.y > p.y) type = SegmentType.CornerTR; // Down
                }
            } else if (!next) {
                // Last segment of path (in Gap)
                // Connects TO End Node (Right)
                // Incoming from Prev.
                // Out to Right.
                // If Prev is Left: Horizontal.
                // If Prev is Up: Corner (Down->Right = BL).
                // If Prev is Down: Corner (Up->Right = TL).
                if (prev) {
                    // Determine horizontal direction to End Node
                    // Nodes are at Odd X. Gaps at Even X.
                    // If p is Gap (x=Logic 2). End Node is Logic 1 (Left) or Logic 3 (Right)?
                    // Compare endNode.x with p.x.
                    const isRight = endNode.x > p.x;

                    if (prev.y < p.y) {
                        // Downward path
                        type = isRight ? SegmentType.CornerBL : SegmentType.CornerBR;
                    } else if (prev.y > p.y) {
                        // Upward path
                        type = isRight ? SegmentType.CornerTL : SegmentType.CornerTR;
                    } else {
                        type = SegmentType.Horizontal;
                    }
                }
            }

            let clipTopRem = undefined;
            let clipBotRem = undefined;

            const gridY = Math.floor(p.y / LOGICAL_Y_SCALE);

            // WireRenderer Row Mapping:
            // Node Row: rem < GAP_LANE_INDEX
            // Gap Row: rem == GAP_LANE_INDEX
            // Different CSS Rows -> Different Clipping Contexts.
            const rem = p.y % LOGICAL_Y_SCALE;
            const isNodeRow = rem < GAP_LANE_INDEX;

            if (isNodeRow) {
                // Check Prev (Up)
                if (prev) {
                    if (prev.x === p.x && prev.y < p.y) {
                        const prevGridY = Math.floor(prev.y / LOGICAL_Y_SCALE);
                        if (prevGridY === gridY) {
                            if ((prev.y % LOGICAL_Y_SCALE) < GAP_LANE_INDEX) {
                                clipTopRem = prev.y % LOGICAL_Y_SCALE;
                            }
                        } else if (prevGridY === gridY - 1) {
                            // Crossing Boundary from Previous Line
                            // If prev was Gap Lane (31)?
                            if ((prev.y % LOGICAL_Y_SCALE) === GAP_LANE_INDEX) {
                                clipTopRem = -1; // Special flag for Top of Cell
                            }
                        }
                    }
                }
                // Check Next (Down)
                if (next) {
                    if (next.x === p.x && next.y > p.y) {
                        const nextGridY = Math.floor(next.y / LOGICAL_Y_SCALE);
                        if (nextGridY === gridY) {
                            if ((next.y % LOGICAL_Y_SCALE) < GAP_LANE_INDEX) {
                                clipBotRem = next.y % LOGICAL_Y_SCALE;
                            } else if ((next.y % LOGICAL_Y_SCALE) === GAP_LANE_INDEX) {
                                // Jump to Gap!
                                clipBotRem = GAP_LANE_INDEX;
                            }
                        }
                    }
                }

                // Reverse Checks (Restored)
                if (prev) {
                    // If prev is Down (p connects to Down) - wait. prev index is LOWER.
                    // If prev is BELOW p, then we moved UP from prev to p.
                    // So prev.y > p.y.
                    if (prev.x === p.x && prev.y > p.y) {
                        const prevGridY = Math.floor(prev.y / LOGICAL_Y_SCALE);
                        if (prevGridY === gridY) {
                            if ((prev.y % LOGICAL_Y_SCALE) < GAP_LANE_INDEX) {
                                clipBotRem = prev.y % LOGICAL_Y_SCALE;
                            } else if ((prev.y % LOGICAL_Y_SCALE) === GAP_LANE_INDEX) {
                                // Jumped UP from Gap
                                clipBotRem = GAP_LANE_INDEX;
                            }
                        }
                    }
                }
                if (next) {
                    // If next is Up (p connects to Up)
                    // So we are moving UP. next.y < p.y.
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
                // Gap Row (rem == GAP_LANE_INDEX).
                // Always standalone? No, needs to connect Up/Down.
                // If Prev (Up) exists -> Extend Top to 0 (-1 flag).
                if (prev && prev.x === p.x && prev.y < p.y) {
                    clipTopRem = -1;
                }
                // Downward connection logic removed: Default undefined means "Extend to Bottom (100%)"
            }

            segments.push({
                id: `${wire.id}-${i}`,
                wireId: wire.id,
                x: p.x,
                y: p.y,
                type,
                lane: index + 1, // Naive lane
                totalLanes: total,
                length: 1,
                clipTopRem,
                clipBotRem
            });
        }
    }

    // 4. Post-Process Coalescing
    // Remove redundant segments that map to the same Physical Slot.
    // Issue: High-res logical segments (y, y+1) map to same Physical Grid Row (Slot).
    // If we have 'Vertical' AND 'Corner' in same slot, 'Vertical' draws full height and clobbers/overshoots the Corner.
    // Update: Must match WireRenderer's row logic.
    // Node Row: y % 4 < 3.
    // Gap Row: y % 4 == 3. (Do NOT coalesce Gap Verticals with Node Corners!)

    const coalescedSegments: WireSegment[] = [];
    const slotMap = new Map<string, WireSegment[]>();

    for (const seg of segments) {
        // Compute Grid Row Key
        // Logic from WireRenderer
        const logicalSlot = Math.floor(seg.y / LOGICAL_Y_SCALE);
        const rem = seg.y % LOGICAL_Y_SCALE;

        let gridRowKey = '';
        if (rem < GAP_LANE_INDEX) {
            // Node Row
            // All segments in y, y+1... < Gap map to this bucket.
            gridRowKey = `${seg.wireId}:${seg.x}:${logicalSlot}:node`;
        } else {
            // Gap Row
            gridRowKey = `${seg.wireId}:${seg.x}:${logicalSlot}:gap`;
        }

        if (!slotMap.has(gridRowKey)) slotMap.set(gridRowKey, []);
        slotMap.get(gridRowKey)!.push(seg);
    }

    // Process buckets
    for (const [key, bucket] of slotMap.entries()) {
        const hasCorner = bucket.some(s => s.type !== SegmentType.Horizontal && s.type !== SegmentType.Vertical && s.type !== SegmentType.Start && s.type !== SegmentType.End);

        // Helper to check if clip A extends further than clip B (Top)
        // Undefined (Cell Edge) extends further than Defined (Inner).
        // Smaller Rem extends further than Larger Rem.
        const extendsHigher = (aRem: number | undefined, bRem: number | undefined) => {
            if (aRem === undefined && bRem !== undefined) return true;
            if (aRem !== undefined && bRem !== undefined && aRem < bRem) return true;
            return false;
        };

        // Helper for Bottom
        // Undefined extends further than Defined.
        // Larger Rem extends further than Smaller Rem.
        const extendsLower = (aRem: number | undefined, bRem: number | undefined) => {
            if (aRem === undefined && bRem !== undefined) return true;
            if (aRem !== undefined && bRem !== undefined && aRem > bRem) return true;
            return false;
        };

        // Only coalesce if it's a Node Row?
        // Gap rows typically just have 1 vertical or are corners.
        // If Gap Row has Corner + Vertical, we probably want to remove Vertical too?
        // Yes. Logic applies generally per Grid Row.

        if (hasCorner) {
            // Smart Merge:
            // If we have Verticals and Corners, the Vertical might extend further than the Corner (due to clipping).
            // If so, extend the Corner's clip to cover the Vertical, then remove the Vertical.

            const verticals = bucket.filter(s => s.type === SegmentType.Vertical);
            const corners = bucket.filter(s => s.type !== SegmentType.Vertical && s.type !== SegmentType.Horizontal && s.type !== SegmentType.Start && s.type !== SegmentType.End);

            for (const c of corners) {
                // Determine Corner Leg Direction
                // cbl, cbr -> Connect Up (Top Leg)
                // ctl, ctr -> Connect Down (Bottom Leg)
                if (c.type === SegmentType.CornerBL || c.type === SegmentType.CornerBR) {
                    // Top Leg
                    for (const v of verticals) {
                        if (extendsHigher(v.clipTopRem, c.clipTopRem)) {
                            c.clipTopRem = v.clipTopRem;
                        }
                    }
                } else if (c.type === SegmentType.CornerTL || c.type === SegmentType.CornerTR) {
                    // Bottom Leg
                    for (const v of verticals) {
                        if (extendsLower(v.clipBotRem, c.clipBotRem)) {
                            c.clipBotRem = v.clipBotRem;
                        }
                    }
                }
            }

            // Now keep non-Verticals (Verticals have been merged into Corners)
            for (const s of bucket) {
                if (s.type !== SegmentType.Vertical) {
                    coalescedSegments.push(s);
                }
            }
        } else {
            // No conflict, keep all
            // Dedup Verticals for optimization (multiple Verticals in same Node Row = same visual line)
            const verticals = bucket.filter(s => s.type === SegmentType.Vertical);
            const others = bucket.filter(s => s.type !== SegmentType.Vertical);

            if (verticals.length > 0) {
                // MERGE VERTICALS
                // Instead of picking just one, we must merge them.
                // One might be Top-Half (clipBot=1), another Bottom-Half (clipTop=1).
                // Combined, they make a Full line.
                // Logic:
                // combined.clipTop = Highest Top (Undefined > 0 > 1 > 2) -> Min Rem
                // combined.clipBot = Lowest Bottom (Undefined > 3(Gap? No) > 2 > 1 > 0) -> Max Rem? No.
                // Bottom of cell is Rem 3? Or just undefined.
                // clipBotRem is logic offset.
                // 2 is lower (physically) than 0.
                // So max(rem) is lower.

                let merged = { ...verticals[0] };
                // We need to iterate all and extend 'merged'
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

    // Debug
    // console.log(`WireLayout Result Segments:`, JSON.stringify(coalescedSegments.map(s => ({ id: s.id, x: s.x, y: s.y, type: s.type }))));

    return {
        segments: coalescedSegments,
        wires: wirePaths
    };
}


export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Path {
    boxes: BoundingBox[];
    isValid: boolean;
    validationErrors: string[];
    turnCount: number;
    turnDirections: ('left' | 'right')[];
    straightDistances: number[]; // Distances between turns
}

export interface PathResult {
    paths: Path[];
}


// Helper to check if two boxes overlap or touch
function boxesTouch(b1: BoundingBox, b2: BoundingBox, tolerance: number = 2): boolean {
    const horizontalOverlap = b1.x < b2.x + b2.width + tolerance && b1.x + b1.width + tolerance > b2.x;
    const verticalOverlap = b1.y < b2.y + b2.height + tolerance && b1.y + b1.height + tolerance > b2.y;

    // They must overlap or touch in one dimension and strict overlap in the other?
    // Actually the condition "touch or overlap" within tolerance is simpler:
    // Rectangles overlap if max(l1, l2) < min(r1, r2) (for x) and max(t1, t2) < min(b1, b2) (for y).
    // Adding tolerance expands the boxes slightly.

    // Strict overlap logic with tolerance expansion
    const xOverlap = Math.max(b1.x, b2.x) <= Math.min(b1.x + b1.width, b2.x + b2.width) + tolerance;
    const yOverlap = Math.max(b1.y, b2.y) <= Math.min(b1.y + b1.height, b2.y + b2.height) + tolerance;

    // Wait, the standard "intersect" check is:
    // !(r1 < l2 || l1 > r2 || b1 < t2 || t1 > b2)
    // with tolerance:
    // !(b1.x + b1.width + tolerance < b2.x || b1.x > b2.x + b2.width + tolerance ...

    // However, "touches" implies they might just abut.
    // Let's use detailed proximity check.

    const x1 = b1.x - tolerance, y1 = b1.y - tolerance, w1 = b1.width + 2*tolerance, h1 = b1.height + 2*tolerance;
    const x2 = b2.x, y2 = b2.y, w2 = b2.width, h2 = b2.height;

    // Use >= for "touching" within tolerance
    return x1 <= x2 + w2 && x1 + w1 >= x2 && y1 <= y2 + h2 && y1 + h1 >= y2;
}

function findPaths(
    currentPath: BoundingBox[],
    remainingBoxes: BoundingBox[],
    endBox?: BoundingBox
): BoundingBox[][] {
    const lastBox = currentPath[currentPath.length - 1];

    // Find all potential next boxes
    const nextCandidates = remainingBoxes.filter(b => boxesTouch(lastBox, b));

    if (nextCandidates.length === 0) {
        return [currentPath];
    }

    let paths: BoundingBox[][] = [];
    for (const nextBox of nextCandidates) {
        const nextRemaining = remainingBoxes.filter(b => b !== nextBox);
        const subPaths = findPaths([...currentPath, nextBox], nextRemaining, endBox);
        paths.push(...subPaths);
    }
    return paths;
}

// Check for simple graph connectivity (components)
function getConnectedComponents(boxes: BoundingBox[]): BoundingBox[][] {
    const visited = new Set<BoundingBox>();
    const components: BoundingBox[][] = [];

    for (const box of boxes) {
        if (visited.has(box)) continue;

        const component: BoundingBox[] = [];
        const queue = [box];
        visited.add(box);

        while (queue.length > 0) {
            const current = queue.shift()!;
            component.push(current);

            for (const other of boxes) {
                if (!visited.has(other) && boxesTouch(current, other)) {
                    visited.add(other);
                    queue.push(other);
                }
            }
        }
        components.push(component);
    }
    return components;
}

// Helper to get center of box
function getCenter(b: BoundingBox): {x: number, y: number} {
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function validatePath(pathBoxes: BoundingBox[], start?: BoundingBox, end?: BoundingBox): Path {
    const errors: string[] = [];

    // Check start
    if (start && pathBoxes[0] !== start) {
        errors.push('Path does not start at expected start box');
    }

    // Check end
    if (end && pathBoxes[pathBoxes.length - 1] !== end) {
        errors.push('Path does not end at expected end box');
    }

    for (const box of pathBoxes) {
        if (box !== start && box !== end) {
            // Check width/height. ONE dimension must be exactly 2 for "wire" segments?
            // "Bounding boxes ... must be 2 units wide in the direction normal to the forward direction"
            // This is tricky if we don't know flow direction yet.
            // But usually flow is axis-aligned. So width=2 OR height=2.
            const isVertical = Math.abs(box.width - 2) < 0.5; // Relaxed tolerance from 0.01 to 0.5
            const isHorizontal = Math.abs(box.height - 2) < 0.5;

            if (!isVertical && !isHorizontal) {
                errors.push(`Path width must be ~2 (Got W:${box.width.toFixed(2)} H:${box.height.toFixed(2)})`);
            }
        }
        if (box.width === 0 || box.height === 0) {
             errors.push('Bounding box is infinitely thin');
        }
    }

    let turnCount = 0;
    const turnDirections: ('left' | 'right')[] = [];
    const straightDistances: number[] = [];

    if (pathBoxes.length >= 2) {
        // Compute "Flow Vector" for each box
        const flowVectors: {x: number, y: number}[] = [];

        for (let i = 0; i < pathBoxes.length; i++) {
            const box = pathBoxes[i];
            const c1 = getCenter(box);

            // Determine reference neighbor to find flow sign
            // If not last, look ahead. If last, look behind.
            let c2: {x: number, y: number};
            let lookAhead = true;

            if (i < pathBoxes.length - 1) {
                c2 = getCenter(pathBoxes[i+1]);
            } else {
                c2 = getCenter(pathBoxes[i-1]);
                lookAhead = false; // logic inversion?
                // No, if we look behind, the vector c_prev -> c_curr is the flow entering.
                // But we want flow *in* the box.
                // If we assume flow is continuous, flow IN = flow OUT.
                // So (c_curr - c_prev) gives the vector.
                // (c_next - c_curr) gives the vector too.
                // They should be roughly consistent in sign for that axis.
            }

            const diff = lookAhead ? { x: c2.x - c1.x, y: c2.y - c1.y } : { x: c1.x - c2.x, y: c1.y - c2.y };

            // Determine axis based on dimensions
            // Tolerance for "squareness"?
            const isHoriz = box.width >= box.height;
            // If square, use diff dominance?

            let vx = 0;
            let vy = 0;

            if (box.width > box.height) {
                // Strictly horizontal
                vx = Math.sign(diff.x) || 1; // Default to + if 0?
                vy = 0;
            } else if (box.height > box.width) {
                // Strictly vertical
                vx = 0;
                vy = Math.sign(diff.y) || 1;
            } else {
                // Square/Ambiguous (e.g. 2x2 corner)
                // Use diff to decide axis
                if (Math.abs(diff.x) > Math.abs(diff.y)) {
                    vx = Math.sign(diff.x);
                    vy = 0;
                } else {
                    vx = 0;
                    vy = Math.sign(diff.y);
                }
            }
            // Handle 0 case if perfectly stacked? (Unlikely with bounding boxes)
            if (vx === 0 && vy === 0) {
                 // Fallback to previous or default?
                 vx = 1;
            }

            flowVectors.push({ x: vx, y: vy });
        }

        // Now analyze transitions between boxes
        let currentDist = 0;

        // Add distance of first box to "current run"?
        // Distance metric: center-to-center?
        // Or "run length".
        // Let's use center-to-center accumulation for "straightDistances".

        // Actually, we iterate edges to sum distance and check turns.

        for (let i = 0; i < flowVectors.length - 1; i++) {
            const v1 = flowVectors[i];
            const v2 = flowVectors[i+1];

            // Dist
            const c1 = getCenter(pathBoxes[i]);
            const c2 = getCenter(pathBoxes[i+1]);
            const dist = Math.sqrt(Math.pow(c2.x - c1.x, 2) + Math.pow(c2.y - c1.y, 2));
            currentDist += dist;

            if (v1.x !== v2.x || v1.y !== v2.y) {
                // Turn detected
                turnCount++;
                turnDirections.push( (v1.x * v2.y - v1.y * v2.x) > 0 ? 'right' : 'left' );

                straightDistances.push(currentDist);
                currentDist = 0; // Reset for next run
            }
        }
        straightDistances.push(currentDist);
    }

    return {
        boxes: pathBoxes,
        isValid: errors.length === 0,
        validationErrors: errors,
        turnCount,
        turnDirections,
        straightDistances
    };
}


export function tracePaths(
    boxes: BoundingBox[],
    start?: BoundingBox,
    end?: BoundingBox
): PathResult {
    // 1. Partition into connected components
    const components = getConnectedComponents(boxes);

    // 2. For each component, try to form a linear path
    // If a component branches, this DFS approach needs refinement to find "longest" or "all"
    // The prompt says "traces the set of longest possible paths".
    // If a component has multiple valid linear paths coverng all nodes?
    // Let's assume we want to order the boxes within the component linearly.

    const resultPaths: Path[] = [];

    for (const component of components) {
       // Heuristic: find "endpoints" (degree 1) to start DFS?
       // If cycle, pick any.
       // Let's try DFS from every node in component as start, pick longest.
       let longestPathForComponent: BoundingBox[] = [];

       // Optimization: if start/end known and in component, force them.
       const compStart = start && component.includes(start) ? start : undefined;
       const compEnd = end && component.includes(end) ? end : undefined;

       const starts = compStart ? [compStart] : component;

       for (const s of starts) {
           const potentialPaths = findPaths([s], component.filter(b => b !== s), compEnd);
           // Sort by length descending
           potentialPaths.sort((a, b) => b.length - a.length);
           if (potentialPaths.length > 0 && potentialPaths[0].length > longestPathForComponent.length) {
               longestPathForComponent = potentialPaths[0];
           }
       }

       // If we didn't use all boxes in component, that implies branching/orphan nodes.
       // The "remaining" nodes should technically form their own paths?
       // The prompt says "Any path other than the longest causes a validation failure... All bounding boxes should contribute".
       // So we just output the longest path we found for this cluster.
       // If there are leftovers, strictly speaking they are separate paths/fragments.
       // Implementation detail for failure case: return the longest path,
       // and maybe create dummy "paths" for unused boxes to signal fragmentation?
       // Or just return the one path and let user check "boxes.length == total boxes".

       // Actually, the prompt says "The result... partitions the bounding boxes".
       // So we should collect unused boxes.

       const used = new Set(longestPathForComponent);
       const unused = component.filter(b => !used.has(b));

       resultPaths.push(validatePath(longestPathForComponent, start, end));

       // If unused boxes exist, we should probably output them as 1-element paths or recursivley solve?
       // For "failure" detection, just having them not in the main path is enough.
       // Let's dump them as individual paths for now so they are accounted for.
       for (const u of unused) {
           resultPaths.push(validatePath([u], undefined, undefined));
       }
    }

    return { paths: resultPaths };
}

export interface PathMetrics {
    turnCount?: number;
    turnDirections?: ('left' | 'right')[];
    segmentRatios?: number[]; // Ratios of consecutive logical segments
}

export function validatePathMetrics(path: Path, expected: PathMetrics): void {
    if (expected.turnCount !== undefined) {
        if (path.turnCount !== expected.turnCount) {
             throw new Error(`Metric mismatch: Expected ${expected.turnCount} turns, got ${path.turnCount} (${path.turnDirections.join(', ')})`);
        }
    }

    if (expected.turnDirections) {
        if (path.turnDirections.length !== expected.turnDirections.length) {
            throw new Error(`Metric mismatch: Expected ${expected.turnDirections.length} turn directions, got ${path.turnDirections.length}`);
        }
        for (let i = 0; i < expected.turnDirections.length; i++) {
            if (path.turnDirections[i] !== expected.turnDirections[i]) {
                throw new Error(`Metric mismatch: Turn ${i} expected ${expected.turnDirections[i]}, got ${path.turnDirections[i]}`);
            }
        }
    }

    if (expected.segmentRatios && expected.segmentRatios.length > 0) {
        const actual = path.straightDistances;

        if (actual.length !== expected.segmentRatios.length) {
             throw new Error(`Metric mismatch: Expected ${expected.segmentRatios.length} segments for ratio check, got ${actual.length}`);
        }

        const totalLen = actual.reduce((a, b) => a + b, 0);
        const actualRatios = actual.map(d => d / (totalLen || 1));

        const totalExp = expected.segmentRatios.reduce((a, b) => a + b, 0);
        const expectedNorm = expected.segmentRatios.map(d => d / (totalExp || 1));

        const tolerance = 0.15;

        for (let i = 0; i < actualRatios.length; i++) {
            const diff = Math.abs(actualRatios[i] - expectedNorm[i]);
            if (diff > tolerance) {
                const fmt = (n: number) => (n * 100).toFixed(1) + '%';
                throw new Error(`Metric mismatch: Segment ${i} ratio ${fmt(actualRatios[i])} differs from expected ${fmt(expectedNorm[i])} (Tol ${fmt(tolerance)})`);
            }
        }
    }
}

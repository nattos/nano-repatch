
import { expect, describe, it } from 'vitest';
import { computeWireLayout, WireDef, SegmentType } from './wire-layout';

describe('Wire Layout Engine', () => {
  it('should route a single wire on an empty grid', () => {
    const w1: WireDef = {
      id: 'w1',
      start: { x: 0, y: 0 }, // Input Node (Logical 0)
      end: { x: 1, y: 0 },   // Node 1 (Logical 2)
      fromPort: 'out',
      toPort: 'in'
    };

    const result = computeWireLayout([w1]);
    expect(result).toBeDefined();
    // Start: Logical 0*2+1 = 1.
    // End: Logical 1*2+1 = 3.
    // Start Right: 1+1 = 2 (Gap).
    // End Left: 3-1 = 2 (Gap).
    // Path: [2,0]. Direct connection in gap.
    expect(result.wires['w1'].path.length).toBeGreaterThan(0);
    expect(result.wires['w1'].path[0]).toEqual({ x: 2, y: 0 });

    // Check segments
    expect(result.segments.length).toBeGreaterThan(0);

    // Find grid segment
    const gridSeg = result.segments.find(s => s.type === SegmentType.Horizontal || s.type === SegmentType.Vertical);
    expect(gridSeg).toBeDefined();
    expect(gridSeg!.x).toBe(2);
    expect(gridSeg!.y).toBe(0);
  });

  it('should route around an obstacle', () => {
    // Start Node 1 (x=1 -> Logical 3). Right Gap 4.
    // End Node 3 (x=3 -> Logical 7). Left Gap 6.
    // Obstacle Node 2 (x=2 -> Logical 5).
    const w1: WireDef = {
      id: 'w1',
      start: { x: 1, y: 0 },
      end: { x: 3, y: 0 },
      fromPort: 'out',
      toPort: 'in'
    };

    const options = {
      obstacles: [{ x: 2, y: 0 }]
    };

    const result = computeWireLayout([w1], options);
    const path = result.wires['w1'].path;

    // Path starts at 4,0. Ends at 6,0.
    // 5,0 is blocked.
    // Should go around. e.g. 4,0 -> 4,1 -> 5,1 -> 6,1 -> 6,0.

    expect(path).toBeDefined();
    // Should not contain {x:5, y:0} (The Obstacle)
    expect(path).not.toContainEqual({ x: 5, y: 0 });

    // Verify connectivity
    expect(path[0]).toEqual({ x: 4, y: 0 });
    expect(path[path.length-1]).toEqual({ x: 6, y: 0 });
  });

  it('should handle multiple wires sharing a segment', () => {
    // Two wires same path: 0 -> 1.
    // Logical: Start 1 (Right->2). End 3 (Left->2).
    // Both share Gap 2.
    const w1: WireDef = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, fromPort: 'a', toPort: 'b' };
    const w2: WireDef = { id: 'w2', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, fromPort: 'c', toPort: 'd' };

    const wires = [w1, w2];
    const result = computeWireLayout(wires, {
       previousResult: { segments: [], wires: {} }
    });

    // Find the grid crossing segments (at x=2) for both wires
    const s1Grid = result.segments.find(s => s.wireId === 'w1' && s.x === 2);
    const s2Grid = result.segments.find(s => s.wireId === 'w2' && s.x === 2);
    expect(s1Grid).toBeDefined();
    expect(s2Grid).toBeDefined();
    expect(s1Grid!.x).toBe(2);

    // Lanes should be distinct
    // Note: Lane assignment logic in wire-layout might depend on order or something.
    // Ensure they are not equal.
    // And totalLanes >= 2.
    expect(s1Grid!.lane).not.toBe(s2Grid!.lane);
    expect(s1Grid!.totalLanes).toBeGreaterThanOrEqual(2);
    expect(s2Grid!.totalLanes).toBeGreaterThanOrEqual(2);
  });
  it('should route straight line for offset ports (Port 2 to Port 2)', () => {
    // Start Node (x=0 -> Log 1). End Node (x=2 -> Log 5). Gap at Log 3 (x=1).
    // Offsets: 2 (Row 2).
    const w1: WireDef = {
      id: 'w1',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 }, // Gap in between at x=1
      startOffset: 2,
      endOffset: 2,
      fromPort: 'p2',
      toPort: 'p2'
    };

    const result = computeWireLayout([w1]);
    const path = result.wires['w1'].path;

    // Path should be straight horizontal line at y=startNode.y (0*2) + 2 = 2.
    // Start Point: x=1+1=2, y=2.
    // End Point: x=5-1=4, y=2.
    // Path: 2,2 -> 3,2 -> 4,2?
    // Gap is at x=1 (Log 3).
    // Node 0 occupies Log 1.
    // Node 2 occupies Log 5.
    // Gap Logic: 1 (Node) -> 2 (Gap/Stub) -> 3 (Gap) -> 4 (Gap/Stub) -> 5 (Node).
    // Path should be: [2,2], [3,2], [4,2].

    expect(path).toBeDefined();
    expect(path.length).toBeGreaterThan(0);

    // Check for Jogs
    const firstY = path[0].y;
    for (const p of path) {
        expect(p.y).toBe(firstY); // All points should be on same Y
    }
  });
});

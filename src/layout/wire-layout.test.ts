import { describe, it, expect } from 'vitest';
import { computeWireLayout, WireDef, GridPoint } from './wire-layout';

describe('Wire Layout Engine', () => {
  it('should route a single wire on an empty grid', () => {
    const wire: WireDef = {
      id: 'w1',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n1',
      fromPort: 'out',
      toNodeId: 'n2',
      toPort: 'in'
    };

    const result = computeWireLayout([wire]);
    const layout = result.wires['w1'];

    expect(layout).toBeDefined();
    expect(layout.path.length).toBeGreaterThan(0);
    expect(layout.path[0]).toEqual({ x: 0, y: 0 });
    expect(layout.path[layout.path.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it('should route around an obstacle', () => {
    const wire: WireDef = {
      id: 'w1',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n1',
      fromPort: 'out',
      toNodeId: 'n2',
      toPort: 'in'
    };

    const result = computeWireLayout([wire], {
      obstacles: [{ x: 1, y: 0 }]
    });
    const layout = result.wires['w1'];
    const path = layout.path;

    expect(layout.path).toBeDefined();
    // Path should not contain the obstacle
    expect(layout.path).not.toContainEqual({ x: 1, y: 0 });
    // Path should go around the obstacle
    // Start: 0,0 -> 2,0. Obstacle: 1,0.
    // 2x grid: Start 0,0 -> End 4,0. Obstacle 2,0.
    // Path: 0,0 -> 1,0 -> 1,1 -> 2,1 -> 3,1 -> 3,0 -> 4,0 (or similar)
    // 1x grid: 0,0 -> 0.5,0 -> 0.5,0.5 -> 1,0.5 -> 1.5,0.5 -> 1.5,0 -> 2,0

    expect(path.length).toBeGreaterThan(2);

    // Check that we don't go through 1,0
    expect(path).not.toContainEqual({ x: 1, y: 0 });

    // Check that we go through "gap" points (fractional)
    const hasFractional = path.some(p => p.x % 1 !== 0 || p.y % 1 !== 0);
    expect(hasFractional).toBe(true);
  });

  it('should handle multiple wires sharing a segment', () => {
    const w1: WireDef = {
      id: 'w1',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n1', fromPort: 'out', toNodeId: 'n2', toPort: 'in'
    };
    const w2: WireDef = {
      id: 'w2',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n1', fromPort: 'out', toNodeId: 'n2', toPort: 'in'
    };

    const result = computeWireLayout([w1, w2]);

    // Both should take the direct path (0,0 -> 0.5,0 -> 1,0 -> 1.5,0 -> 2,0) if no obstacles
    // Wait, 1,0 is not an obstacle here?
    // If no obstacles provided, 1,0 is free.
    // So path: 0,0 -> 0.5,0 -> 1,0 -> 1.5,0 -> 2,0.

    // Check lanes
    // Segment 0,0 -> 0.5,0
    const key = "0,0:0.5,0";
    expect(result.wires['w1'].lanes[key]).toBeDefined();
    expect(result.wires['w2'].lanes[key]).toBeDefined();

    expect(result.wires['w1'].lanes[key].count).toBe(2);
    expect(result.wires['w2'].lanes[key].count).toBe(2);
    expect(result.wires['w1'].lanes[key].index).not.toBe(result.wires['w2'].lanes[key].index);
  });

  it('should maintain stable ordering regardless of input order', () => {
    const w1: WireDef = {
      id: 'w1',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n1', fromPort: 'out', toNodeId: 'n2', toPort: 'in'
    };
    const w2: WireDef = {
      id: 'w2',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n3', fromPort: 'out', toNodeId: 'n4', toPort: 'in'
    };

    // Run with [w1, w2]
    const result1 = computeWireLayout([w1, w2]);
    const key = "0,0:0.5,0";
    const idx1_run1 = result1.wires['w1'].lanes[key].index;
    const idx2_run1 = result1.wires['w2'].lanes[key].index;

    // Run with [w2, w1]
    const result2 = computeWireLayout([w2, w1]);
    const idx1_run2 = result2.wires['w1'].lanes[key].index;
    const idx2_run2 = result2.wires['w2'].lanes[key].index;

    // Indices should be identical
    expect(idx1_run1).toBe(idx1_run2);
    expect(idx2_run1).toBe(idx2_run2);
  });

  it('should reuse paths for unchanged wires', () => {
    const w1: WireDef = {
      id: 'w1',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n1', fromPort: 'out', toNodeId: 'n2', toPort: 'in'
    };
    const w2: WireDef = {
      id: 'w2',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      fromNodeId: 'n3', fromPort: 'out', toNodeId: 'n4', toPort: 'in'
    };

    // Initial run
    const result1 = computeWireLayout([w1, w2]);
    const path1 = result1.wires['w1'].path;

    // Second run: w2 changes (moves start point), w1 is unchanged
    const w2_changed: WireDef = { ...w2, start: { x: 0, y: 1 } };

    const result2 = computeWireLayout([w1, w2_changed], {
      previousResult: result1,
      changedWireIds: ['w2']
    });

    // w1 path should be strictly equal (same object reference if possible, or at least deep equal)
    expect(result2.wires['w1'].path).toBe(path1);

    // w2 path should be new
    expect(result2.wires['w2'].path).not.toBe(result1.wires['w2'].path);
    expect(result2.wires['w2'].path[0]).toEqual({ x: 0, y: 1 });

    // Lanes should still be computed correctly
    // w1 is at 0,0 -> 0.5,0 -> ...
    // w2 is at 0,1 -> 0.5,1 -> ...
    // They don't share segments anymore.
    const key = "0,0:0.5,0";
    expect(result2.wires['w1'].lanes[key].count).toBe(1);
  });
});

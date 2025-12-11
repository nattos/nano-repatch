
import { tracePaths, BoundingBox, PathResult } from './path-trace-util';

describe('tracePaths', () => {
  it('should find a single valid path for a single box', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 10, height: 2 };
    const result = tracePaths([box], box, box);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].isValid).toBe(true);
    expect(result.paths[0].boxes).toHaveLength(1);
  });

  it('should find a valid path for two connected boxes', () => {
    // Two 10x2 boxes arranged horizontally: [0,0,10,2] -> [10,0,10,2]
    const b1: BoundingBox = { x: 0, y: 0, width: 10, height: 2 };
    const b2: BoundingBox = { x: 10, y: 0, width: 10, height: 2 }; // Perfectly adjacent

    // Start at left of b1, end at right of b2
    const result = tracePaths([b1, b2], b1, b2);

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].isValid).toBe(true);
    expect(result.paths[0].boxes).toHaveLength(2);
  });

  it('should detect a gap and return strictly more than one path', () => {
    const b1: BoundingBox = { x: 0, y: 0, width: 10, height: 2 };
    const b2: BoundingBox = { x: 20, y: 0, width: 10, height: 2 }; // Gap of 10

    const result = tracePaths([b1, b2], b1, b2);
    // Should be 2 paths because they are disconnected
    expect(result.paths.length).toBeGreaterThan(1);
  });

  it('should handle runs with 2px tolerance', () => {
    const b1: BoundingBox = { x: 0, y: 0, width: 10, height: 2 };
    const b2: BoundingBox = { x: 12, y: 0, width: 10, height: 2 }; // Gap of 2

    const result = tracePaths([b1, b2], b1, b2);
     // If tolerance is 2px, this might pass depending on implementation detail.
     // Let's assume strict gap check for now, but user said "close to overlapping, within a tolerance (2 px)".
     // If it means they can be 2px apart, then this should pass.
     // Let's set tolerance to 2px.
     expect(result.paths).toHaveLength(1);
  });

  it('should fail validation if width is not 2', () => {
      const start: BoundingBox = { x: 0, y: 0, width: 10, height: 2 };
      const mid: BoundingBox = { x: 10, y: 0, width: 10, height: 3 }; // Width 3 (Invalid)
      const end: BoundingBox = { x: 20, y: 0, width: 10, height: 2 };

      const result = tracePaths([start, mid, end], start, end);

      expect(result.paths).toHaveLength(1);
      expect(result.paths[0].isValid).toBe(false);
      expect(result.paths[0].validationErrors[0]).toMatch(/Path width must be ~2/);
  });

  it('should trace a right turn', () => {
      // Horizontal then Vertical
      // [   ]
      //     [ ]
      //     [ ]
      const h: BoundingBox = { x: 0, y: 0, width: 10, height: 2 };
      // Vertical segment starts at x=8 (overlap 2px? no, usually corner is shared)
      // Let's make L shape.
      // H: 0,0 10x2. encompass (0,0) to (10,2)
      // V: 8,0 2x10. encompass (8,0) to (10,10). Overlap is (8,0) to (10,2) which is 2x2.
      const v: BoundingBox = { x: 8, y: 0, width: 2, height: 10 };

      const result = tracePaths([h, v], h, v);
      expect(result.paths).toHaveLength(1);
      expect(result.paths[0].turnCount).toBe(1);
  });

  it('should validate metrics correctly', () => {
       // Mock Path
       const path: any = {
           turnCount: 2,
           turnDirections: ['right', 'left'],
           straightDistances: [100, 200, 100], // 1:2:1 ratio (25%, 50%, 25%)
           isValid: true
       };

       const { validatePathMetrics } = require('./path-trace-util');

       // Pass
       expect(() => validatePathMetrics(path, { turnCount: 2 })).not.toThrow();
       expect(() => validatePathMetrics(path, { turnDirections: ['right', 'left'] })).not.toThrow();
       expect(() => validatePathMetrics(path, { segmentRatios: [1, 2, 1] })).not.toThrow(); // Normalized check

       // Fail Count
       expect(() => validatePathMetrics(path, { turnCount: 1 })).toThrow(/Expected 1 turns/);

       // Fail Direction
       expect(() => validatePathMetrics(path, { turnDirections: ['left', 'right'] })).toThrow(/Turn 0 expected left/);

       // Fail Ratio
       expect(() => validatePathMetrics(path, { segmentRatios: [1, 1, 1] })).toThrow(/differs/);
  });
});

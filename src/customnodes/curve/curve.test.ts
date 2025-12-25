import { describe, it, expect } from 'vitest';
import { curve_env } from './nodes';

describe('curve.env', () => {
  const createMockContext = (initialState: any = {}) => {
    return {
      broadcast: (config: any, inputs: any) => ({
        apply: (fn: any) => fn(inputs)
      }),
      nodeState: {
        has: () => true,
        get: () => initialState,
        set: () => { }
      },
      nodeId: 'test-node'
    };
  };

  it('should interpolate linearly between nodes', () => {
    const config = {
      config: {
        envelopeNodes: [
          { id: '1', x: 0, y: 0 },
          { id: '2', x: 1, y: 1 }
        ],
        segments: [
          { id: 's1', weight: 1, curve: { type: 'linear' } }
        ]
      }
    };

    const inputs = { value: 0.5 };
    const result = curve_env.execute(
      inputs,
      config,
      createMockContext({ lastSegmentIndex: 0 }) as any
    );

    expect(result.fields.result).toBeCloseTo(0.5);
  });

  it('should handle exponential easing', () => {
    const config = {
      config: {
        envelopeNodes: [
          { id: '1', x: 0, y: 0 },
          { id: '2', x: 1, y: 1 }
        ],
        segments: [
          { id: 's1', weight: 1, curve: { type: 'exponential', value: 0 } }
        ]
      }
    };

    // value 0 -> exponent 1 -> linear
    // We override segments in the inputs or config?
    // In this test we want to simulate changing the config.
    // Since we pass config as 2nd arg, we just modify it.

    let result = curve_env.execute({ value: 0.5 }, {
      config: {
        ...config.config,
        segments: [{ id: 's1', weight: 1, curve: { type: 'exponential', value: 0 } }]
      }
    }, createMockContext({ lastSegmentIndex: 0 }) as any);
    expect(result.fields.result).toBeCloseTo(0.5);

    // Value 1 -> exponent 0.1 -> root 10.
    result = curve_env.execute({ value: 0.5 }, {
      config: {
        ...config.config,
        segments: [{ id: 's1', weight: 1, curve: { type: 'exponential', value: 1 } }]
      }
    }, createMockContext({ lastSegmentIndex: 0 }) as any);
    // 0.5 ^ 0.1
    expect(result.fields.result).toBeCloseTo(Math.pow(0.5, 0.1));
  });

  it('should clamp values outside range', () => {
    const config = {
      config: {
        envelopeNodes: [
          { id: '1', x: 0.2, y: 0.2 },
          { id: '2', x: 0.8, y: 0.8 }
        ],
        segments: [
          { id: 's1', weight: 1, curve: { type: 'linear' } }
        ]
      }
    };

    // Below min
    let result = curve_env.execute({ value: 0.1 }, config, createMockContext({ lastSegmentIndex: 0 }) as any);
    expect(result.fields.result).toBe(0.2);

    // Above max
    result = curve_env.execute({ value: 0.9 }, config, createMockContext({ lastSegmentIndex: 0 }) as any);
    expect(result.fields.result).toBe(0.8);
  });

  it('should find correct segment for multi-point envelope', () => {
    const config = {
      config: {
        envelopeNodes: [
          { id: '1', x: 0, y: 0 },
          { id: '2', x: 0.5, y: 1 },
          { id: '3', x: 1, y: 0 }
        ],
        segments: [
          { id: 's1', weight: 1, curve: { type: 'linear' } },
          { id: 's2', weight: 1, curve: { type: 'linear' } }
        ]
      }
    };

    // First segment
    expect(curve_env.execute({ value: 0.25 }, config, createMockContext({ lastSegmentIndex: 0 }) as any).fields.result).toBeCloseTo(0.5);

    // Second segment
    expect(curve_env.execute({ value: 0.75 }, config, createMockContext({ lastSegmentIndex: 0 }) as any).fields.result).toBeCloseTo(0.5);
  });
});

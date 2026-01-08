import { describe, it, expect } from 'vitest';
import { logic_select } from './nodes/logic_select';
import { ExecutionContext } from './structor';

// Mock context
const mockContext: ExecutionContext = {
  nodeId: 'test-node',
  compileGraph: () => ({ nodes: {}, connections: {} } as any),
  graph: { nodes: {}, connections: {} } as any,
  nodeState: new Map(),
  broadcast: (config: any, inputs: any) => ({ apply: (fn: any) => fn(inputs.fields) }),
  time: 0,
  sampleRate: 44100,
  inputs: {},
  outputs: {}
};

describe('logic.select', () => {

  describe('range mode', () => {
    const config = { mode: 'range', count: 3, base: 10, step: 10 };
    // Ranges:
    // 0 -> base (10) -> val_0
    // 1 -> base+step (20) -> val_1
    // 2 -> base+2*step (30) -> val_2

    it('selects strictly matching values', () => {
      const inputs = { fields: { value: 10, val_0: 100, val_1: 200, val_2: 300 } };
      const result = logic_select.execute(inputs, config, mockContext, undefined);
      expect(result.fields.result).toBe(100);

      const inputs2 = { fields: { value: 20, val_0: 100, val_1: 200, val_2: 300 } };
      expect(logic_select.execute(inputs2, config, mockContext, undefined).fields.result).toBe(200);
    });

    it('rounds to closest index', () => {
      // 14 -> closest to 10 (diff 4 vs diff 6 to 20) -> val_0
      expect(logic_select.execute({ fields: { value: 14, val_0: 1, val_1: 2, val_2: 3 } }, config, mockContext, undefined).fields.result).toBe(1);

      // 16 -> closest to 20 -> val_1
      expect(logic_select.execute({ fields: { value: 16, val_0: 1, val_1: 2, val_2: 3 } }, config, mockContext, undefined).fields.result).toBe(2);
    });

    it('clamps to range', () => {
      // -100 -> val_0
      expect(logic_select.execute({ fields: { value: -100, val_0: 1, val_1: 2 } }, config, mockContext, undefined).fields.result).toBe(1);
      // 1000 -> val_2
      expect(logic_select.execute({ fields: { value: 1000, val_0: 1, val_1: 2, val_2: 3 } }, config, mockContext, undefined).fields.result).toBe(3);
    });
  });

  describe('value mode', () => {
    const config = { mode: 'value', count: 2 };

    it('selects based on epsilon match', () => {
      const inputs = {
        fields: {
          value: 5,
          match_0: 5, val_0: 100,
          match_1: 10, val_1: 200
        }
      };
      expect(logic_select.execute(inputs, config, mockContext, undefined).fields.result).toBe(100);

      // Epsilon check
      const inputs2 = {
        fields: {
          value: 5.000001,
          match_0: 5, val_0: 100,
          match_1: 10, val_1: 200
        }
      };
      expect(logic_select.execute(inputs2, config, mockContext, undefined).fields.result).toBe(100);
    });

    it('fallbacks to 0 if no match', () => {
      const inputs = {
        fields: {
          value: 999,
          match_0: 5, val_0: 100,
          match_1: 10, val_1: 200
        }
      };
      expect(logic_select.execute(inputs, config, mockContext, undefined).fields.result).toBe(0);
    });
  });

  describe('zone mode', () => {
    const config = { mode: 'zone', count: 3 };

    it('selects first matching threshold', () => {
      // Thresholds: 10, 20, 30
      const inputs = {
        value: 5,
        threshold_0: 10, val_0: 100,
        threshold_1: 20, val_1: 200,
        threshold_2: 30, val_2: 300
      };
      // 5 <= 10 -> val_0
      expect(logic_select.execute({ fields: inputs }, config, mockContext, undefined).fields.result).toBe(100);

      // 15 <= 10 (False), 15 <= 20 (True) -> val_1
      expect(logic_select.execute({ fields: { ...inputs, value: 15 } }, config, mockContext, undefined).fields.result).toBe(200);

      // 25 <= 20 (False), 25 <= 30 (True) -> val_2
      expect(logic_select.execute({ fields: { ...inputs, value: 25 } }, config, mockContext, undefined).fields.result).toBe(300);
    });

    it('fallbacks to 0 if above all thresholds', () => {
      const inputs = {
        value: 50,
        threshold_0: 10, val_0: 100,
        threshold_1: 20, val_1: 200,
        threshold_2: 30, val_2: 300
      };
      expect(logic_select.execute({ fields: inputs }, config, mockContext, undefined).fields.result).toBe(0);

      // Unless implicit catch-all? No, logic is fallback to 0.
    });
  });
});

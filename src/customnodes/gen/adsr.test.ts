import { adsr } from './nodes';
import { GraphExecutor } from '../../structor/executor';
import { defaultNodeRepository } from '../../structor/repository';
import { defineRecordType, numberType } from '../../structor/std-types';

describe('ADSR Node Logic', () => {

  const compile = () => {
    // Basic setup mostly to get the node execute function
    return adsr.execute;
  };

  const execute = adsr.execute;
  const createState = adsr.createState;

  const createMockContext = () => {
    const nodeState = new Map();
    return {
      clock: { dt: 0.1 },
      nodeState,
      nodeId: 'test-node',
      broadcast: (config: any, inputs: any) => ({
        apply: (fn: any) => fn(inputs)
      })
    } as any;
  };

  it('should support zero attack time', () => {
    const context = createMockContext();
    const nodeState = context.nodeState;

    // Attack = 0
    const inputs = {
      stream: [{ type: 'note_on', velocity: 1.0 }],
      attack: 0.0,
      decay: 1.0, // Long decay to verify we stay near 1.0
      sustain: 0.5,
      release: 0.1
    };

    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADSR' }
      }
    };
    const result = execute(inputs as any, config as any, context);
    // State is internal to the wrapper context now, but we can inspect it via the map
    const state = nodeState.get('test-node');

    expect(state.phase).not.toBe(0); // Not Idle
    expect(result.fields.value).toBeGreaterThan(0.9); // Expect close to 1.0
  });

  it('should handle Trigger (On + Off) with Zero Attack', () => {
    const context = createMockContext();
    context.clock.dt = 0.01;
    const nodeState = context.nodeState;

    // Trigger: On then Off
    const inputs = {
      stream: [
        { type: 'note_on', velocity: 1.0 },
        { type: 'note_off', velocity: 0.0 }
      ],
      attack: 0.0,
      decay: 1.0,
      sustain: 0.5,
      release: 1.0
    };

    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADSR' }
      }
    };

    // Execution
    const result = execute(inputs as any, config as any, context);
    const state = nodeState.get('test-node');

    expect(result.fields.value).toBeCloseTo(0.99, 1);
    expect(state.phase).toBe(4); // RELEASE
  });

  it('should handle Trigger with Zero Attack and Zero Decay', () => {
    const context = createMockContext();
    context.clock.dt = 0.01;

    const inputs = {
      stream: [
        { type: 'note_on', velocity: 1.0 },
        { type: 'note_off', velocity: 0.0 }
      ],
      attack: 0.0,
      decay: 0.0,
      sustain: 0.5,
      release: 1.0
    };

    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADSR' }
      }
    };

    const result = execute(inputs as any, config as any, context);

    expect(result.fields.value).toBeCloseTo(0.49, 1);
    expect(result.fields.value).toBeCloseTo(0.49, 1);
  });

  it('should support Decay Mode (D)', () => {
    const context = createMockContext();
    context.clock.dt = 0.1;

    // Mode 'D': Attack should be forced to 0
    const inputs = {
      stream: [{ type: 'note_on', velocity: 1.0 }],
      decay: 1.0,
      // Attack/Sustain/Release passed but should be ignored
      attack: 1.0,
      sustain: 1.0,
      release: 1.0
    };
    // definePrimitiveNode wrapper mimics Structor resolution.
    // We must pass a valid Structor representation for 'config' that the wrapper can resolve.
    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'D' }
      }
    };

    const result = execute(inputs as any, config as any, context);

    const state = context.nodeState.get('test-node');
    expect(state.phase).not.toBe(0);
    // Attack should be 0 -> Instant 1.0. Next frame decays.
    // Dt=0.1. Decay=1.0. Stop at 0.9.
    expect(result.fields.value).toBeGreaterThan(0.85);
  });

  it('should support ADS Mode', () => {
    const context = createMockContext();
    context.clock.dt = 0.01;

    // ADS Mode: Release should equal Decay
    const inputs = {
      stream: [
        { type: 'note_on', velocity: 1.0 },
        { type: 'note_off', velocity: 0.0 } // Trigger
      ],
      attack: 0.0,
      decay: 0.5,
      // Release passed as 0.1 (fast), but should be ignored for Decay (0.5)
      release: 0.1
    };
    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADS' }
      }
    };

    // We process Trigger in one go?
    // Wait, execute runs for ONE frame.
    // If inputs has both Note On and Note Off, the logic processes them sequentially.
    // Attack 0 -> Peak 1.0.
    // Note Off -> Release starts.
    // Release duration = Decay = 0.5.
    // dt = 0.01.
    // Drop = (1.0 / 0.5) * 0.01 = 2 * 0.01 = 0.02.
    // Value = 0.98.
    // If Release was 0.1: Drop = (1.0 / 0.1) * 0.01 = 10 * 0.01 = 0.1. Value = 0.90.

    const result = execute(inputs as any, config as any, context);
    expect(result.fields.value).toBeGreaterThan(0.96);
  });
});

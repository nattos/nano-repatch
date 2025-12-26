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

    const result = execute(inputs as any, {} as any, context);
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

    // Execution
    const result = execute(inputs as any, {} as any, context);
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

    const result = execute(inputs as any, {} as any, context);

    expect(result.fields.value).toBeCloseTo(0.49, 1);
  });
});

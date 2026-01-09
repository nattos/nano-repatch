import { describe, it, expect, beforeEach } from 'vitest';
import { logic_latch } from './nodes/logic_latch';
import { ExecutionContext } from './structor';

const createMockContext = (): ExecutionContext => ({
  nodeId: 'test-latch',
  compileGraph: () => ({ nodes: {}, connections: {} } as any),
  graph: { nodes: {}, connections: {} } as any,
  nodeState: new Map(),
  broadcast: (config: any, inputs: any) => ({ apply: (fn: any) => fn(inputs.fields) }),
  time: 0,
  sampleRate: 44100,
  inputs: {},
  outputs: {}
});

describe('logic.latch', () => {

  it('initializes to value in auto mode if not triggered', () => {
    const context = createMockContext();
    const inputs = {
      fields: {
        condition: [],
        value: 100,
        init: 999
      }
    };
    const config = { initMode: 'auto' };

    const res = logic_latch.execute(inputs, config, context);

    // Retrieve state used by wrapper
    const state = context.nodeState.get('test-latch') as any;

    expect(res.fields.result).toBe(100);
    expect(state.currentValue).toBe(100);
    expect(state.initialized).toBe(true);
  });

  it('initializes to init in manual mode if not triggered', () => {
    const context = createMockContext();
    const inputs = {
      fields: {
        condition: [],
        value: 100,
        init: 999
      }
    };
    const config = { initMode: 'manual' };

    const res = logic_latch.execute(inputs, config, context);

    const state = context.nodeState.get('test-latch') as any;

    expect(res.fields.result).toBe(999);
    expect(state.currentValue).toBe(999);
    expect(state.initialized).toBe(true);
  });

  it('updates when triggered', () => {
    const context = createMockContext();

    // Pre-seed state
    const state = logic_latch.createState!({} as any, context) as any;
    state.currentValue = 50;
    state.initialized = true;
    context.nodeState.set('test-latch', state);

    const inputs = {
      fields: {
        condition: [{ type: 'note_on', velocity: 100 }],
        value: 200,
        init: 999
      }
    };
    const config = { mode: 'midi' };

    const res = logic_latch.execute(inputs, config, context);
    expect(res.fields.result).toBe(200);
    expect(state.currentValue).toBe(200);
  });

  it('does not update when not triggered', () => {
    const context = createMockContext();

    const state = logic_latch.createState!({} as any, context) as any;
    state.currentValue = 50;
    state.initialized = true;
    context.nodeState.set('test-latch', state);

    const inputs = {
      fields: {
        condition: [], // No trigger
        value: 200,
        init: 999
      }
    };
    const config = { mode: 'midi' };

    const res = logic_latch.execute(inputs, config, context);
    expect(res.fields.result).toBe(50); // Kept old value
    expect(state.currentValue).toBe(50);
  });
});

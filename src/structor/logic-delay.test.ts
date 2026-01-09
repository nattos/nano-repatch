import { describe, it, expect } from 'vitest';
import { logic_delay } from './nodes/logic_delay';
import { ExecutionContext } from './structor';

const createMockContext = (): ExecutionContext => ({
  nodeId: 'test-delay',
  compileGraph: () => ({ nodes: {}, connections: {} } as any),
  graph: { nodes: {}, connections: {} } as any,
  nodeState: new Map(),
  broadcast: (config: any, inputs: any) => ({ apply: (fn: any) => fn(inputs.fields) }),
  time: 0,
  sampleRate: 44100,
  inputs: {},
  outputs: {}
});

describe('logic.delay', () => {

  it('initializes to value in auto mode', () => {
    const context = createMockContext();
    const inputs = {
      fields: { value: 100, init: 999 }
    };
    const config = { initMode: 'auto' };

    const res = logic_delay.execute(inputs, config, context);
    const state = context.nodeState.get('test-delay') as any;

    // First frame: result = value (auto init)
    expect(res.fields.result).toBe(100);
    expect(state.initialized).toBe(true);
    expect(state.storedValue).toBe(100);
  });

  it('initializes to init in manual mode', () => {
    const context = createMockContext();
    const inputs = {
      fields: { value: 100, init: 999 }
    };
    const config = { initMode: 'manual' };

    const res = logic_delay.execute(inputs, config, context);
    const state = context.nodeState.get('test-delay') as any;

    // First frame: result = init
    expect(res.fields.result).toBe(999);
    expect(state.initialized).toBe(true);
    expect(state.storedValue).toBe(100); // Stored value is INPUT value
  });

  it('delays value by one frame', () => {
    const context = createMockContext();
    // Pre-seed state
    const state = logic_delay.createState!({} as any, context) as any;
    state.initialized = true;
    state.storedValue = 10; // Previous value
    context.nodeState.set('test-delay', state);

    const inputs = { fields: { value: 20 } };
    const res = logic_delay.execute(inputs, {}, context);

    expect(res.fields.result).toBe(10); // Output previous
    expect(state.storedValue).toBe(20); // Store current
  });
});

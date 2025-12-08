
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphDefinition } from '../structor/structor';

// Mock self and postMessage
const postMessageMock = vi.fn();

// We need to mock the global scope BEFORE importing the worker
// because the worker assigns to self.onmessage at top level.
// In Vitest with JSDOM/HappyDOM, `self` refers to the global window object.
// We can spy on it or just use it.

describe('Executor Worker', () => {
  let worker: any;

  beforeEach(async () => {
    vi.resetModules();
    postMessageMock.mockClear();

    // Mock self.postMessage
    // @ts-ignore
    global.self = global;
    // @ts-ignore
    global.postMessage = postMessageMock;

    // Import the worker module. This executes the top-level code.
    // We use import() to ensure we get a fresh execution if we reset modules (though top level might run once).
    // Actually, `vi.resetModules()` should help re-importing.
    await import('./executor.worker');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize graph and run a step', async () => {
    // The worker assigns to self.onmessage.
    // We need to find that handler.
    const onmessage = self.onmessage;
    expect(onmessage).toBeDefined();

    const graph: GraphDefinition = {
      id: 'test-graph',
      kind: 'graph',
      type: { kind: 'graph', inputs: { kind: 'record', fields: {},  }, outputs: { kind: 'record', fields: {},  } },
      nodes: {},
      connections: [],
      inputs: {},
      outputs: {}
    };

    // 1. INIT_GRAPH
    onmessage!({
      data: {
        type: 'INIT_GRAPH',
        graph: graph
      }
    } as MessageEvent);

    // 2. CONTROL START (optional, or just STEP)
    // We can just STEP to verify logic without starting the interval loop
    onmessage!({
      data: {
        type: 'CONTROL',
        action: 'STEP'
      }
    } as MessageEvent);

    // Expect postMessage to be called with EXECUTION_UPDATE
    expect(postMessageMock).toHaveBeenCalled();
    const lastCall = postMessageMock.mock.calls[postMessageMock.mock.calls.length - 1];
    const msg = lastCall[0];

    expect(msg.type).toBe('EXECUTION_UPDATE');
    expect(msg.stats).toBeDefined();
    expect(msg.outputs).toBeDefined();
  });
});

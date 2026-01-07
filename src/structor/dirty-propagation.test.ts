
import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from './executor';
import { GraphDefinition, PrimitiveNodeDefinition } from './structor';
import { NodeRepository } from './repository';

// Mock Node Repository
const mockRepo = new NodeRepository();

// Define 'core.ifthen' (Parent)
mockRepo.register({
  id: 'core.ifthen',
  version: '1.0.0',
  displayName: 'IfThen',
  definition: {
    id: 'core.ifthen',
    kind: 'primitive',
    inputs: {
      trigger: { kind: 'atomic', type: 'boolean' }
    },
    outputs: {},
    subgraphExpansionTag: 'onTrigger',
    execute: (inputs, config, context) => {
      // console.log('[core.ifthen] execute called with trigger:', inputs.fields.trigger);
      if (inputs.fields.trigger && context.executeSubgraph) {
        context.executeSubgraph('onTrigger');
      }
      return { outputs: {}, ui: {} };
    }
  }
} as any);

// Define 'test.child' (Child)
mockRepo.register({
  id: 'test.child',
  version: '1.0.0',
  displayName: 'Child',
  definition: {
    id: 'test.child',
    kind: 'primitive',
    inputs: {},
    outputs: {},
    execute: (inputs, config, context) => {
      // console.log('[test.child] execute called');
      return { outputs: {}, ui: {} };
    }
  }
} as any);

describe('Dirty Propagation', () => {
  it('should propagate dirty status from child to parent (executionOwner)', async () => {
    const childExecuteSpy = vi.fn().mockReturnValue({ outputs: {} });

    // Override execute for spying
    const childDef = mockRepo.get('test.child')!;
    childDef.execute = childExecuteSpy;

    const graph: GraphDefinition = {
      id: 'test-graph',
      kind: 'graph',
      type: { kind: 'graph', inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: {} } },
      nodes: {
        'n1': {
          definitionId: 'core.ifthen',
          defaultConfig: {},
          executionOwnerId: undefined
        },
        'n2': {
          definitionId: 'test.child',
          defaultConfig: {},
          executionOwnerId: 'n1',
          executionTag: 'onTrigger'
        }
      },
      connections: [],
      inputs: {},
      outputs: {},
      executionOrder: ['n1', 'n2'] // Simplified: Compiler would separate them
    };

    // Executor handles splitting execution order
    const executor = new GraphExecutor(graph, mockRepo);

    // Initial State: n1 trigger is false (undefined). n2 should not run.

    // Easier: Connect Graph Input to n1
    graph.inputs = { 'trigger': { nodeId: 'n1', port: 'trigger' } };

    // Mock input injection
    (executor as any).graphInputs.set('trigger', true);

    // Run 1: Trigger = true. Both should run (Initially dirty)
    executor.update({});
    expect(childExecuteSpy).toHaveBeenCalledTimes(1);

    // Run 2: Trigger = true. Nothing dirty. Should run 0 times (cached).
    childExecuteSpy.mockClear();
    executor.update({});
    expect(childExecuteSpy).toHaveBeenCalledTimes(0);

    // Run 3: Mark CHILD 'n2' dirty.
    // If propagation works: n1 becomes dirty -> n1 executes -> triggers subgraph -> n2 executes.
    // If NOT: n1 is clean -> n1 skips -> n2 never called.

    // Manually marking dirty using public API if available or via state manipulation.
    executor.markDirty('n2');

    executor.update({});

    expect(childExecuteSpy).toHaveBeenCalledTimes(1);

  });
});

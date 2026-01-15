
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { logic_delay } from './nodes/logic_delay';
import { GraphDefinition } from './structor';
import { AnyType } from './type-helpers';
import { compileGraph } from '../builder/compiler';
import { AppState, GraphState } from '../builder/state';

describe('Graph Cycle Integration', () => {
  const repository = new NodeRepository();
  // Register logic.delay manually as it's a primitive
  repository.register({
    id: 'logic.delay',
    version: '1.0.0',
    displayName: 'Delay',
    definition: logic_delay,
    inputs: logic_delay.inputs,
    outputs: logic_delay.outputs,
    compileConfig: logic_delay.compileConfig
  });

  // Mock a simple Passthrough node to complete the cycle
  repository.register({
    id: 'test.passthrough',
    version: '1.0.0',
    displayName: 'Passthrough',
    definition: {
      id: 'test.passthrough',
      kind: 'primitive',
      inputs: { value: AnyType },
      outputs: { value: AnyType },
      execute: (inputRecord: any) => ({
        outputs: {
          fields: {
            value: inputRecord.fields.value
          }
        }
      })
    } as any
  });

  it('should handle a simple feedback loop with logic.delay', () => {
    // AppState setup
    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'n1': {
              id: 'n1',
              x: 0, y: 0,
              config: { typeId: 'logic.delay', initMode: 'manual', values: { init: 10 } }
            },
            'n2': {
              id: 'n2',
              x: 100, y: 0,
              config: { typeId: 'test.passthrough' }
            }
          },
          connections: {
            'c1': { id: 'c1', fromNodeId: 'n1', fromPort: 'result', toNodeId: 'n2', toPort: 'value' },
            'c2': { id: 'c2', fromNodeId: 'n2', fromPort: 'value', toNodeId: 'n1', toPort: 'value' }
          },
          comments: {}
        },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      },
      viewport: { x: 0, y: 0, zoom: 1 }
    };

    const { graph: compiledGraph } = compileGraph(appState, new Map(), repository);

    // Check if cycle was detected and handled roughly
    // If arbitrary, we can't guarantee order, but let's see what happens.
    console.log('Execution Order:', compiledGraph.executionOrder);

    const executor = new GraphExecutor(compiledGraph, repository);

    // Tick 1
    executor.update({});
    const delayOut1 = executor.getNodeOutput('n1')?.fields.result;
    const passOut1 = executor.getNodeOutput('n2')?.fields.value;

    // In this test, we expect Delay to output 10 (created from init).
    // Then Passthrough takes 10, outputs 10.
    // Delay takes 10 (as future value).

    expect(delayOut1).toBe(10);

    // Tick 2
    executor.update({});
    const delayOut2 = executor.getNodeOutput('n1')?.fields.result;

    expect(delayOut2).toBe(10);
  });
});

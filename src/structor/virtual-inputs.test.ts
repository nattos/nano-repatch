import { describe, it, expect } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { ALL_PRIMITIVES } from './primitives';
import { compileGraph } from '../builder/compiler';
import { AppState, GridNode, Connection } from '../builder/state';
import { numberType } from './std-types';

describe('Virtual Inputs Integration', () => {
  const repository = new NodeRepository();

  // Register all primitives
  ALL_PRIMITIVES.forEach(def => {
    repository.register({
      id: def.id,
      version: '1.0.0',
      displayName: def.id,
      definition: def,
      inputs: (def as any).inputs ? Object.entries((def as any).inputs).map(([name, type]: [string, any]) => ({
        name,
        type: type,
        defaultValue: type.defaultValue // Pass through defaultValue
      })) : [],
      outputs: Object.entries((def as any).outputs || {}).map(([name, type]) => ({ name, type: type as any })),
      compileConfig: (uiConfig) => {
        // Pass through the UI config as the node config
        return uiConfig;
      }
    });
  });

  // Mock Output Node
  repository.register({
    id: 'io.output',
    version: '1.0.0',
    displayName: 'Output',
    definition: {
      id: 'io.output',
      kind: 'primitive',
      configType: { kind: 'record', fields: {}, untagged: [] },
      computeOutputTypes: () => ({ kind: 'record', fields: { val: numberType }, untagged: [] }),
      execute: (inputs) => {
        return { fields: { val: inputs.fields.val }, untagged: [] };
      },
    },
    inputs: [{ name: 'val', type: numberType }],
    outputs: [{ name: 'val', type: numberType }],
    compileConfig: (c) => ({ fields: {}, untagged: [] })
  });

  const compileAndRun = (
    nodes: Record<string, { typeId: string, config?: any }>,
    monitoredNode: string,
    monitoredPort: string
  ) => {
    const gridNodes: Record<string, GridNode> = {};
    const gridConnections: Record<string, Connection> = {};

    let x = 0;
    for (const [id, def] of Object.entries(nodes)) {
      gridNodes[id] = {
        id,
        x: x++,
        y: 0,
        config: {
          typeId: def.typeId,
          // Simulate how the UI might structure config for virtual inputs
          // The executor expects values in `values` property
          values: def.config?.values || {},
          ...def.config
        }
      };
    }

    // Add output node
    const outId = 'out_node';
    gridNodes[outId] = {
      id: outId,
      x: x++,
      y: 0,
      config: { typeId: 'io.output', name: 'test_out', values: {} }
    };

    // Connect monitored node to output
    const outConnId = 'c_out';
    gridConnections[outConnId] = {
      id: outConnId,
      fromNodeId: monitoredNode,
      fromPort: monitoredPort,
      toNodeId: outId,
      toPort: 'val'
    };

    const appState: AppState = {
      graph: {
        inner: { nodes: gridNodes, connections: gridConnections },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const graphDef = compileGraph(appState, new Map(), repository);
    const executor = new GraphExecutor(graphDef, repository);
    return { executor, getOutput: () => executor.getGraphOutput('test_out') };
  };

  it('should use virtual inputs for math.add when disconnected', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'add': {
          typeId: 'math.add',
          config: {
            // Simulate virtual inputs set by sliders
            values: { a: 10, b: 20 }
          }
        }
      },
      'add', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(30);
  });

  it('should use virtual inputs for math.lerp', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'lerp': {
          typeId: 'math.lerp',
          config: {
            values: { a: 0, b: 100, t: 0.5 }
          }
        }
      },
      'lerp', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(50);
  });

  it('should use defaultValue from PortHint if config.values is missing', () => {
    // math.clamp has defaults: min=0, max=1
    const { executor, getOutput } = compileAndRun(
      {
        'clamp': {
          typeId: 'math.clamp',
          config: {
            values: { value: 0.5 } // min and max missing
          }
        }
      },
      'clamp', 'value'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    // If defaults work, min=0, max=1. 0.5 clamped to [0, 1] is 0.5.
    // If defaults fail (undefined), Math.min(0.5, undefined) is NaN.
    expect(getOutput()).toBe(0.5);
  });
});

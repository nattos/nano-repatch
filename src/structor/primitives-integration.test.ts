import { describe, it, expect } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { ALL_PRIMITIVES } from './primitives';
import { compileGraph } from '../builder/compiler';
import { AppState, GridNode, Connection } from '../builder/state';
import { numberType } from './std-types';

// Helper to compile GridNodes into GraphDefinition
export const compileAndRun = (
  nodes: Record<string, { typeId: string, config?: any }>,
  connections: { from: string, port: string, to: string, portIn: string }[],
  monitoredNode: string,
  monitoredPort: string
) => {
  const repository = new NodeRepository();

  // Register all primitives
  ALL_PRIMITIVES.forEach(def => {
    repository.register({
      id: def.id,
      version: '1.0.0',
      displayName: def.id,
      definition: def,
      inputs: Object.entries((def as any).inputs || {}).map(([name, type]) => ({ name, type: type as any })),
      outputs: Object.entries((def as any).outputs || {}).map(([name, type]) => ({ name, type: type as any })),
      compileConfig: (uiConfig) => {
        // For literal, extract the value
        if (def.id === 'data.literal') {
          return uiConfig?.value;
        }
        // For lerp, handle clamp
        if (def.id === 'math.lerp') {
          return { fields: { clamp: uiConfig?.clamp ?? true },  };
        }
        return { fields: {},  };
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
      configType: { kind: 'record', fields: {},  },
      computeOutputTypes: () => ({ kind: 'record', fields: { val: numberType },  }),
      execute: (inputs) => {
        // console.log('io.output execute inputs:', JSON.stringify(inputs));
        return { fields: { val: inputs.fields.val },  };
      },
    },
    inputs: [{ name: 'val', type: numberType }],
    outputs: [{ name: 'val', type: numberType }],
    compileConfig: (c) => ({ fields: {},  })
  });

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
        values: {},
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

  let connId = 0;
  for (const conn of connections) {
    const id = `c${connId++}`;
    gridConnections[id] = {
      id,
      fromNodeId: conn.from,
      fromPort: conn.port,
      toNodeId: conn.to,
      toPort: conn.portIn
    };
  }

  // Connect monitored node to output
  const outConnId = `c${connId++}`;
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
  // console.log('Execution Order:', (executor as any).executionOrder);
  return { executor, getOutput: () => executor.getGraphOutput('test_out') };
};



describe('Primitives Integration', () => {
  it('should chain math operations: (5 + 3) * 2 = 16', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'l1': { typeId: 'data.literal', config: { value: 5 } },
        'l2': { typeId: 'data.literal', config: { value: 3 } },
        'l3': { typeId: 'data.literal', config: { value: 2 } },
        'add': { typeId: 'math.add' },
        'mul': { typeId: 'math.multiply' }
      },
      [
        { from: 'l1', port: 'value', to: 'add', portIn: 'a' },
        { from: 'l2', port: 'value', to: 'add', portIn: 'b' },
        { from: 'add', port: 'result', to: 'mul', portIn: 'a' },
        { from: 'l3', port: 'value', to: 'mul', portIn: 'b' }
      ],
      'mul', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(16);
  });

  it('should chain logic operations: (5 > 3) AND (10 < 20) = 1', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'l1': { typeId: 'data.literal', config: { value: 5 } },
        'l2': { typeId: 'data.literal', config: { value: 3 } },
        'l3': { typeId: 'data.literal', config: { value: 10 } },
        'l4': { typeId: 'data.literal', config: { value: 20 } },
        'gt': { typeId: 'logic.greater_than' },
        'lt': { typeId: 'logic.less_than' },
        'and': { typeId: 'logic.and' }
      },
      [
        { from: 'l1', port: 'value', to: 'gt', portIn: 'a' },
        { from: 'l2', port: 'value', to: 'gt', portIn: 'b' },
        { from: 'l3', port: 'value', to: 'lt', portIn: 'a' },
        { from: 'l4', port: 'value', to: 'lt', portIn: 'b' },
        { from: 'gt', port: 'result', to: 'and', portIn: 'a' },
        { from: 'lt', port: 'result', to: 'and', portIn: 'b' }
      ],
      'and', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(1);
  });

  it('should clamp values', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: 15 } },
        'min': { typeId: 'data.literal', config: { value: 0 } },
        'max': { typeId: 'data.literal', config: { value: 10 } },
        'clamp': { typeId: 'math.clamp' }
      },
      [
        { from: 'val', port: 'value', to: 'clamp', portIn: 'value' },
        { from: 'min', port: 'value', to: 'clamp', portIn: 'min' },
        { from: 'max', port: 'value', to: 'clamp', portIn: 'max' }
      ],
      'clamp', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(10);
  });

  it('should clamp vector values', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: [0.5, 1.5, -0.5] } },
        'clamp': { typeId: 'math.clamp', config: { values: { min: 0, max: 1 } } }
      },
      [
        { from: 'val', port: 'value', to: 'clamp', portIn: 'value' }
      ],
      'clamp', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toEqual([0.5, 1, 0]);
  });

  it('should lerp values', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'a': { typeId: 'data.literal', config: { value: 0 } },
        'b': { typeId: 'data.literal', config: { value: 10 } },
        't': { typeId: 'data.literal', config: { value: 0.5 } },
        'lerp': { typeId: 'math.lerp' }
      },
      [
        { from: 'a', port: 'value', to: 'lerp', portIn: 'a' },
        { from: 'b', port: 'value', to: 'lerp', portIn: 'b' },
        { from: 't', port: 'value', to: 'lerp', portIn: 't' }
      ],
      'lerp', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(5);
  });
});

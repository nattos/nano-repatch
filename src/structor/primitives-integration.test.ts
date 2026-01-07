
import { describe, it, expect } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { ALL_PRIMITIVES } from './primitives';
import { compileGraph } from '../builder/compiler';
import { AppState, GridNode, Connection, GraphState } from '../builder/state';
import { numberType, float4Type } from './std-types';

import { compileAndRun } from '../test/integration-utils';
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

  it('should unpack float4 to x, y, z, w', () => {
    const repository = new NodeRepository();
    // Register unpack
    // @ts-ignore
    const unpackDef = ALL_PRIMITIVES.find(p => p.id === 'core.unpack')!;
    repository.register({
      id: unpackDef.id,
      version: '1.0.0',
      displayName: 'Unpack',
      definition: unpackDef,
      inputs: [{ name: 'record', type: float4Type }],
      outputs: []
    });

    // Register Mock Float4 Source
    repository.register({
      id: 'mock.float4',
      version: '1.0.0',
      displayName: 'Float4',
      definition: {
        id: 'mock.float4',
        kind: 'primitive',
        metadata: { category: 'Mock' },
        computeOutputTypes: () => ({ kind: 'record', fields: { out: float4Type } }),
        execute: () => ({ fields: { out: [10, 20, 30, 40] } })
      },
      inputs: [],
      outputs: [{ name: 'out', type: float4Type }]
    });

    // Register Output (Mock)
    repository.register({
      id: 'io.output',
      version: '1.0.0',
      displayName: 'Output',
      definition: {
        id: 'io.output',
        kind: 'primitive',
        metadata: { category: 'Mock' },
        computeOutputTypes: () => ({ kind: 'record', fields: { value: numberType } }),
        execute: (inputs) => ({ fields: { value: inputs.fields.value } })
      },
      inputs: [{ name: 'value', type: numberType }],
      outputs: [{ name: 'value', type: numberType }],
      compileConfig: (c) => ({ fields: {} })
    });

    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'src': { id: 'src', x: 0, y: 0, config: { typeId: 'mock.float4' } },
            'unpack': { id: 'unpack', x: 100, y: 0, config: { typeId: 'core.unpack' } },
            'outX': { id: 'outX', x: 200, y: 0, config: { typeId: 'io.output', name: 'outX' } },
            'outW': { id: 'outW', x: 200, y: 100, config: { typeId: 'io.output', name: 'outW' } }
          },
          connections: {
            'c1': { id: 'c1', fromNodeId: 'src', fromPort: 'out', toNodeId: 'unpack', toPort: 'record' },
            'c2': { id: 'c2', fromNodeId: 'unpack', fromPort: 'x', toNodeId: 'outX', toPort: 'value' },
            'c3': { id: 'c3', fromNodeId: 'unpack', fromPort: 'w', toNodeId: 'outW', toPort: 'value' },
          }
        },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const { graph: graphDef } = compileGraph(appState, new Map(), repository);
    const executor = new GraphExecutor(graphDef, repository);
    executor.update({ clock: { beat: 0, dt: 0 } });

    expect(executor.getGraphOutput('outX')).toBe(10);
    expect(executor.getGraphOutput('outW')).toBe(40);
  });
  it('should propagate vector type from math.all.add to core.unpack', () => {
    const repository = new NodeRepository();
    // Register unpack
    // @ts-ignore
    const unpackDef = ALL_PRIMITIVES.find(p => p.id === 'core.unpack')!;
    repository.register({
      id: unpackDef.id,
      version: '1.0.0',
      displayName: 'Unpack',
      definition: unpackDef,
      inputs: [{ name: 'record', type: float4Type }],
      outputs: []
    });

    // Register math.all.add (Standard)
    const addDef = ALL_PRIMITIVES.find(p => p.id === 'math.all.add')!;
    // We must ensure allowMultiConnection is passed correctly here too if we manually register.
    repository.register({
      id: addDef.id,
      version: '1.0.0',
      displayName: 'Add',
      definition: addDef,
      inputs: Object.entries((addDef as any).inputs || {}).map(([name, type]) => ({
        name,
        type: type as any,
        allowMultiConnection: (type as any).allowMultiConnection
      })),
      outputs: [{ name: 'result', type: numberType }],
      compileConfig: () => ({ fields: {} })
    });

    // Register Mock Float4 Source
    repository.register({
      id: 'mock.float4',
      version: '1.0.0',
      displayName: 'Float4',
      definition: {
        id: 'mock.float4',
        kind: 'primitive',
        metadata: { category: 'Mock' },
        computeOutputTypes: () => ({ kind: 'record', fields: { out: float4Type } }),
        execute: () => ({ fields: { out: [10, 20, 30, 40] } })
      },
      inputs: [],
      outputs: [{ name: 'out', type: float4Type }],
      compileConfig: () => ({ fields: {} })
    });

    // Register Output (Mock)
    repository.register({
      id: 'io.output',
      version: '1.0.0',
      displayName: 'Output',
      definition: {
        id: 'io.output',
        kind: 'primitive',
        metadata: { category: 'Mock' },
        computeOutputTypes: () => ({ kind: 'record', fields: { value: numberType }, }),
        execute: (inputs) => ({ fields: { value: inputs.fields.value } })
      },
      inputs: [{ name: 'value', type: numberType }],
      outputs: [{ name: 'value', type: numberType }],
      compileConfig: (c) => ({ fields: {} })
    });

    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'src': { id: 'src', x: 0, y: 0, config: { typeId: 'mock.float4' } },
            'add': { id: 'add', x: 100, y: 0, config: { typeId: 'math.all.add' } },
            'unpack': { id: 'unpack', x: 200, y: 0, config: { typeId: 'core.unpack' } },
            'outX': { id: 'outX', x: 200, y: 0, config: { typeId: 'io.output', name: 'outX' } },
            'outW': { id: 'outW', x: 200, y: 100, config: { typeId: 'io.output', name: 'outW' } }
          },
          connections: {
            'c1': { id: 'c1', fromNodeId: 'src', fromPort: 'out', toNodeId: 'add', toPort: 'values' },
            'c2': { id: 'c2', fromNodeId: 'add', fromPort: 'result', toNodeId: 'unpack', toPort: 'record' },
            'c3': { id: 'c3', fromNodeId: 'unpack', fromPort: 'w', toNodeId: 'outW', toPort: 'value' },
          }
        },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const { graph: graphDef } = compileGraph(appState, new Map(), repository);
    const executor = new GraphExecutor(graphDef, repository);
    executor.update({ clock: { beat: 0, dt: 0 } });

    expect(executor.getGraphOutput('outW')).toBe(40);
  });

  it('should propagate Record vector type from math.all.add to core.unpack', () => {
    const repository = new NodeRepository();
    // Register unpack
    // @ts-ignore
    const unpackDef = ALL_PRIMITIVES.find(p => p.id === 'core.unpack')!;
    repository.register({
      id: unpackDef.id,
      version: '1.0.0',
      displayName: 'Unpack',
      definition: unpackDef,
      inputs: [{ name: 'record', type: float4Type }],
      outputs: []
    });

    // Register math.all.add (Standard)
    const addDef = ALL_PRIMITIVES.find(p => p.id === 'math.all.add')!;
    // We must ensure allowMultiConnection is passed correctly here too if we manually register.
    repository.register({
      id: addDef.id,
      version: '1.0.0',
      displayName: 'Add',
      definition: addDef,
      inputs: Object.entries((addDef as any).inputs || {}).map(([name, type]) => ({
        name,
        type: type as any,
        allowMultiConnection: (type as any).allowMultiConnection
      })),
      outputs: [{ name: 'result', type: numberType }],
      compileConfig: () => ({ fields: {} })
    });

    // Register Mock Record Float4 Source
    repository.register({
      id: 'mock.rec_float4',
      version: '1.0.0',
      displayName: 'RecFloat4',
      definition: {
        id: 'mock.rec_float4',
        kind: 'primitive',
        metadata: { category: 'Mock' },
        // Use computeForwardPorts instead of computeOutputTypes for Compiler compatibility
        computeForwardPorts: () => ({
          inputs: { kind: 'record', fields: {} },
          outputs: { kind: 'record', fields: { out: { kind: 'record', fields: { x: numberType, y: numberType, z: numberType, w: numberType } } } }
        }),
        execute: () => ({ fields: { out: { x: 10, y: 20, z: 30, w: 40 } } })
      },
      inputs: [],
      // TYPE IS RECORD HERE
      outputs: [{ name: 'out', type: { kind: 'record', fields: { x: numberType, y: numberType, z: numberType, w: numberType } } }],
      compileConfig: () => ({ fields: {} })
    });

    // Register Output (Mock)
    repository.register({
      id: 'io.output',
      version: '1.0.0',
      displayName: 'Output',
      definition: {
        id: 'io.output',
        kind: 'primitive',
        metadata: { category: 'Mock' },
        computeOutputTypes: () => ({ kind: 'record', fields: { value: numberType }, }),
        execute: (inputs) => ({ fields: { value: inputs.fields.value } })
      },
      inputs: [{ name: 'value', type: numberType }],
      outputs: [{ name: 'value', type: numberType }],
      compileConfig: (c) => ({ fields: {} })
    });

    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'src': { id: 'src', x: 0, y: 0, config: { typeId: 'mock.rec_float4' } },
            'add': { id: 'add', x: 100, y: 0, config: { typeId: 'math.all.add' } },
            'unpack': { id: 'unpack', x: 200, y: 0, config: { typeId: 'core.unpack' } },
            'outW': { id: 'outW', x: 200, y: 100, config: { typeId: 'io.output', name: 'outW' } }
          },
          connections: {
            'c1': { id: 'c1', fromNodeId: 'src', fromPort: 'out', toNodeId: 'add', toPort: 'values' },
            'c2': { id: 'c2', fromNodeId: 'add', fromPort: 'result', toNodeId: 'unpack', toPort: 'record' },
            'c3': { id: 'c3', fromNodeId: 'unpack', fromPort: 'w', toNodeId: 'outW', toPort: 'value' },
          }
        },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const { graph: graphDef } = compileGraph(appState, new Map(), repository);
    const executor = new GraphExecutor(graphDef, repository);
    executor.update({ clock: { beat: 0, dt: 0 } });

    expect(executor.getGraphOutput('outW')).toBe(40);
  });
  it('should handle scalar input in math.all.add (Scalar Robustness)', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'a': { typeId: 'data.literal', config: { value: 10 } },
        'b': { typeId: 'data.literal', config: { value: 20 } },
        'add': { typeId: 'math.all.add' }
      },
      [
        { from: 'a', port: 'value', to: 'add', portIn: 'values' },
        { from: 'b', port: 'value', to: 'add', portIn: 'values' }
      ],
      'add', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });

    // Result should be 30 (scalar)
    expect(getOutput()).toBe(30);
  });

  it('should produce an Array (float4) when targetType is float4 in core.pack', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'x': { typeId: 'data.literal', config: { value: 1 } },
        'y': { typeId: 'data.literal', config: { value: 2 } },
        'z': { typeId: 'data.literal', config: { value: 3 } },
        'w': { typeId: 'data.literal', config: { value: 4 } },
        'pack': { typeId: 'core.pack', config: { targetType: 'float4' } }
      },
      [
        { from: 'x', port: 'value', to: 'pack', portIn: 'x' },
        { from: 'y', port: 'value', to: 'pack', portIn: 'y' },
        { from: 'z', port: 'value', to: 'pack', portIn: 'z' },
        { from: 'w', port: 'value', to: 'pack', portIn: 'w' }
      ],
      'pack', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });

    const result = getOutput();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([1, 2, 3, 4]);
  });
  it('should treat two float4 arrays as two inputs to math.all.add (Vector Math)', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'vecA': { typeId: 'data.literal', config: { value: [1, 2, 3, 4] } },
        'vecB': { typeId: 'data.literal', config: { value: [10, 20, 30, 40] } },
        'add': { typeId: 'math.all.add' }
      },
      [
        { from: 'vecA', port: 'value', to: 'add', portIn: 'values' },
        { from: 'vecB', port: 'value', to: 'add', portIn: 'values' }
      ],
      'add', 'result'
    );
    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toEqual([11, 22, 33, 44]);
  });

  it('should broadcast vector inputs in math.add (Element-wise Math)', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'vecA': { typeId: 'data.literal', config: { value: [1, 2, 3, 4] } },
        'vecB': { typeId: 'data.literal', config: { value: [10, 20, 30, 40] } },
        'add': { typeId: 'math.add' }
      },
      [
        { from: 'vecA', port: 'value', to: 'add', portIn: 'a' },
        { from: 'vecB', port: 'value', to: 'add', portIn: 'b' }
      ],
      'add', 'result'
    );
    executor.update({ clock: { beat: 0, dt: 0 } });
    // Expect element-wise addition, not string concatenation
    expect(getOutput()).toEqual([11, 22, 33, 44]);
  });

  it('should execute a simple subgraph', () => {
    // 1. Define Subgraph "MyLayer"
    // Input(val) -> Add(5) -> Output(res)
    const myLayerId = 'MyLayer';
    const myLayerState: GraphState = {
      inner: {
        nodes: {
          'in': { id: 'in', x: 0, y: 0, config: { typeId: 'io.input', name: 'val', values: {} } },
          'add': { id: 'add', x: 100, y: 0, config: { typeId: 'math.add' } },
          'lit': { id: 'lit', x: 100, y: 50, config: { typeId: 'data.literal', value: 5 } },
          'out': { id: 'out', x: 200, y: 0, config: { typeId: 'io.output', name: 'res', values: {} } },
        },
        connections: {
          'c1': { id: 'c1', fromNodeId: 'in', fromPort: 'value', toNodeId: 'add', toPort: 'a' },
          'c2': { id: 'c2', fromNodeId: 'lit', fromPort: 'value', toNodeId: 'add', toPort: 'b' },
          'c3': { id: 'c3', fromNodeId: 'add', fromPort: 'result', toNodeId: 'out', toPort: 'val' },
        }
      },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    };

    // Fix connection for mock
    // Input of io.output mock is 'val'.
    // Origin is 'add.result'.
    myLayerState.inner.connections['c3'] = { id: 'c3', fromNodeId: 'add', fromPort: 'result', toNodeId: 'out', toPort: 'value' };

    const loadedSubgraphs = new Map<string, GraphState>();
    loadedSubgraphs.set(myLayerId, myLayerState);

    // 2. Main Graph
    // Literal(10) -> Subgraph(MyLayer) -> Output
    const { executor, getOutput } = compileAndRun(
      {
        'src': { typeId: 'data.literal', config: { value: 10 } },
        'sub': { typeId: 'core.subgraph', config: { subgraphId: myLayerId } },
      },
      [
        { from: 'src', port: 'value', to: 'sub', portIn: 'val' }, // Subgraph input 'val'
        // Subgraph output 'res'
      ],
      'sub', 'res',
      undefined,
      loadedSubgraphs
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(15);
  });

  it('should dynamically rename subgraph ports with #', () => {
    const repository = new NodeRepository();
    ALL_PRIMITIVES.forEach(def => {
      // Minimal registration for compiler
      repository.register({
        id: def.id,
        version: '1.0.0',
        displayName: def.id,
        definition: def,
        inputs: Object.entries((def as any).inputs || {}).map(([name, type]) => ({
          name,
          type: type as any,
          allowMultiConnection: (type as any).allowMultiConnection
        })),
        outputs: Object.entries((def as any).outputs || {}).map(([name, type]) => ({ name, type: type as any })),
        compileConfig: (uiConfig) => uiConfig as any
      });
    });

    // 1. Define Subgraph with dynamic names
    const loadedSubgraphs = new Map<string, GraphState>();
    loadedSubgraphs.set('SubDynamic', {
      inner: {
        nodes: {
          'in1': { id: 'in1', x: 0, y: 0, config: { typeId: 'io.input', name: 'In #' } },
          'in2': { id: 'in2', x: 0, y: 100, config: { typeId: 'io.input', name: 'In #' } },
          'out1': { id: 'out1', x: 200, y: 0, config: { typeId: 'io.output', name: 'Out #' } }
        },
        connections: {
          'c1': { id: 'c1', fromNodeId: 'in1', fromPort: 'value', toNodeId: 'out1', toPort: 'value' }
        }
      },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    });

    // 2. Main Graph using Subgraph
    // Inputs sorted by Y: in1 (y=0) -> 'In x', in2 (y=100) -> 'In y' (Total 2 <= 4)
    // Actually, distinct names 'In #' -> 'In x', 'In y'
    // Logic: name = 'In #'.
    // If total=2: <=4. replacement = x/y.
    // So 'In x', 'In y'.

    // Check Outputs: out1 (total=1) -> 'Out out'?
    // Logic: total=1. replacement = 'out' (lowercase).
    // So 'Out out'.

    // Wait, user said: "when there is exactly one input, # should be replaced with in"
    // So 'In #' -> 'In in'. That sounds redundant.
    // Usually user sets name to just '#'. Then it becomes 'in'.
    // If user sets 'Val #', it becomes 'Val x'.

    // Let's test standard case: name="#" -> "x", "y" or "in".
    // Let's update subgraph definition to use purely "#".

    loadedSubgraphs.set('SubPure', {
      inner: {
        nodes: {
          'in1': { id: 'in1', x: 0, y: 0, config: { typeId: 'io.input', name: '#' } },
          'in2': { id: 'in2', x: 0, y: 100, config: { typeId: 'io.input', name: '#' } },
          'out1': { id: 'out1', x: 200, y: 0, config: { typeId: 'io.output', name: '#' } }
        },
        connections: {}
      },
      auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
    });

    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'sub': { id: 'sub', x: 0, y: 0, config: { typeId: 'core.subgraph', subgraphId: 'SubPure' } }
          },
          connections: {}
        },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const { inferredTypes } = compileGraph(appState, loadedSubgraphs, repository);
    const subTypes = inferredTypes['sub'];

    // Inputs: 2 nodes. Names should be x, y.
    expect(subTypes.inputs.fields['x']).toBeDefined();
    expect(subTypes.inputs.fields['y']).toBeDefined();

    // Outputs: 1 node. Name should be 'out'.
    expect(subTypes.outputs.fields['out']).toBeDefined();
  });

  it('should implicitly group and conditionally execute nodes with core.ifthen', () => {
    // 1. Define Graph
    // Trigger -> IfThen (contains Inner)
    // Inner -> Outer

    // Note On Event
    const noteOn = [{ type: 'note_on', channel: 0, note: 60, velocity: 127 }];

    const { executor, getOutput, updateConfig } = compileAndRun(
      {
        't1': { typeId: 'data.literal', x: -2, y: 0, config: { value: [] as any } },
        'if': { typeId: 'core.ifthen', x: 0, y: 0, config: { width: 10, height: 10 } },
        'in1': { typeId: 'data.literal', x: 1, y: 1, config: { value: 10 } },
        'c5': { typeId: 'data.literal', x: 20, y: 10, config: { value: 5 } },
        'out1': { typeId: 'math.add', x: 20, y: 0 }
      },
      [
        { from: 't1', port: 'value', to: 'if', portIn: 'midi_in' },
        { from: 'in1', port: 'value', to: 'out1', portIn: 'a' },
        { from: 'c5', port: 'value', to: 'out1', portIn: 'b' }
      ],
      'out1', 'result'
    );

    // 1. Run without trigger
    // 'in1' is implicitly owned by 'if'. It should NOT run.
    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(5); // Default value 0 used for missing input from in1

    // 2. Run WITH trigger
    updateConfig('t1', { value: noteOn });
    console.log('Executor Downstream Map:', (executor as any).downstreamMap);
    console.log('Executor Execution Order:', (executor as any).mainExecutionOrder);

    executor.update({ clock: { beat: 0, dt: 0 } });

    // 'if' runs -> triggers 'onTrigger' -> 'in1' runs (output 10).
    // 'out1' runs -> reads 10 + 5 -> 15.
    expect(getOutput()).toBe(15);

    // 3. Run again WITHOUT trigger
    updateConfig('t1', { value: [] });
    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(15); // Stale value preserved
    expect(getOutput()).toBe(15); // Stale value preserved
  });

  test('should handle empty core.ifthen node without error', () => {
    // Regression test for "Subgraph undefined not found"
    const { executor } = compileAndRun(
      {
        'if': { typeId: 'core.ifthen', x: 0, y: 0, config: { width: 3, height: 3 } },
      },
      [],
      'if', 'out' // Dummy connection
    );

    // Should assume no error occurred during compilation
    expect(executor).toBeDefined();

    // Execution should be safe
    executor.update({ clock: { beat: 0, dt: 0 } });
  });

  it('should support hybrid input for core.ifthen (Primitive Mode)', () => {
    // 1. Define Graph
    // Trigger(Literal) -> IfThen(Primitive Mode) -> Output

    // We expect `core.ifthen` to detect that the input is a scalar (Primitive)
    // and switch to 'primitive' mode.

    // 'in1' is inside 'if'. 'out1' sums 'in1' + 5.

    const { executor, getOutput, updateConfig } = compileAndRun(
      {
        'trigger': { typeId: 'data.literal', x: -2, y: 0, config: { value: 0 } },
        'if': { typeId: 'core.ifthen', x: 0, y: 0, config: { width: 10, height: 10 } },
        'in1': { typeId: 'data.literal', x: 1, y: 1, config: { value: 10 } },
        'c5': { typeId: 'data.literal', x: 20, y: 10, config: { value: 5 } },
        'out1': { typeId: 'math.add', x: 20, y: 0 }
      },
      [
        { from: 'trigger', port: 'value', to: 'if', portIn: 'midi_in' }, // Connect Scalar to 'midi_in'
        { from: 'in1', port: 'value', to: 'out1', portIn: 'a' },
        { from: 'c5', port: 'value', to: 'out1', portIn: 'b' }
      ],
      'out1', 'result'
    );

    // Verify Config Mode
    const ifNodeState = executor.getNodeState('if');
    expect((ifNodeState?.config as any)?.fields?.mode).toBe('primitive');

    // 1. Run with Falsy Trigger (0)
    // 'if' should NOT run. 'in1' not triggered.
    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(5); // 0 (default) + 5

    // 2. Run with Truthy Trigger (1)
    updateConfig('trigger', { value: 1 });
    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(15); // 10 + 5

    // 3. Run with Truthy Trigger (999)
    updateConfig('trigger', { value: 999 });
    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(15);
  });
});

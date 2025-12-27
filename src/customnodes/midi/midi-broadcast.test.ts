import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { compileGraph } from '../../builder/compiler';
import { AppState, GridNode, Connection } from '../../builder/state';
import { numberType, midiStreamType } from '../../structor/std-types';
import { midiTriggerNode, midiMergeNode } from './nodes';
import { MidiEvent } from '../../io/midi/types';

// Simplified compileAndRun for MIDI nodes
const compileAndRunMidi = (
  nodes: Record<string, { typeId: string, config?: any, values?: any }>,
  connections: { from: string, port: string, to: string, portIn: string }[],
  monitoredNode: string,
  monitoredPort: string
) => {
  const repository = new NodeRepository();

  // Register MIDI nodes
  [midiTriggerNode, midiMergeNode].forEach(def => {
    repository.register({
      id: def.id,
      version: '1.0.0',
      displayName: def.displayName,
      definition: def,
      inputs: Object.entries((def as any).extendedInputs || (def as any).inputs || {}).map(([name, type]) => ({
        name,
        type: (type as any).type || type,
        allowMultiConnection: (type as any).allowMultiConnection
      })),
      outputs: Object.entries((def as any).outputs || {}).map(([name, type]) => ({ name, type: type as any })),
      compileConfig: def.compileConfig
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
      configType: { kind: 'record', fields: {}, },
      computeForwardPorts: () => ({ inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: { val: midiStreamType } }, }),
      execute: (inputs) => {
        return { fields: { val: inputs.fields.val }, };
      },
    },
    inputs: [{ name: 'val', type: midiStreamType }],
    outputs: [{ name: 'val', type: midiStreamType }],
    compileConfig: (c) => ({ fields: {}, })
  });

  // Register Generic Output for numeric checks if needed
  repository.register({
    id: 'io.output.num',
    version: '1.0.0',
    displayName: 'Output Num',
    definition: {
      id: 'io.output.num',
      kind: 'primitive',
      configType: { kind: 'record', fields: {}, },
      computeForwardPorts: () => ({ inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: { val: numberType } }, }),
      execute: (inputs) => {
        return { fields: { val: inputs.fields.val }, };
      },
    },
    inputs: [{ name: 'val', type: numberType }],
    outputs: [{ name: 'val', type: numberType }],
    compileConfig: (c) => ({ fields: {}, })
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
        values: def.values || {},
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

  const { graph: graphDef, inferredTypes } = compileGraph(appState, new Map(), repository);
  const executor = new GraphExecutor(graphDef, repository, undefined, inferredTypes);
  console.error('Execution Order:', (executor as any).executionOrder);
  console.error('Node States Size:', (executor as any).nodeStates.size);
  return { executor, getOutput: () => executor.getGraphOutput('test_out') };
};

describe('MIDI Broadcast Integration', () => {
  it('should merge multiple midi streams using manual logic (current)', () => {
    // 2 Triggers -> 1 Merge -> Output
    const { executor, getOutput } = compileAndRunMidi(
      {
        't1': { typeId: 'midi.trigger', values: { trigger: 0 }, config: { pitch: 60 } },
        't2': { typeId: 'midi.trigger', values: { trigger: 0 }, config: { pitch: 62 } },
        'merge': { typeId: 'midi.merge' }
      },
      [
        { from: 't1', port: 'stream', to: 'merge', portIn: 'stream' },
        { from: 't2', port: 'stream', to: 'merge', portIn: 'stream' }
      ],
      'merge', 'stream'
    );

    // Initial state: empty
    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toEqual([]);

    // Trigger t1
    // We update the "userNodeStates" directly to simulate virtual input?
    // No, compileAndRunMidi mapping puts 'values' into config.
    // So we need to update config.
    // But helper `compileAndRunMidi` hardcodes initial config.
    // We need to use executor.setNodeConfig to update `trigger` value.

    // Virtual input `trigger` is in `config.values`.

    // Trigger T1
    executor.setNodeConfig('t1', { values: { trigger: 1 } } as any);
    executor.update({ clock: { beat: 1, dt: 0.1 } });

    const out1 = getOutput() as unknown as any[]; // StructorRecord[]
    console.log('Out1:', JSON.stringify(out1));
    expect(out1.length).toBe(1); // Note On (Momentary)
    expect(out1.find(e => e.fields.type === 'note_on' && e.fields.note === 60)).toBeDefined();

    // Trigger T2
    executor.setNodeConfig('t2', { values: { trigger: 1 } } as any);
    executor.update({ clock: { beat: 2, dt: 0.1 } });

    const out2 = getOutput() as unknown as any[];
    // Reset Triggers
    executor.setNodeConfig('t1', { values: { trigger: 0 } } as any);
    executor.setNodeConfig('t2', { values: { trigger: 0 } } as any);
    executor.update({ clock: { beat: 2.5, dt: 0.1 } });

    // Trigger Both
    executor.setNodeConfig('t1', { values: { trigger: 1 } } as any);
    executor.setNodeConfig('t2', { values: { trigger: 1 } } as any);
    executor.update({ clock: { beat: 3, dt: 0.1 } });

    const out3 = getOutput() as unknown as any[];
    // Should have 2 events (1 from each)
    expect(out3.length).toBe(2);
    expect(out3.filter(e => e.fields.type === 'note_on').length).toBe(2);
  });
});

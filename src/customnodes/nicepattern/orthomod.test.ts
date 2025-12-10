import { describe, it, expect } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { NodeRepository } from '../../structor/repository';
import { orthomod, generateCodes, vec4Type, OrthomodFields } from './orthomod';
import { numberType, midiStreamType } from '../../structor/std-types';
import { AnyType as anyType } from '../../structor/type-helpers';
import { compileGraph } from '../../builder/compiler';
import { AppState, GridNode, Connection } from '../../builder/state';
import { MidiEvent } from '../../io/midi/types';
import { registerNicePatternUI } from './ui-registration';

registerNicePatternUI();

describe('Orthomod Node', () => {

  // --- Unit Tests ---
  describe('Logic Helpers', () => {
    it('generateCodes should produce correct Hadamard subset', () => {
      const codes = generateCodes(4, 123);
      expect(codes.length).toBe(4);
      expect(codes[0].length).toBe(8);
      // Index 0 should be all ON (logic constraint) -> Wait, logic says generateCodes calls sort then rawCodes[0]=ALL_ON.
      // But we shuffle columns. So if a row is all 1s, shuffling columns keeps it all 1s.
      // So one of the codes in the FULL SET should be all 1s.
      // But we slice subset. Is the all-1s code always the first one in complexity sort?
      // Complexity of [1,1,1,1,1,1,1,1] is 0.
      // Complexity of [0,0,0,0,0,0,0,0] is 0.
      // The sort is stable?
      // "RAW_CODES[0] = [1...]" overrides whatever was first.
      // So yes, code at index 0 before shuffle is all 1s.
      // After shuffle, it is still all 1s.
      expect(codes[0]).toEqual([1,1,1,1,1,1,1,1]);
    });

    it('generateCodes should be deterministic with seed', () => {
      const c1 = generateCodes(8, 999);
      const c2 = generateCodes(8, 999);
      const c3 = generateCodes(8, 888);
      expect(c1).toEqual(c2);
      expect(c1).not.toEqual(c3);
    });
  });

  // --- Integration Tests ---
  const repository = new NodeRepository();
  repository.register({
    id: orthomod.id,
    version: orthomod.version,
    displayName: orthomod.displayName,
    definition: orthomod,
    inputs: [
        { name: 'midi_in', type: midiStreamType },
        { name: 'decay', type: numberType, defaultValue: 1.2 },
        { name: 'curve', type: numberType, defaultValue: 1.5 },
        { name: 'resolution', type: numberType, defaultValue: 8 },
        { name: 'manual_phase', type: numberType, defaultValue: -1 }
    ],
    outputs: [
        { name: 'env', type: numberType },
        { name: 'vec', type: vec4Type },
        { name: 'ch1', type: numberType },
        { name: 'ch2', type: numberType },
        { name: 'ch3', type: numberType },
        { name: 'ch4', type: numberType },
    ],
    compileConfig: orthomod.compileConfig!
  });

  // Mock Input Node
  repository.register({
    id: 'io.input',
    version: '1.0.0',
    displayName: 'Input',
    definition: {
      id: 'io.input',
      kind: 'primitive',
      configType: { kind: 'record', fields: {},  },
      computeOutputTypes: () => ({ kind: 'record', fields: { val: anyType },  }),
      execute: (inputs, config) => ({ fields: { val: config },  }),
    },
    inputs: [],
    outputs: [{ name: 'val', type: anyType }],
    compileConfig: (c) => c
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
      computeOutputTypes: () => ({ kind: 'record', fields: { val: anyType },  }),
      execute: (inputs) => ({ fields: { val: inputs.fields.val },  }),
    },
    inputs: [{ name: 'val', type: anyType }],
    outputs: [{ name: 'val', type: anyType }],
    compileConfig: (c) => ({ fields: {},  })
  });

  const compileAndRunwithOutput = (
    nodes: Record<string, { typeId: string, config?: any }>,
    connections: { from: string, port: string, to: string, portIn: string }[],
    monitoredNode: string,
    monitoredPort: string
  ) => {
    // Add output node
    const nodesWithOutput = { ...nodes, 'out_node': { typeId: 'io.output', config: { name: 'test_out' } } };
    const connectionsWithOutput = [
      ...connections,
      { from: monitoredNode, port: monitoredPort, to: 'out_node', portIn: 'val' }
    ];

    const gridNodes: Record<string, GridNode> = {};
    const gridConnections: Record<string, Connection> = {};

    let x = 0;
    for (const [id, def] of Object.entries(nodesWithOutput)) {
      gridNodes[id] = {
        id, x: x++, y: 0,
        config: { typeId: def.typeId, values: {}, ...def.config }
      };
    }

    let connId = 0;
    for (const conn of connectionsWithOutput) {
      const id = `c${connId++}`;
      gridConnections[id] = {
        id, fromNodeId: conn.from, fromPort: conn.port, toNodeId: conn.to, toPort: conn.portIn
      };
    }

    const appState: AppState = {
      graph: {
        inner: { nodes: gridNodes, connections: gridConnections },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      }
    };

    const { graph: graphDef } = compileGraph(appState, new Map(), repository);
    const executor = new GraphExecutor(graphDef, repository);
    return { executor, getOutput: () => executor.getNodeOutput('out_node')?.fields?.val };
  };

  it('should respond to MIDI trigger', () => {
      const { executor, getOutput } = compileAndRunwithOutput(
          {
              'ortho': { typeId: orthomod.id, config: { seed: 12345 } },
              'midi_src': { typeId: 'io.input', config: { values: {}, value: [] } }
          },
          [
              { from: 'midi_src', port: 'val', to: 'ortho', portIn: 'midi_in' }
          ],
          'ortho', 'env'
      );

      // 1. Initial State -> Env 0
      executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
      expect(getOutput()).toBeCloseTo(0);

      // 2. Note On
      const noteOn = [{ fields: { type: 'note_on', note: 60, velocity: 100 },  }];
      executor.setNodeConfig('midi_src', noteOn as any);
      executor.update({ clock: { beat: 0, dt: 0.1, time: 0.1 } });

      // Should jump to 1.0 (start of env)
      // Note logic: note_on sets linearEnv=1.0. Curve calculation comes after.
      // But update also applies decay for that frame (dt).
      // linearEnv = 1.0 - (0.1 / 1.2) = 0.916...
      // curve = 0.916^1.5 = 0.877...
      const val = getOutput();
      expect(val).toBeGreaterThan(0.8);
      expect(val).toBeLessThan(1.0);

      // 3. Decay
      // default decay 1.2s. dt=0.1.
      // linearEnv = 1.0 - 0.1/1.2 = 0.916...
      const nextNote = []; // Clear midi
      executor.setNodeConfig('midi_src', nextNote as any);
      executor.update({ clock: { beat: 0, dt: 0.1, time: 0.2 } });

      const decayVal = getOutput();
      expect(decayVal).toBeLessThan(1.0);
      expect(decayVal).toBeGreaterThan(0.7); // Rough check
  });

  it('should map envelope to channels', () => {
      const { executor, getOutput } = compileAndRunwithOutput(
          {
              'ortho': { typeId: orthomod.id, config: { seed: 999, values: { manual_phase: 1.0 } } }, // Manual Start (Index 0)
          },
          [],
          'ortho', 'ch1'
      );

      // Manual Phase 1.0 -> Linear 1.0 -> Env 1.0.
      // Pos = 1.0 - 1.0 = 0. Index 0.
      // Code Index 0 is ALL ON [1,1,1...].
      // Channel 1, bit 0 and 1 -> 1, 1.
      // Logic: if 1,1 -> val=1.
      // Output = val * env = 1 * 1.0 = 1.0.

      executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
      expect(getOutput()).toBeCloseTo(1.0);
  });

  it('should handle NaN inputs gracefully', () => {
       const { executor, getOutput } = compileAndRunwithOutput(
          {
              'ortho': { typeId: orthomod.id, config: { seed: 12345, values: { manual_phase: NaN, decay: NaN } } },
          },
          [],
          'ortho', 'env'
      );

      executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
      const val = getOutput();
      expect(val).not.toBeNaN();
      expect(val).toBe(0); // Default manual_phase -1 -> Env 0
  });

  it('should handle aggressive invalid inputs gracefully', () => {
       const { executor, getOutput } = compileAndRunwithOutput(
          {
              'ortho': { typeId: orthomod.id, config: { seed: 'invalid', values: { manual_phase: -50, decay: 0, curve: -2 } } },
          },
          [],
          'ortho', 'env'
      );

      executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
      const val = getOutput();
      expect(val).not.toBeNaN();

      // With manual phase -50, it should be treated as off (-1) because of sanitization?
      // Actually my logic: `const manualPhase = ... ? inputs.manual_phase : -1.0;`
      // If input is -50, it is finite number.
      // Logic: `if (manualPhase >= 0)`
      // -50 >= 0 is false. So envelope logic runs.
      // Decay 0 -> Sanitized to 0.001.
      // Curve -2 -> Sanitized to 0.001.

      // It should run normal envelope logic (Env=0).
      expect(val).not.toBeNaN();
  });
});

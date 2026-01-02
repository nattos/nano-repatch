import { describe, it, expect } from 'vitest';
import { orthomod, generateCodes, float4Type } from './orthomod';
import { numberType, midiStreamType } from '../../structor/std-types';
import { AnyType as anyType } from '../../structor/type-helpers';
import { registerNicePatternUI } from './ui-registration';
import { compileAndRun } from '../../test/integration-utils';
import { NodeRepository } from '../../structor/repository';

registerNicePatternUI();

describe('Orthomod Node', () => {

  // --- Unit Tests ---
  describe('Logic Helpers', () => {
    it('generateCodes should produce correct Hadamard subset', () => {
      const codes = generateCodes(4, 123);
      expect(codes.length).toBe(4);
      expect(codes[0].length).toBe(8);
      // Index 0 should be all ON (logic constraint)
      expect(codes[0]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
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
  const registerOrthomod = (repository: NodeRepository) => {
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
        { name: 'vec', type: float4Type },
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
        configType: { kind: 'record', fields: {}, },
        computeOutputTypes: () => ({ kind: 'record', fields: { val: anyType }, }),
        execute: (inputs, config) => ({ fields: { val: config }, }),
      },
      inputs: [],
      outputs: [{ name: 'val', type: anyType }],
      compileConfig: (c) => c
    });
  };

  it('should respond to MIDI trigger', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'ortho': { typeId: orthomod.id, config: { seed: 12345 } },
        'midi_src': { typeId: 'io.input', config: { values: {}, value: [] } }
      },
      [
        { from: 'midi_src', port: 'val', to: 'ortho', portIn: 'midi_in' }
      ],
      'ortho', 'env',
      registerOrthomod
    );

    // 1. Initial State -> Env 0
    executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
    const out1 = getOutput();
    expect(out1).toBeDefined();
    expect(out1).toBeCloseTo(0);

    // 2. Note On
    const noteOn = [{ fields: { type: 'note_on', note: 60, velocity: 100 }, }];
    executor.setNodeConfig('midi_src', noteOn as any);
    executor.update({ clock: { beat: 0, dt: 0.1, time: 0.1 } });

    // Should jump to 1.0 (start of env)
    // Note logic: note_on sets linearEnv=1.0. Curve calculation comes after.
    // But update also applies decay for that frame (dt).
    // linearEnv = 1.0 - (0.1 / 1.2) = 0.916...
    // curve = 0.916^1.5 = 0.877...
    const val = getOutput();
    expect(val).toBeDefined();
    expect(val).toBeGreaterThan(0.8);
    expect(val).toBeLessThan(1.0);

    // 3. Decay
    // default decay 1.2s. dt=0.1.
    // linearEnv = 1.0 - 0.1/1.2 = 0.916...
    const nextNote = []; // Clear midi
    executor.setNodeConfig('midi_src', nextNote as any);
    executor.update({ clock: { beat: 0, dt: 0.1, time: 0.2 } });

    const decayVal = getOutput();
    expect(decayVal).toBeDefined();
    expect(decayVal).toBeLessThan(1.0);
    expect(decayVal).toBeGreaterThan(0.7); // Rough check
  });

  it('should map envelope to channels', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'ortho': { typeId: orthomod.id, config: { seed: 999, values: { manual_phase: 1.0 } } }, // Manual Start (Index 0)
      },
      [],
      'ortho', 'ch1',
      registerOrthomod
    );

    // Manual Phase 1.0 -> Linear 1.0 -> Env 1.0.
    // Pos = 1.0 - 1.0 = 0. Index 0.
    // Code Index 0 is ALL ON [1,1,1...].
    // Channel 1, bit 0 and 1 -> 1, 1.
    // Logic: if 1,1 -> val=1.
    // Output = val * env = 1 * 1.0 = 1.0.

    executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
    const out = getOutput();
    expect(out).toBeDefined();
    expect(out).toBeCloseTo(1.0);
  });

  it('should handle NaN inputs gracefully', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'ortho': { typeId: orthomod.id, config: { seed: 12345, values: { manual_phase: NaN, decay: NaN } } },
      },
      [],
      'ortho', 'env',
      registerOrthomod
    );

    executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
    const val = getOutput();
    expect(val).toBeDefined();
    expect(val).not.toBeNaN();
    expect(val).toBe(0); // Default manual_phase -1 -> Env 0
  });

  it('should handle aggressive invalid inputs gracefully', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'ortho': { typeId: orthomod.id, config: { seed: 'invalid', values: { manual_phase: -50, decay: 0, curve: -2 } } },
      },
      [],
      'ortho', 'env',
      registerOrthomod
    );

    executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });
    const val = getOutput();
    expect(val).toBeDefined();
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

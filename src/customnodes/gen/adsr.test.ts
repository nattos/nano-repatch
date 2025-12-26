import { adsr } from './nodes';
import { GraphExecutor } from '../../structor/executor';
import { defaultNodeRepository } from '../../structor/repository';
import { defineRecordType, numberType } from '../../structor/std-types';

describe('ADSR Node Logic', () => {

  const compile = () => {
    // Basic setup mostly to get the node execute function
    return adsr.execute;
  };

  const execute = adsr.execute;
  const createState = adsr.createState;

  const createMockContext = () => {
    const nodeState = new Map();
    return {
      clock: { dt: 0.1 },
      nodeState,
      nodeId: 'test-node',
      broadcast: (config: any, inputs: any) => ({
        apply: (fn: any) => fn(inputs)
      })
    } as any;
  };

  const getFields = (result: any) => {
    if (result.outputs && result.outputs.fields) {
      return result.outputs.fields;
    }
    if (result.fields) {
      return result.fields;
    }
    // Fallback if structure is unexpected, but prevent crash
    return {};
  };

  it('should support zero attack time', () => {
    const context = createMockContext();
    const nodeState = context.nodeState;

    // Attack = 0
    const inputs = {
      stream: [{ type: 'note_on', velocity: 1.0 }],
      attack: 0.0,
      decay: 1.0, // Long decay to verify we stay near 1.0
      sustain: 0.5,
      release: 0.1
    };

    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADSR' }
      }
    };
    const result = execute(inputs as any, config as any, context);
    // State is internal to the wrapper context now, but we can inspect it via the map
    const state = nodeState.get('test-node');

    expect(state.phase).not.toBe(0); // Not Idle
    const fields = getFields(result);
    // Expect close to 1.0. If instantaneous, it reaches decay phase immediately?
    // In execute: if attack <= 0 -> value = 1.0, phase = DECAY.
    // So output should be 1.0 (clamped).
    // Test says > 0.9.
    expect(fields.value).toBeGreaterThan(0.9);
  });

  it('should handle Trigger (On + Off) with Zero Attack', () => {
    const context = createMockContext();
    context.clock.dt = 0.01;
    const nodeState = context.nodeState;

    // Trigger: On then Off
    const inputs = {
      stream: [
        { type: 'note_on', velocity: 1.0 },
        { type: 'note_off', velocity: 0.0 }
      ],
      attack: 0.0,
      decay: 1.0,
      sustain: 0.5,
      release: 1.0
    };

    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADSR' }
      }
    };

    // Execution
    const result = execute(inputs as any, config as any, context);
    const state = nodeState.get('test-node');

    const fields = getFields(result);
    // It should hit peak (1.0) then release immediately? or process sequentially?
    // ADSR logic: loop stream.
    // Note On -> Phase Attack -> Time=0 -> Attack<=0 -> Value=1.0, Phase=Decay.
    // Note Off -> ActiveNotes=0. Check for Release?
    // If ActiveNotes=0 and Phase!=Idle/Release -> Phase=Release.
    // So by end of loop, Phase=Release.
    // Then switch(State.Phase). Case Release.
    // Time += dt.
    // ReleaseTime=1.0. Dt=0.01. Value -= 0.01.
    // Value = 1.0 - 0.01 = 0.99.

    expect(fields.value).toBeCloseTo(0.99, 1);
    expect(state.phase).toBe(4); // RELEASE
  });

  it('should handle Trigger with Zero Attack and Zero Decay', () => {
    const context = createMockContext();
    context.clock.dt = 0.01;

    const inputs = {
      stream: [
        { type: 'note_on', velocity: 1.0 },
        { type: 'note_off', velocity: 0.0 }
      ],
      attack: 0.0,
      decay: 0.0,
      sustain: 0.5,
      release: 1.0
    };

    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADSR' }
      }
    };

    const result = execute(inputs as any, config as any, context);
    const fields = getFields(result);

    // Note On -> Attack=0 -> Value=1.0, Phase=Decay, Time=0.
    // Decay=0 -> Value=Sustain(0.5), Phase=Sustain.
    // Note Off -> Phase=Release.
    // Switch(Release) -> Time=0.01.
    // Release=1.0. Value -= 0.01 * (1.0/1.0).
    // Start value was 0.5.
    // Value = 0.5 - 0.01 = 0.49.

    expect(fields.value).toBeCloseTo(0.49, 1);
  });

  it('should support Decay Mode (D)', () => {
    const context = createMockContext();
    context.clock.dt = 0.1;

    // Mode 'D': Attack should be forced to 0
    const inputs = {
      stream: [{ type: 'note_on', velocity: 1.0 }],
      decay: 1.0,
      // Attack/Sustain/Release passed but should be ignored
      attack: 1.0,
      sustain: 1.0,
      release: 1.0
    };

    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'D' }
      }
    };

    const result = execute(inputs as any, config as any, context);

    const state = context.nodeState.get('test-node');
    const fields = getFields(result);

    expect(state.phase).not.toBe(0);
    // Attack should be 0 -> Instant 1.0. Next frame decays.
    // Dt=0.1. Decay=1.0. Stop at 0.9.
    expect(fields.value).toBeGreaterThan(0.85);
  });

  it('should support ADS Mode', () => {
    const context = createMockContext();
    context.clock.dt = 0.01;

    // ADS Mode: Release should equal Decay
    const inputs = {
      stream: [
        { type: 'note_on', velocity: 1.0 },
        { type: 'note_off', velocity: 0.0 } // Trigger
      ],
      attack: 0.0,
      decay: 0.5,
      // Release passed as 0.1 (fast), but should be ignored for Decay (0.5)
      release: 0.1
    };
    const config = {
      kind: 'record',
      fields: {
        mode: { kind: 'atomic', type: 'string', value: 'ADS' }
      }
    };

    // Trigger processing (Instant Attack -> Peak 1.0 -> Release/Decay).
    // Release duration = Decay = 0.5.
    // dt = 0.01.
    // Drop = (1.0 / 0.5) * 0.01 = 0.02.
    // Value = 0.98.

    const result = execute(inputs as any, config as any, context);
    const fields = getFields(result);

    expect(fields.value).toBeGreaterThan(0.96);
  });
});

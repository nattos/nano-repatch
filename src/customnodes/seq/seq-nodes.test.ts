
import { describe, it, expect, vi } from 'vitest';
import { tomidi, oneshot, scan, crop, xor, negate, sequencer } from './nodes';
import { Step } from './types';
import { defaultNodeRepository } from '../../structor/repository';

// Register for test context if needed (though we import directly, registration is global side effect)
import './nodes';

describe('Sequence Nodes', () => {

  describe('seq.crop', () => {
    it('should pass through steps inside range', () => {
      const inputs = {
        fields: {
          seq_in: [
            // Wrap as StructorRecord if needed?
            // Wait, defineNode unwraps inputs using fromStructor.
            // fromStructor handles plain objects if type is record.
            // Step type is record.
            // But inputs to execute (wrapper) must be StructorRecord or compatible.
            // Let's pass fully wrapped inputs just to be safe, or rely on loose unwrapping.
            // Looking at fromStructor: if input is object and has 'fields', it uses fields. Else treats as plain object.
            // So raw array of objects should be fine for array input.
            { noteIndex: 60, velocity: 1, hold: false },
            { noteIndex: 62, velocity: 1, hold: false },
            { noteIndex: 64, velocity: 1, hold: false },
            { noteIndex: 65, velocity: 1, hold: false }
          ],
          start: 0.25,
          end: 0.75
        }
      };

      // Length 4.
      // 0.0-0.25: Step 0. (0/4 = 0.0)
      // 0.25-0.5: Step 1.
      // 0.5-0.75: Step 2.
      // 0.75-1.0: Step 3.

      // Range 0.25 to 0.75.
      // Step 0: pos 0.0. Outside? (0 < 0.25). Muted.
      // Step 1: pos 0.25. Inside (0.25 >= 0.25). Kept.
      // Step 2: pos 0.50. Inside (0.50 < 0.75). Kept.
      // Step 3: pos 0.75. Outside (0.75 >= 0.75). Muted.

      const context = { nodeState: new Map() } as any; // Minimal mock

      const result = crop.execute(inputs as any, { fields: { mode: 'start-end' } } as any, context, {});
      const seq = result.fields.seq_out as any[]; // result is StructorRecord

      // seq is array of Structors.
      // toStructor wraps Record into { fields: ... }.
      // So elements are { fields: { noteIndex: ..., ... } }

      expect(seq[0].fields.noteIndex).toBeNull();
      expect(seq[1].fields.noteIndex).toBe(62);
      expect(seq[2].fields.noteIndex).toBe(64);
      expect(seq[3].fields.noteIndex).toBeNull();
    });

    it('should handle start-length mode', () => {
      const inputs = {
        fields: {
          seq_in: [
            { noteIndex: 60, velocity: 1, hold: false },
            { noteIndex: 62, velocity: 1, hold: false }
          ],
          start: 0.0,
          length: 0.5
        }
      };
      // Length 2. Step 0 (0.0), Step 1 (0.5).
      // Range: 0.0 to 0.5.
      // Step 0: 0.0 >= 0.0 && 0.0 < 0.5 -> Kept.
      // Step 1: 0.5 >= 0.5 -> Muted (Inclusive start, Exclusive end).

      const context = { nodeState: new Map() } as any;
      const result = crop.execute(inputs as any, { fields: { mode: 'start-length' } } as any, context, {});
      const seq = result.fields.seq_out as any[];

      expect(seq[0].fields.noteIndex).toBe(60);
      expect(seq[1].fields.noteIndex).toBeNull();
    });
  });

  describe('seq.xor', () => {
    it('should XOR two sequences', () => {
      // Seq A: [On, Off]
      // Seq B: [Off, On]
      // Result: [On(A), On(B)]

      const inputs = {
        fields: {
          inputs: [
            [{ noteIndex: 60, velocity: 1, hold: false }, { noteIndex: null, velocity: 0, hold: false }],
            [{ noteIndex: null, velocity: 0, hold: false }, { noteIndex: 62, velocity: 1, hold: false }]
          ]
        }
      };

      const context = { nodeState: new Map() } as any;
      const result1 = xor.execute(inputs as any, { fields: {} } as any, context, {});

      const seq1 = result1.fields.seq_out as any[];
      expect(seq1[0].fields.noteIndex).toBe(60);
      expect(seq1[1].fields.noteIndex).toBe(62);

      // Seq A: [On]
      // Seq B: [On]
      // Result: [Off]
      const inputs2 = {
        fields: {
          inputs: [
            [{ noteIndex: 60, velocity: 1, hold: false }],
            [{ noteIndex: 62, velocity: 1, hold: false }]
          ]
        }
      };
      const result2 = xor.execute(inputs2 as any, { fields: {} } as any, context, {});

      const seq2 = result2.fields.seq_out as any[];
      expect(seq2[0].fields.noteIndex).toBeNull();
    });
  });

  describe('seq.negate', () => {
    it('should invert steps', () => {
      const inputs = {
        fields: {
          seq_in: [{ noteIndex: 60, velocity: 1, hold: false }, { noteIndex: null, velocity: 0, hold: false }]
        }
      };
      const context = { nodeState: new Map() } as any;
      const result = negate.execute(inputs as any, { fields: {} } as any, context, {});

      const seq = result.fields.seq_out as any[];
      expect(seq[0].fields.noteIndex).toBeNull();
      expect(seq[1].fields.noteIndex).toBe(60); // Default fill note
    });
  });

  describe('seq.tomidi', () => {
    it('should process input sequence', () => {
      const state = tomidi.createState({ fields: {} } as any, { nodeState: new Map() } as any);

      const inputs = {
        fields: {
          seq_in: [[
            // 4 steps
            { noteIndex: 60, velocity: 1, hold: false },
            { noteIndex: null, velocity: 0, hold: false },
            { noteIndex: 62, velocity: 1, hold: false },
            { noteIndex: null, velocity: 0, hold: false }
          ]]
        }
      };

      // Step 0. Context beat 0.
      const ctx0 = { clock: { beat: 0, dt: 0.1 }, time: 0, audio: null, midi: null, nodeState: new Map() };
      // Pass state via nodeState map or directly?
      // Wrapper uses nodeState map to retrieve/create state.
      // But definePrimitiveNode wrapper calls options.execute(..., state).
      // If we call wrapper.execute, we don't pass 'state' arg.
      // We pass inputs, config, context.

      const res0 = tomidi.execute(inputs as any, { fields: {} } as any, ctx0 as any);
      // expect Note On 60
      const events0 = res0.fields.midi_out as any[]; // midi stream is array of events
      // events are Structors. records.
      expect(events0).toContainEqual(expect.objectContaining({ fields: expect.objectContaining({ type: 'note_on', note: 60 }) }));

      // Step 0.1 beat. Still step 0?
      // 0.1 * 4 = 0.4. Floor = 0. Same step.
      const ctx1 = { clock: { beat: 0.1, dt: 0.1 }, time: 0.1, audio: null, midi: null, nodeState: ctx0.nodeState };
      const res1 = tomidi.execute(inputs as any, { fields: {} } as any, ctx1 as any);
      expect(res1.fields.midi_out).toHaveLength(0); // No change

      // Step 0.25 beat. Step 1 (0.25 * 4 = 1).
      // Step 1 is rest. Expect Note Off 60?
      // tomidi logic: "ShouldRelease".
      const ctx2 = { clock: { beat: 0.25, dt: 0.1 }, time: 0.25, audio: null, midi: null, nodeState: ctx0.nodeState };
      const res2 = tomidi.execute(inputs as any, { fields: {} } as any, ctx2 as any);

      const events2 = res2.fields.midi_out as any[];
      expect(events2).toContainEqual(expect.objectContaining({ fields: expect.objectContaining({ type: 'note_off', note: 60 }) }));
    });
  });

  describe('seq.oneshot', () => {
    it('should trigger and play', () => {
      const mockAudio = (t: number) => ({ context: { currentTime: t } });
      const mockBroadcast = (config: any, inputs: any) => ({ apply: (fn: Function) => fn(inputs) });
      const ctx0 = {
        clock: { beat: 0 },
        audio: mockAudio(10.0),
        nodeState: new Map(),
        broadcast: mockBroadcast
      } as any;

      const inputs = {
        seq_in: [
          { noteIndex: 60, velocity: 1, hold: false }
        ],
        trigger: [{ type: 'note_on', note: 60, velocity: 1 }],
        duration: 1.0
      };

      // Trigger frame
      // context.audio.context.currentTime = 10.0
      const res0 = oneshot.execute(inputs as any, { fields: {} } as any, ctx0 as any);
      // ... verify output ...

      const events0 = res0.fields.midi_out as any[];
      expect(events0).toContainEqual(expect.objectContaining({ fields: expect.objectContaining({ type: 'note_on', note: 60 }) }));

      // Advance time. 10.5. t=0.5. Still step 0 (length 1).
      const ctx1 = { clock: { beat: 0 }, audio: mockAudio(10.5), nodeState: ctx0.nodeState, broadcast: ctx0.broadcast } as any;
      const inputsNoTrig = { ...inputs, trigger: [] };

      const res1 = oneshot.execute(inputsNoTrig as any, { fields: {} } as any, ctx1 as any); // clear trigger
      expect(res1.fields.midi_out).toHaveLength(0); // Same note held

      // Advance time. 11.0. t=1.0. End.
      const ctx2 = { clock: { beat: 0 }, audio: mockAudio(11.0), nodeState: ctx0.nodeState, broadcast: ctx0.broadcast } as any;
      const res2 = oneshot.execute(inputsNoTrig as any, { fields: {} } as any, ctx2 as any);
      // expect(state.isPlaying).toBe(false); // Cannot access internal state directly via wrapper
      const events2 = res2.fields.midi_out as any[];
      expect(events2).toContainEqual(expect.objectContaining({ fields: expect.objectContaining({ type: 'note_off', note: 60 }) }));
    });
  });

  describe('seq.sequencer', () => {
    it('should output pattern from config', () => {
      // Mock config with a sequence
      const sequence = Array(16).fill(null).map((_, i) => ({
        noteIndex: i % 2 === 0 ? 60 : null,
        velocity: 1,
        hold: false
      }));

      const config = {
        fields: {
          sequence
        }
      };

      const context = { nodeState: new Map() } as any;

      const inputs = { fields: {} };

      const result = sequencer.execute(inputs as any, config as any, context, {});

      const outputs = (result as any).outputs.fields;
      const seqOut = outputs.seq_out as any[];

      expect(seqOut).toBeDefined();
      expect(seqOut.length).toBe(16);
      expect(seqOut[0].fields.noteIndex).toBe(60);
      expect(seqOut[1].fields.noteIndex).toBeNull();
    });
  });

});

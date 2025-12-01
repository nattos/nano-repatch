import { describe, it, expect, vi } from 'vitest';
import {
  rhythmicGeneratorPrimitive,
  chaosGeneratorPrimitive,
  patternPrimitive
} from './nodes';
import { ExecutionContext } from '../../structor/structor';
import { defaultNodeRepository } from '../../structor/repository';

// Mock ExecutionContext
const createMockContext = (): ExecutionContext => ({
  broadcast: vi.fn((config, inputs) => {
    // Simple mock for broadcast
    return {
      apply: (fn: any) => {
        // For generators with no inputs, just call fn with empty args
        if (Object.keys(inputs.fields).length === 0 && inputs.untagged.length === 0) {
          return fn({});
        }
        // For pattern node, it expects 'seqs' from untagged
        if (config.outputs['seqs']) {
          const seqs = inputs.untagged || [];
          // typedBroadcast expects apply to return the data
          // If we are simulating typedBroadcast's usage of broadcast:
          // typedBroadcast calls apply(args => args).
          // So we should return the data structure here.
          return { seqs };
        }
        return fn({});
      }
    } as any;
  }),
  repository: defaultNodeRepository,
  clock: { beat: 0, dt: 0.1 },
  nodeState: new Map(),
  audio: { context: {} as AudioContext } // Mock audio context
});

describe('NicePattern Nodes', () => {
  describe('RhythmicGenerator', () => {
    it('should generate a sequence based on density', () => {
      const context = createMockContext();
      const config = { fields: { targetNote: 60, density: 0.5 }, untagged: [] };
      const input = { fields: {}, untagged: [] };

      const result = rhythmicGeneratorPrimitive.execute(input, config, context);
      const seq = result.fields.seq_out as any[];

      expect(seq).toHaveLength(16);
      // Check if we have some notes
      // seq elements are StructorRecords, so we need to access fields
      const notes = seq.filter(s => s.fields.noteIndex !== null);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].fields.noteIndex).toBe(60);
    });
  });

  describe('ChaosGenerator', () => {
    it('should generate random notes within range', () => {
      const context = createMockContext();
      const config = { fields: { minNote: 60, maxNote: 72, density: 1.0 }, untagged: [] };
      const input = { fields: {}, untagged: [] };

      const result = chaosGeneratorPrimitive.execute(input, config, context);
      const seq = result.fields.seq_out as any[];

      expect(seq).toHaveLength(16);
      seq.forEach(step => {
        if (step.fields.noteIndex !== null) {
          expect(step.fields.noteIndex).toBeGreaterThanOrEqual(60);
          expect(step.fields.noteIndex).toBeLessThanOrEqual(72);
        }
      });
    });
  });

  describe('Pattern Node', () => {
    it('should combine sequences and generate events', () => {
      const context = createMockContext();
      // Mock broadcast to return a sequence
      const mockSeq = Array(16).fill({ noteIndex: null, velocity: 0, hold: false });
      mockSeq[0] = { noteIndex: 60, velocity: 1, hold: false };

      // We need to mock the typedBroadcast behavior which calls context.broadcast
      // The pattern node calls typedBroadcast which calls context.broadcast
      // Our mock context.broadcast needs to return what typedBroadcast expects
      // typedBroadcast expects { seqs: Structor[] } which it then unwraps.

      context.broadcast = vi.fn((config, inputs) => {
        return {
          apply: (fn: any) => {
            // Verify inputs are passed correctly
            const seqs = inputs.untagged || [];
            return { seqs };
          }
        } as any;
      });

      const config = { fields: {}, untagged: [] };
      const input = { fields: {}, untagged: [mockSeq] }; // Raw input

      // First call: initialize state and process step 0
      context.clock.beat = 0;
      const result = patternPrimitive.execute(input, config, context);

      const stream = result.fields.midi_out as any[];
      expect(stream).toBeDefined();
      expect(Array.isArray(stream)).toBe(true);

      const noteOn = stream.find(e => e.fields.type === 'note_on');
      expect(noteOn).toBeDefined();
      expect(noteOn.fields.note).toBe(60);
    });
  });
});

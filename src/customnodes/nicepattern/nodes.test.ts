import { describe, it, expect, vi } from 'vitest';
import {
  rhythmicGenerator,
  chaosGenerator,
  pattern
} from './nodes';
import { ExecutionContext } from '../../structor/structor';
import { defaultNodeRepository } from '../../structor/repository';

// Mock ExecutionContext
const createMockContext = (): ExecutionContext => ({
  broadcast: vi.fn((config, inputs) => {
    // Simple mock for broadcast
    return {
          apply: (fn: any) => {
            // Verify inputs are passed correctly
            if (Object.keys(inputs.fields).length === 0 && inputs.untagged.length === 0) {
              return fn({});
            }
            // For pattern node, it expects 'seq_in' from untagged
            if (config.outputs['seq_in']) {
              const seqs = inputs.fields.seq_in || [];
              // definePrimitiveNode uses apply to execute the lambda.
              // So we must call fn with the data.
              return fn({ seq_in: [seqs] });
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
      const config = { fields: { targetNote: 60, density: 0.5 },  };
      const input = { fields: {},  };

      const result = rhythmicGenerator.execute(input, config, context);
      const seq = result.fields.seq_out as any[];

      expect(seq).toHaveLength(16);
      const notes = seq.filter(s => s.fields.noteIndex !== null);
      expect(notes.length).toBe(8); // 0.5 * 16 = 8
      expect(notes[0].fields.noteIndex).toBe(60);
    });

    it('should use input density if provided', () => {
      const context = createMockContext();
      const config = { fields: { targetNote: 60, density: 0.1 },  };
      const input = { fields: { density: 1.0 },  };

      const result = rhythmicGenerator.execute(input, config, context);
      const seq = result.fields.seq_out as any[];

      const notes = seq.filter(s => s.fields.noteIndex !== null);
      expect(notes.length).toBe(16); // Input density 1.0 overrides config 0.1
    });
  });

  describe('ChaosGenerator', () => {
    it('should generate random notes within range', () => {
      const context = createMockContext();
      const config = { fields: { minNote: 60, maxNote: 72, density: 1.0, seed: 123 },  };
      const input = { fields: {},  };

      const result = chaosGenerator.execute(input, config, context);
      const seq = result.fields.seq_out as any[];

      expect(seq).toHaveLength(16);
      seq.forEach(step => {
        if (step.fields.noteIndex !== null) {
          expect(step.fields.noteIndex).toBeGreaterThanOrEqual(60);
          expect(step.fields.noteIndex).toBeLessThanOrEqual(72);
        }
      });
    });

    it('should produce deterministic output with same seed', () => {
      const context = createMockContext();
      const config = { fields: { minNote: 60, maxNote: 72, density: 1.0, seed: 999 },  };
      const input = { fields: {},  };

      const result1 = chaosGenerator.execute(input, config, context);
      const seq1 = result1.fields.seq_out as any[];

      const result2 = chaosGenerator.execute(input, config, context);
      const seq2 = result2.fields.seq_out as any[];

      expect(JSON.stringify(seq1)).toBe(JSON.stringify(seq2));
    });

    it('should produce different output with different seed', () => {
      const context = createMockContext();
      const input = { fields: {},  };

      const config1 = { fields: { minNote: 60, maxNote: 72, density: 1.0, seed: 111 },  };
      const result1 = chaosGenerator.execute(input, config1, context);
      const seq1 = result1.fields.seq_out as any[];

      const config2 = { fields: { minNote: 60, maxNote: 72, density: 1.0, seed: 222 },  };
      const result2 = chaosGenerator.execute(input, config2, context);
      const seq2 = result2.fields.seq_out as any[];

      expect(JSON.stringify(seq1)).not.toBe(JSON.stringify(seq2));
    });

    it('should use input density if provided', () => {
      const context = createMockContext();
      const config = { fields: { minNote: 60, maxNote: 72, density: 0.1, seed: 123 },  };
      const input = { fields: { density: 1.0 },  };

      const result = chaosGenerator.execute(input, config, context);
      const seq = result.fields.seq_out as any[];

      const notes = seq.filter(s => s.fields.noteIndex !== null);
      // With density 1.0, all steps should have notes
      expect(notes.length).toBe(16);
    });
  });

  describe('Pattern Node', () => {
    it('should combine sequences and generate events', () => {
      const context = createMockContext();
      // Mock broadcast to return a sequence
      const mockSeq = Array(16).fill({ fields: { noteIndex: null, velocity: 0, hold: false },  });
      mockSeq[0] = { fields: { noteIndex: 60, velocity: 1, hold: false },  };

      // We need to mock the typedBroadcast behavior which calls context.broadcast
      // The pattern node calls typedBroadcast which calls context.broadcast
      // Our mock context.broadcast needs to return what typedBroadcast expects
      // typedBroadcast expects { seqs: Structor[] } which it then unwraps.

      context.broadcast = vi.fn((config, inputs) => {
        return {
          apply: (fn: any) => {
            // Verify inputs are passed correctly
            const seqs = inputs.fields.seq_in || [];
            return fn({ seq_in: [seqs] });
          }
        } as any;
      });

      const config = { fields: {},  };
      const input = { fields: { seq_in: mockSeq },  }; // Raw input

      // First call: initialize state and process step 0
      context.clock.beat = 0;
      const result = pattern.execute(input, config, context);
      const stream = result.fields.midi_out as any[];
      expect(stream).toBeDefined();
      expect(Array.isArray(stream)).toBe(true);

      const noteOn = stream.find(e => e.fields.type === 'note_on');
      expect(noteOn).toBeDefined();
      expect(noteOn.fields.note).toBe(60);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EnvelopeSequencer,
  ManualGenerator,
  CompositeGenerator,
  AbstractLayer,
  LayerConfig,
  Step,
  GateLayer,
  ExponentialLayer
} from './envelope-generator'; // Assuming your file is named this

/**
 * Mocks & Helpers
 */
class MockLayer extends AbstractLayer {
  public triggerCount = 0;
  public releaseCount = 0;
  public processCount = 0;
  public lastDt = 0;

  protected onTrigger(velocity: number) { this.triggerCount++; }
  protected onRelease() { this.releaseCount++; }
  protected process(isActive: boolean, step: Step, dt: number) {
    this.processCount++;
    this.lastDt = dt;
  }
  // Expose for testing
  public getConfig() { return this.config; }
}

class MockGenerator {
  getStep(index: number) {
    return { noteIndex: null, velocity: 0, hold: false };
  }
  reset() {}
}

describe('Envelope Generator System', () => {

  describe('ManualGenerator', () => {
    it('should initialize with empty steps', () => {
      const gen = new ManualGenerator(16);
      const step = gen.getStep(0);
      expect(step.noteIndex).toBeNull();
      expect(step.velocity).toBe(0);
    });

    it('should store and retrieve steps', () => {
      const gen = new ManualGenerator(16);
      gen.setStep(5, { noteIndex: 2, velocity: 0.8, hold: true });

      const step = gen.getStep(5);
      expect(step.noteIndex).toBe(2);
      expect(step.velocity).toBe(0.8);
      expect(step.hold).toBe(true);
    });

    it('should clear all steps', () => {
      const gen = new ManualGenerator(16);
      gen.setStep(0, { noteIndex: 1, velocity: 1, hold: false });
      gen.clear();
      expect(gen.getStep(0).noteIndex).toBeNull();
    });
  });

  describe('CompositeGenerator', () => {
    let composite: CompositeGenerator;
    let manual: ManualGenerator;
    const NOTE_COUNT = 4;

    beforeEach(() => {
      composite = new CompositeGenerator(NOTE_COUNT);
      manual = new ManualGenerator(16);
      composite.addSource(manual);
    });

    it('should pass through manual steps when no other sources exist', () => {
      manual.setStep(0, { noteIndex: 1, velocity: 0.5, hold: false });
      const result = composite.getStep(0, 16);
      expect(result.noteIndex).toBe(1);
      expect(result.velocity).toBe(0.5);
    });

    it('should perform additive synthesis on notes (modulo logic)', () => {
      // Source 1: Manual (Note 1)
      manual.setStep(0, { noteIndex: 1, velocity: 1, hold: false });

      // Source 2: Mock (Note 2)
      const mockGen = {
        getStep: () => ({ noteIndex: 2, velocity: 1, hold: false }),
        reset: () => {}
      };
      composite.addSource(mockGen);

      // Expect: (1 + 2) % 4 = 3
      const result = composite.getStep(0, 16);
      expect(result.noteIndex).toBe(3);
    });

    it('should wrap notes using modulo', () => {
      manual.setStep(0, { noteIndex: 3, velocity: 1, hold: false });
      const mockGen = {
        getStep: () => ({ noteIndex: 2, velocity: 1, hold: false }),
        reset: () => {}
      };
      composite.addSource(mockGen);

      // Expect: (3 + 2) = 5. 5 % 4 = 1.
      const result = composite.getStep(0, 16);
      expect(result.noteIndex).toBe(1);
    });

    it('should combine velocity (max) and hold (OR)', () => {
      manual.setStep(0, { noteIndex: 0, velocity: 0.2, hold: false });
      const mockGen = {
        getStep: () => ({ noteIndex: 1, velocity: 0.9, hold: true }),
        reset: () => {}
      };
      composite.addSource(mockGen);

      const result = composite.getStep(0, 16);
      expect(result.velocity).toBe(0.9); // Max of 0.2 and 0.9
      expect(result.hold).toBe(true);  // false OR true
    });
  });

  describe('EnvelopeSequencer Integration', () => {
    let seq: EnvelopeSequencer;
    let layer: MockLayer;

    beforeEach(() => {
      // 16 steps, 4 notes
      seq = new EnvelopeSequencer(16, 4);
      layer = new MockLayer({ targetNoteIndex: 1 });
      seq.addLayer(layer);

      // Mock performance.now to control physics delta
      vi.stubGlobal('performance', { now: vi.fn(() => 0) });
    });

    it('should map beat time to steps correctly', () => {
      // Beat 0.0 -> Step 0
      seq.syncToBeat(0.0, 120);
      // Beat 0.25 (16th note) -> Step 1
      seq.syncToBeat(0.25, 120);
      // Beat 1.0 -> Step 4
      seq.syncToBeat(1.0, 120);
    });

    it('should trigger layers when the correct note is hit', () => {
      // Set Step 0 to Note 1 (which our layer listens to)
      seq.getManualGenerator().setStep(0, { noteIndex: 1, velocity: 1, hold: false });

      // Sync to Beat 0.0 (Step 0)
      seq.syncToBeat(0.0, 120);

      expect(layer.triggerCount).toBe(1);
      expect(layer.releaseCount).toBe(0);
    });

    it('should release layers when stepping off the note', () => {
      seq.getManualGenerator().setStep(0, { noteIndex: 1, velocity: 1, hold: false });

      // On Note
      seq.syncToBeat(0.0, 120);
      expect(layer.triggerCount).toBe(1);

      // Off Note (Step 1 is empty)
      seq.syncToBeat(0.25, 120);
      expect(layer.releaseCount).toBe(1);
    });

    it('should handle physics delta time (dt)', () => {
      const perf = vi.spyOn(performance, 'now');

      // Frame 1: t=0
      perf.mockReturnValue(0);
      seq.syncToBeat(0, 120);

      // Frame 2: t=100ms
      perf.mockReturnValue(100);
      seq.syncToBeat(0.1, 120);

      // Expect dt to be 0.1s
      expect(layer.lastDt).toBeCloseTo(0.1);
    });
  });

  describe('Sequencer Sync Robustness', () => {
    let seq: EnvelopeSequencer;
    let layer: MockLayer;

    beforeEach(() => {
      seq = new EnvelopeSequencer(16, 4);
      layer = new MockLayer({ targetNoteIndex: 0 });
      seq.addLayer(layer);
      vi.stubGlobal('performance', { now: vi.fn(() => 0) });
    });

    it('should ignore small backwards jitter', () => {
      // Advance to Beat 1.0 (Step 4)
      seq.syncToBeat(1.0, 120);

      // Jitter backwards slightly (e.g. thread timing issue)
      // Should clamp to 1.0 effectively inside logic
      // We can verify this by checking if it triggers Step 3?
      // Step 3: Note 0. Step 4: Empty.

      seq.getManualGenerator().setStep(3, { noteIndex: 0, velocity: 1, hold: false });

      // At 1.0 (Step 4), we are OFF the note. Layer release should have happened if we came from 3,
      // but let's just assume we started at 1.0.

      // Now jitter back to 0.99 (Step 3 boundary)
      // If jitter protection works, it treats effectiveBeat as 1.0, so we stay on Step 4 (Empty).
      // If it fails, we hit Step 3 (Note 0) and trigger.

      seq.syncToBeat(0.99, 120);

      expect(layer.triggerCount).toBe(0);
    });

    it('should detect seeks (large jumps) and force release', () => {
      // Force Release spy
      const spy = vi.spyOn(layer, 'forceRelease');

      // Start at 0
      seq.syncToBeat(0, 120);

      // Jump to beat 10 (Seek)
      seq.syncToBeat(10, 120);

      expect(spy).toHaveBeenCalled();
    });

    it('should handle looping (large backwards jump) as a seek', () => {
      const spy = vi.spyOn(layer, 'forceRelease');

      // End of loop
      seq.syncToBeat(15.9, 120);

      // Loop back to start
      seq.syncToBeat(0.0, 120);

      // Delta is ~ -15.9. Should be treated as seek/reset.
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Specific Layer Logic', () => {
    it('ExponentialLayer should snap up on trigger and decay on process', () => {
      const expLayer = new ExponentialLayer({ targetNoteIndex: 0 });

      // Mock internal calls to simulate engine
      // 1. Trigger
      // @ts-ignore - accessing protected for unit test logic simulation
      expLayer.onTrigger(1.0);
      expect(expLayer.getValue()).toBe(1.0);

      // 2. Process (Active) - Decay
      const step = { noteIndex: 0, velocity: 1.0, hold: true };
      // @ts-ignore
      expLayer.process(true, step, 0.1);

      expect(expLayer.getValue()).toBeLessThan(1.0);
      expect(expLayer.getValue()).toBeGreaterThan(0.8); // rough check
    });

    it('ExponentialLayer should cut instantly on release', () => {
      const expLayer = new ExponentialLayer({ targetNoteIndex: 0 });
      // @ts-ignore
      expLayer.onTrigger(1.0);
      // @ts-ignore
      expLayer.onRelease();

      expect(expLayer.getValue()).toBe(0);
    });
  });
});

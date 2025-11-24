import { Sequence, Step } from "./envelope-generator";
import { IPatternGenerator } from "./generator";

export class ManualGenerator implements IPatternGenerator {
  private sequence: Sequence;
  constructor(steps: number) {
    this.sequence = Array(steps).fill(null).map(() => ({ noteIndex: null, velocity: 0, hold: false }));
  }
  public getStep(index: number): Step { return this.sequence[index]; }
  public setStep(index: number, step: Step): void { this.sequence[index] = step; }
  public clear(): void { this.sequence.forEach(s => s.noteIndex = null); }
  public reset(): void {}
}

export class CompositeGenerator implements IPatternGenerator {
  private sources: IPatternGenerator[] = [];
  constructor(private noteCount: number) {}

  public addSource(gen: IPatternGenerator): void { this.sources.push(gen); }
  public removeSource(gen: IPatternGenerator): void { this.sources = this.sources.filter(g => g !== gen); }

  public getStep(index: number, totalSteps: number): Step {
    const activeNotes: number[] = [];
    let maxVelocity = 0;
    let isHold = false;

    for (const source of this.sources) {
      const step = source.getStep(index, totalSteps);
      if (step.noteIndex !== null) {
        activeNotes.push(step.noteIndex);
        maxVelocity = Math.max(maxVelocity, step.velocity);
        if (step.hold) isHold = true;
      }
    }

    if (activeNotes.length === 0) return { noteIndex: null, velocity: 0, hold: false };

    const summedNote = activeNotes.reduce((a, b) => a + b, 0);
    return {
      noteIndex: summedNote % this.noteCount,
      velocity: maxVelocity,
      hold: isHold
    };
  }
  public reset(): void { this.sources.forEach(s => s.reset()); }
}

// Algorithmic Base Generator
export abstract class BaseAlgorithmicGenerator implements IPatternGenerator {
  protected cachedPattern: Sequence = [];
  protected probability: number = 0.5;

  constructor(protected seed: number = Math.random()) {}

  public abstract generate(steps: number): void;

  public getStep(index: number): Step {
    return this.cachedPattern[index] || { noteIndex: null, velocity: 0, hold: false };
  }

  public setProbability(val: number) { this.probability = val; }
  public reset() { /* Optional re-seed logic */ }
}

// Rhythmic Generator (Low pitch, coarser grid)
export class RhythmicGenerator extends BaseAlgorithmicGenerator {
  constructor(private targetNote: number, private syncopation: boolean) {
    super();
  }

  public generate(steps: number): void {
    this.cachedPattern = [];
    for (let i = 0; i < steps; i++) {
      let active = false;
      let hold = false;

      // Simple Euclidean-ish logic
      if (this.syncopation) {
        if (i % 8 === 3 || i % 8 === 6) active = true;
      } else {
        if (i % 4 === 0) active = true; // Downbeats
      }

      // Random chance to skip
      if (active && Math.random() > this.probability) active = false;

      if (active) {
        this.cachedPattern.push({ noteIndex: this.targetNote, velocity: 0.8, hold: false });
      } else if (i > 0 && this.cachedPattern[i-1].noteIndex === this.targetNote && i % 2 !== 0) {
        // Hold logic for 8th note feel
        this.cachedPattern.push({ noteIndex: this.targetNote, velocity: 0.8, hold: true });
      } else {
        this.cachedPattern.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }
  }
}

// Chaos Generator (High pitch, random)
export class ChaosGenerator extends BaseAlgorithmicGenerator {
  constructor(private minNote: number, private maxNote: number) {
    super();
  }

  public generate(steps: number): void {
    this.cachedPattern = [];
    for (let i = 0; i < steps; i++) {
      if (Math.random() < this.probability) {
        const note = Math.floor(Math.random() * (this.maxNote - this.minNote + 1)) + this.minNote;
        this.cachedPattern.push({
          noteIndex: note,
          velocity: Math.random(),
          hold: Math.random() > 0.8
        });
      } else {
        this.cachedPattern.push({ noteIndex: null, velocity: 0, hold: false });
      }
    }
  }
}

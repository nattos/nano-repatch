/**
 * ENV-SEQ CORE TYPES
 */

export interface Step {
  noteIndex: number | null;
  velocity: number;
  hold: boolean;
}

export type Sequence = Step[];

/**
 * --------------------------------------------------------------------------
 * GENERATORS (Unchanged)
 * --------------------------------------------------------------------------
 */
export interface IPatternGenerator {
  getStep(stepIndex: number, totalSteps: number): Step;
  reset(): void;
}

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

/**
 * --------------------------------------------------------------------------
 * LAYERS (Updated for Force Release)
 * --------------------------------------------------------------------------
 */

export interface LayerConfig {
  targetNoteIndex: number;
}

export abstract class AbstractLayer {
  protected output: number = 0;
  protected lastActive: boolean = false;

  constructor(protected config: LayerConfig) {}

  public update(step: Step, dt: number): void {
    const isActive = (step.noteIndex === this.config.targetNoteIndex);

    if (isActive && !this.lastActive) {
      this.onTrigger(step.velocity);
    } else if (!isActive && this.lastActive) {
      this.onRelease();
    }

    this.process(isActive, step, dt);
    this.lastActive = isActive;
  }

  // New: Called when the timeline jumps significantly (seek/loop)
  public forceRelease(): void {
    this.onRelease();
    this.lastActive = false;
    // Optionally reset internal LFO phases or envelopes instantly
    this.output = 0;
  }

  public getValue(): number { return this.output; }

  protected abstract onTrigger(velocity: number): void;
  protected abstract onRelease(): void;
  protected abstract process(isActive: boolean, step: Step, dt: number): void;
}


export class GateLayer extends AbstractLayer {
    protected onTrigger(vel: number) { this.output = vel; }
    protected onRelease() { this.output = 0; }
    protected process(isActive: boolean) {
        // Hard gate, output stays high if active
        if (isActive && this.output === 0) this.output = 1.0;
    }
}

export class ExponentialLayer extends AbstractLayer {
    private decayRate: number = 0.96;

    constructor(config: LayerConfig, decay: number = 0.96) {
        super(config);
        this.decayRate = decay;
    }

    protected onTrigger(vel: number) {
        // Snap up
        this.output = vel;
    }
    protected onRelease() {
        // Instant cut per requirements
        this.output = 0;
    }
    protected process(isActive: boolean, step: Step) {
        if (isActive) {
            // Decay while holding
            this.output *= this.decayRate;
            // Sustain floor logic could go here
        }
    }
}

export class PWMLayer extends AbstractLayer {
    private phase: number = 0;
    private duty: number = 0.5;
    private freq: number = 0.2;

    protected onTrigger() {
        this.duty = 0.5; // Reset duty
    }
    protected onRelease() {
        // Natural decay for this layer per prototype
    }
    protected process(isActive: boolean, step: Step, dt: number) {
        // Always decay value for this specific layer type
        if (!isActive) {
             this.output *= 0.85;
             return;
        }

        // Logic
        this.duty *= 0.98;
        this.phase += this.freq;
        if (this.phase > 1.0) this.phase -= 1.0;

        this.output = (this.phase < this.duty) ? 1.0 : 0.0;
    }
}

export class NoiseLayer extends AbstractLayer {
    protected onTrigger() {}
    protected onRelease() { this.output *= 0.85; }
    protected process(isActive: boolean) {
        if (isActive) {
            this.output = Math.random();
        } else {
            this.output *= 0.85;
        }
    }
}

/**
 * --------------------------------------------------------------------------
 * ENGINE (Updated for External Sync)
 * --------------------------------------------------------------------------
 */

export class EnvelopeSequencer {
  public steps: number = 16;
  public noteCount: number = 4;

  // Internal state
  private layers: AbstractLayer[] = [];
  private generator: CompositeGenerator;
  private manualGenerator: ManualGenerator;

  // Clocking State
  private lastWallTime: number = 0;
  private lastProcessedBeat: number = -1;
  private lastStepIndex: number = -1;

  // Constants for Sync logic
  private readonly JITTER_THRESHOLD = 0.05; // Beats
  private readonly SEEK_THRESHOLD = 1.0;  // Beats

  constructor(steps: number = 16, noteCount: number = 4) {
    this.steps = steps;
    this.noteCount = noteCount;
    this.generator = new CompositeGenerator(noteCount);
    this.manualGenerator = new ManualGenerator(steps);
    this.generator.addSource(this.manualGenerator);
    this.lastWallTime = performance.now();
  }

  public addLayer(layer: AbstractLayer) { this.layers.push(layer); }
  public getManualGenerator() { return this.manualGenerator; }
  public getCompositeGenerator() { return this.generator; }
  public getLayerValue(index: number) { return this.layers[index] ? this.layers[index].getValue() : 0; }

  /**
   * Driver Method: SYNC TO BEAT (Ableton Link Style)
   * @param beat The current absolute beat time (e.g. 124.50)
   * @param bpm The current BPM
   */
  public syncToBeat(beat: number, bpm: number) {
    const now = performance.now();
    // Calculate physics delta (Wall Clock)
    // This ensures envelopes decay even if 'beat' stops moving (paused transport)
    const dt = (now - this.lastWallTime) / 1000;
    this.lastWallTime = now;

    // 1. Calculate Delta and Directions
    const beatDelta = beat - this.lastProcessedBeat;
    let effectiveBeat = beat;

    // 2. Handle Large Jumps (Seek or Loop Loop)
    // If we jumped more than 1 beat (forward or back), or wrapped around 0
    // We consider this a "Seek".
    const isSeek = Math.abs(beatDelta) > this.SEEK_THRESHOLD;

    if (isSeek) {
      // Hard reset layers to prevent hanging notes
      this.layers.forEach(l => l.forceRelease());
      this.lastStepIndex = -1; // Force re-evaluation of step
    }
    else if (beatDelta < 0) {
      // 3. Handle Backwards Jitter (e.g., 4.01 -> 3.99)
      // If the backwards drift is small, we ignore the timeline change
      // to prevent re-triggering the previous step.
      if (Math.abs(beatDelta) < this.JITTER_THRESHOLD) {
        effectiveBeat = this.lastProcessedBeat; // Clamp to max
      }
      // If it's a legitimate backwards scrub (handled by !isSeek but < 0),
      // we let effectiveBeat update, but standard logic applies.
    }

    // 4. Calculate Step Index
    // 16th notes = 4 steps per beat
    const stepsPerBeat = 4;

    // Use effectiveBeat to determine grid position
    const absoluteStep = Math.floor(effectiveBeat * stepsPerBeat);

    // Modulo for looping patterns (e.g., 0-15)
    const currentStepIndex = ((absoluteStep % this.steps) + this.steps) % this.steps;

    // 5. Generator Update
    const currentStepData = this.generator.getStep(currentStepIndex, this.steps);

    // 6. Layer Processing
    // We pass the wall-clock 'dt' for physics.
    // We pass the step data derived from 'effectiveBeat'
    for (const layer of this.layers) {
      layer.update(currentStepData, dt);
    }

    this.lastProcessedBeat = effectiveBeat;
    this.lastStepIndex = currentStepIndex;
  }

  /**
   * Fallback: Internal Clock Tick
   * (Retained for simple use cases without external transport)
   */
  private accumulatedTime: number = 0;
  private internalBeat: number = 0;

  public tick(dt: number, bpm: number) {
    // Convert internal timer to a "beat" value and feed it to syncToBeat
    const secondsPerBeat = 60 / bpm;
    const beatDelta = dt / secondsPerBeat;

    this.internalBeat += beatDelta;

    this.syncToBeat(this.internalBeat, bpm);
  }
}
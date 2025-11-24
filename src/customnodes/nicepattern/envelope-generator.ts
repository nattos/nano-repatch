/**
 * ENV-SEQ CORE TYPES
 */

import { AbstractLayer } from "./abstract-layer";
import { CompositeGenerator, ManualGenerator } from "./generators";

export interface Step {
  noteIndex: number | null;
  velocity: number;
  hold: boolean;
}

export type Sequence = Step[];

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

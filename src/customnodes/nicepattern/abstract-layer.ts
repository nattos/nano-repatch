import { Step, Sequence } from "./envelope-generator";

export interface LayerConfig {
  targetNoteIndex?: number;
}

export abstract class AbstractLayer {
  protected output: number = 0;
  protected lastActive: boolean = false;

  constructor(protected config: LayerConfig) { }

  public update(step: Step, dt: number, isNewStep: boolean): void {
    const isEvent = step.noteIndex !== null && step.noteIndex !== undefined;
    let isActive = isEvent;

    if (isActive) {
      let isReleased = false;
      if (this.lastActive) {
        // Only retrigger if it's a new step and hold is false
        if (isNewStep && !step.hold) {
          this.onRelease();
          isReleased = true;
        }
      } else {
        isReleased = true;
      }
      if (isReleased) {
        // Trigger on any note. Pass noteIndex for pitch-aware layers.
        this.onTrigger(step.velocity, step.noteIndex);
      }
    } else {
      // Empty step - release if active
      if (this.lastActive) {
        this.onRelease();
      }
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

  public abstract previewSequence(sequence: Sequence, prevLayerOutput: number[]): number[];

  protected abstract onTrigger(velocity: number, noteIndex?: number | null): void;
  protected abstract onRelease(): void;
  protected abstract process(isActive: boolean, step: Step, dt: number): void;
}


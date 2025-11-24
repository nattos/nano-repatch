import { Step, Sequence } from "./envelope-generator";

export interface LayerConfig {
  targetNoteIndex?: number;
}

export abstract class AbstractLayer {
  protected output: number = 0;
  protected lastActive: boolean = false;

  constructor(protected config: LayerConfig) {}

  public update(step: Step, dt: number): void {
    let isActive = this.lastActive;
    const isEvent = step.noteIndex !== null;
    const isAnyNote = this.config.targetNoteIndex === undefined;

    if (isEvent) {
      const isActiveFromEvent = isAnyNote || (step.noteIndex === this.config.targetNoteIndex);
      if (isActiveFromEvent) {
        let isReleased = false;
        if (this.lastActive) {
          if (!step.hold) {
            this.onRelease();
            isReleased = true;
          }
        } else {
          isReleased = true;
        }
        if (isReleased) {
          this.onTrigger(step.velocity);
        }
      } else if (!isActiveFromEvent && this.lastActive) {
        this.onRelease();
      }
      isActive = isActiveFromEvent;
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

  protected abstract onTrigger(velocity: number): void;
  protected abstract onRelease(): void;
  protected abstract process(isActive: boolean, step: Step, dt: number): void;
}


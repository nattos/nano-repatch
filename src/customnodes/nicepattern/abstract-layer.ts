import { Step } from "./envelope-generator";

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


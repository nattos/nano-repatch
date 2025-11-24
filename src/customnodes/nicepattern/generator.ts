import { Step } from "./envelope-generator";

export interface IPatternGenerator {
  getStep(stepIndex: number, totalSteps: number): Step;
  reset(): void;
}

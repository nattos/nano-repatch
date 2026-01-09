import { PhaseSample, BarPhaseSample } from "./schema";

export function predictPhase(sample: PhaseSample, currentTime: number): number {
  const timeSinceUpdate = currentTime - sample.lastUpdateTime;
  const ibi = 60.0 / sample.bpm;
  const phaseAdvance = (timeSinceUpdate / ibi) * 2 * Math.PI;
  let predictedPhase = sample.phase + phaseAdvance;
  return Math.atan2(Math.sin(predictedPhase), Math.cos(predictedPhase));
}

export function predictBarPhase(sample: BarPhaseSample, currentTime: number): number {
  const timeSinceUpdate = currentTime - sample.lastUpdateTime;
  const ibi = 60.0 / sample.bpm;
  const beatsAdvanced = timeSinceUpdate / ibi;
  return sample.barPhase + beatsAdvanced;
}

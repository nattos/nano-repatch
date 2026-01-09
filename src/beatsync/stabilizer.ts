import { predictBarPhase, predictPhase } from "./extrapolation";
import { StabilizerDebugData, StabilizerConfig, StabilizerTrajectory } from "./schema";

export interface StabilizerConfigInternal extends StabilizerConfig {
  onTrajectoryUpdated?: (bestTrajectory: StabilizerTrajectory) => void;
  onDebugDataUpdated?: (debugData: StabilizerDebugData) => void;
}

export class Stabilizer {
  private debugData: StabilizerDebugData = {
    trajectories: [],
    bestTrajectory: null,
    overallConfidence: 0.0,
  };

  private trajectories: TrajectoryState[] = [];
  private bestTrajectory: TrajectoryState | null = null;
  private readonly bpmHistory: number[] = [];
  private readonly historySize = 8;
  private overallConfidence: number = 0;

  private readonly config: StabilizerConfigInternal;

  constructor(config?: Partial<StabilizerConfigInternal>) {
    this.config = {
      proximityThreshold: Math.PI / 5, // Radians
      maxWeight: 20.0,
      initialWeight: 1.0,
      weightIncrement: 3.0,
      decayFactor: 0.4,
      pruneThreshold: 0.1,
      bestTrajectoryBias: 15.0,
      bpmWeightScale: 100.0,
      bpmWeightBias: -0.2,
      bpmVariancePenalty: 45.0,
      shiftWeight: 0.5,
      shiftWeightBias: 1.5,
      overcorrectionWeightThreshold: 10.0,
      overcorrectionBpmThreshold: 0.3,
      overcorrectionPhaseThreshold: Math.PI / 16,
      bpmOvercorrectionFactor: 0.3,
      phaseOvercorrectionFactor: 0.3,
      deltaHistorySize: 10,
      exportDebugData: false,
      ...config,
    };
  }

  addPrediction(phase: number, magnitude: number, bpm: number, currentTime: number) {
    this.bpmHistory.push(bpm);
    if (this.bpmHistory.length > this.historySize) {
      this.bpmHistory.shift();
    }

    const bpmVariance = this.calculateVariance(this.bpmHistory);
    this.overallConfidence = Math.min(1.0, Math.max(0.0, this.config.bpmWeightScale / (1.0 + this.config.bpmVariancePenalty * bpmVariance) + this.config.bpmWeightBias));
    const modulatedWeightIncrement = this.config.weightIncrement * this.overallConfidence;

    let foundMatch = false;
    const bestBarPhase = this.bestTrajectory?.predictBarPhase(currentTime) ?? 0.0;
    for (const trajectory of this.trajectories) {
      const predictedPhase = trajectory.predictPhase(currentTime);
      const phaseDifference = Math.abs(predictedPhase - phase);

      if (phaseDifference < this.config.proximityThreshold) {
        trajectory.update(phase, bestBarPhase, magnitude, bpm, modulatedWeightIncrement, currentTime, this.config.shiftWeight, this.config);
        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      console.log(`spawning trajectory (${this.trajectories.length} + 1)`);
      const averageBpm = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
      const newTrajectory = new TrajectoryState(phase, bestBarPhase, magnitude, averageBpm, this.config.initialWeight * this.overallConfidence, currentTime);
      this.trajectories.push(newTrajectory);
    }

    this.decayAndPrune(currentTime);
    this.findBestTrajectory(currentTime);
    for (const trajectory of this.trajectories) {
      // TODO: Rework! This is only used to step forward lastUpdateTime. The nudging has zero weight.
      trajectory.update(phase, bestBarPhase, magnitude, bpm, 0.0, currentTime, 0.0, this.config);
    }

    if (this.config.exportDebugData) {
      // Export a _copy_ of the data.
      this.debugData = {
        trajectories: this.trajectories.map(t => t.toDebugData()),
        bestTrajectory: this.bestTrajectory?.toDebugData() ?? null,
        overallConfidence: this.overallConfidence,
      };
      this.config.onDebugDataUpdated?.(this.debugData);
    }
    if (this.bestTrajectory) {
      this.config.onTrajectoryUpdated?.(this.bestTrajectory.toDebugData());
    }
  }

  private calculateVariance(data: number[]): number {
    if (data.length < 2) {
      return 0;
    }
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / data.length;
    return variance;
  }

  private decayAndPrune(currentTime: number) {
    this.trajectories.forEach(t => t.decay(this.config.decayFactor, currentTime));
    this.trajectories = this.trajectories.filter(t => t.weight > this.config.pruneThreshold || (this.bestTrajectory && t.id === this.bestTrajectory.id));
  }

  private findBestTrajectory(currentTime: number) {
    if (this.trajectories.length === 0) {
      this.bestTrajectory = null;
      return;
    }

    let bestWeight = -1;
    let currentBest: TrajectoryState | null = null;

    for (const trajectory of this.trajectories) {
      let effectiveWeight = trajectory.weight;
      if (this.bestTrajectory && trajectory.id === this.bestTrajectory.id) {
        effectiveWeight += this.config.bestTrajectoryBias;
      }

      if (effectiveWeight > bestWeight) {
        bestWeight = effectiveWeight;
        currentBest = trajectory;
      }
    }
    if (this.bestTrajectory !== currentBest) {
      console.log('switching trajectories', 'this.bestTrajectory.weight', this.bestTrajectory?.weight, 'currentBest.weight', currentBest?.weight);
    }
    this.bestTrajectory = currentBest;
  }
}

class TrajectoryState {
  private static nextId = 0;
  id: number;

  phase: number;
  barPhase: number;
  magnitude: number;
  bpm: number;
  weight: number;
  lastUpdateTime: number;
  private bpmDeltaHistory: number[] = [];
  private phaseDeltaHistory: number[] = [];

  constructor(phase: number, barPhase: number, magnitude: number, bpm: number, initialWeight: number, currentTime: number) {
    this.id = TrajectoryState.nextId++;
    this.phase = phase;
    this.barPhase = barPhase;
    this.magnitude = magnitude;
    this.bpm = bpm;
    this.weight = initialWeight;
    this.lastUpdateTime = currentTime;
  }

  predictPhase(currentTime: number): number {
    return predictPhase(this, currentTime);
  }

  predictBarPhase(currentTime: number): number {
    return predictBarPhase(this, currentTime);
  }

  update(phase: number, barPhase: number, magnitude: number, bpm: number, weightIncrement: number, currentTime: number, shiftWeight: number, config: StabilizerConfig) {
    // If the weight is dropping, don't apply shifts.
    const shiftWeightIncrement = Math.max(0, weightIncrement);
    const bpmPhaseWeightIncrement = shiftWeightIncrement * shiftWeight;
    const biasedWeight = this.weight + config.shiftWeightBias;

    const oldPhase = this.predictPhase(currentTime);
    const oldBpm = this.bpm;

    // --- Phase Update ---
    const phaseDiff = Math.atan2(Math.sin(phase - oldPhase), Math.cos(phase - oldPhase));
    const avgPhaseDelta = this.phaseDeltaHistory.reduce((a, b) => a + b, 0) / (this.phaseDeltaHistory.length || 1);
    const isPhaseDirectionConsistent = this.phaseDeltaHistory.length === 0 || Math.sign(phaseDiff) === Math.sign(avgPhaseDelta);

    const shouldOvercorrectPhase = this.weight > config.overcorrectionWeightThreshold &&
                                   Math.abs(oldBpm - bpm) < config.overcorrectionBpmThreshold &&
                                   Math.abs(phaseDiff) < config.overcorrectionPhaseThreshold &&
                                   isPhaseDirectionConsistent;

    let targetPhase = phase;
    if (shouldOvercorrectPhase) {
      targetPhase = phase + phaseDiff * config.phaseOvercorrectionFactor;
    }

    const avgSinPhase = Math.sin(oldPhase) * biasedWeight + Math.sin(targetPhase) * bpmPhaseWeightIncrement;
    const avgCosPhase = Math.cos(oldPhase) * biasedWeight + Math.cos(targetPhase) * bpmPhaseWeightIncrement;
    let newPhase = Math.atan2(avgSinPhase, avgCosPhase);
    newPhase = wrap(newPhase, Math.PI * 2.0);
    this.phase = newPhase;

    const appliedPhaseDelta = wrapSigned(newPhase - oldPhase, Math.PI);
    this.phaseDeltaHistory.push(appliedPhaseDelta);
    if (this.phaseDeltaHistory.length > config.deltaHistorySize) {
      this.phaseDeltaHistory.shift();
    }

    // --- Bar Phase Update ---
    const phaseDelta01 = appliedPhaseDelta / (Math.PI * 2.0)
    const oldBarPhase = this.predictBarPhase(currentTime);
    let newBarPhase = oldBarPhase + phaseDelta01;
    let newBarBeat = Math.round(newBarPhase - (newPhase / (Math.PI * 2.0)));
    newBarPhase = newBarBeat + (newPhase / (Math.PI * 2.0));
    newBarPhase = (newBarPhase % 4.0 + 4.0) % 4.0;
    this.barPhase = newBarPhase;

    // --- BPM Update ---
    const bpmDiff = bpm - oldBpm;
    const avgBpmDelta = this.bpmDeltaHistory.reduce((a, b) => a + b, 0) / (this.bpmDeltaHistory.length || 1);
    const isBpmDirectionConsistent = this.bpmDeltaHistory.length === 0 || Math.sign(bpmDiff) === Math.sign(avgBpmDelta);

    const shouldOvercorrectBpm = this.weight > config.overcorrectionWeightThreshold &&
                                 Math.abs(bpmDiff) < config.overcorrectionBpmThreshold &&
                                 isBpmDirectionConsistent;

    let targetBpm = bpm;
    if (shouldOvercorrectBpm) {
      targetBpm = bpm + bpmDiff * config.bpmOvercorrectionFactor;
    }

    if (biasedWeight + bpmPhaseWeightIncrement > 0) {
      const newBpm = (oldBpm * biasedWeight + targetBpm * bpmPhaseWeightIncrement) / (biasedWeight + bpmPhaseWeightIncrement);
      const appliedBpmDelta = newBpm - oldBpm;
      this.bpmDeltaHistory.push(appliedBpmDelta);
      if (this.bpmDeltaHistory.length > config.deltaHistorySize) {
        this.bpmDeltaHistory.shift();
      }
      this.bpm = newBpm;
    }

    // --- Magnitude and Weight update ---
    const newWeight = this.weight + weightIncrement;
    if (newWeight > 0) {
      this.magnitude = (this.magnitude * this.weight + magnitude * weightIncrement) / newWeight;
    }
    this.weight = Math.min(config.maxWeight, newWeight);
    this.lastUpdateTime = currentTime;
  }

  resetBarPhase() {
    this.barPhase -= Math.round(this.barPhase);
    this.barPhase = (this.barPhase % 4.0 + 4.0) % 4.0;
  }

  decay(decayFactor: number, currentTime: number) {
    const timeSinceUpdate = currentTime - this.lastUpdateTime;
    // More aggressive decay for trajectories that haven't been updated recently
    this.weight *= Math.pow(decayFactor, timeSinceUpdate);
  }

  toDebugData(): StabilizerTrajectory {
    return {
      id: this.id,
      phase: this.phase,
      barPhase: this.barPhase,
      magnitude: this.magnitude,
      bpm: this.bpm,
      weight: this.weight,
      lastUpdateTime: this.lastUpdateTime,
    };
  }
}

function wrap01(x: number) {
  return x - Math.floor(x);
}

function wrap(x: number, mod: number) {
  x /= mod;
  x = wrap01(x);
  return x * mod;
}

function wrapSigned(x: number, range: number) {
  x += range;
  x = wrap(x, range * 2.0);
  return x - range;
}

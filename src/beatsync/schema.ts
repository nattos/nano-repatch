export interface AudioToClockConfig {
  // General config.
  exportAllDebugData?: boolean,
  inferenceConfig: Partial<InferenceManagerConfig>;
  stabilizerConfig: Partial<StabilizerConfig>;
  externalClockControllerConfig: Partial<ExternalClockControllerConfig>;

  // Hooks to call model.
  runFeatureExtractor: RunFeatureExtractor;
  runBpmPhasePredictor: RunBpmPhasePredictor;

  // Result callbacks.

  /**
   * Model load and status events.
   */
  onStatusUpdated?: (status: {
    message: string;
    isError: boolean;
  }) => void;

  /**
   * Requests for the external clock to be adjusted.
   */
  onExternalClockAdjusted?: (changes: {
    bpm?: number;
    phase?: number;
    timestamp: number;
  }) => void;

  /**
   * Updates for any requested debug data.
   */
  onDebugDataExported?: (updates: DebugUpdates) => void;
}

export interface DebugUpdates {
  inference?: InferenceManagerDebugData;
  stabilizer?: StabilizerDebugData;
  externalClock?: ExternalClockDebugData;
  externalClockEvent?: ExternalClockAdjustEvent;
}

export interface IAudioToClock {
  addAudio(audioSamples: Float32Array[], currentTime: number, inputSampleRate: number): void;
  resync(hard?: boolean): void;
  resetHardSync(): void;
  setForceExportAllDebugData(force: boolean): void;
}

export interface IAudioToClockConstructor {
  new(config: AudioToClockConfig): IAudioToClock;
}

export type RunFeatureExtractor = (audio: Float32Array) => Promise<{ odf: Float32Array; spec: Float32Array; }>;
export type RunBpmPhasePredictor = (odf: Float32Array, spec: Float32Array, inputTime: number) => Promise<{ bpm: number; phase: number; phaseMagnitude: number; inputTime: number; phaseX: number; phaseY: number; debugData: any }>;

export interface InferenceManagerConfig {
  hopSamples: number;
  maxHopsPerStep: number;
  odfFrames: number;
  specFrames: number;
  inferenceInterval: number;
  targetSampleRate: number;
  lookbehindSamples: number;
  delayCompensation: number;
  specSliceFraction?: number;
  exportDebugData?: boolean;
}

export interface InferenceManagerDebugData {
  inputTime: number;
  bpm: number;
  phase: number;
  phaseMagnitude: number;
  phaseX: number;
  phaseY: number;
  odfWindow?: Float32Array[];
  specWindow?: Float32Array[];
}

export interface StabilizerConfig {
  proximityThreshold: number;
  maxWeight: number;
  initialWeight: number;
  weightIncrement: number;
  decayFactor: number;
  pruneThreshold: number;
  bestTrajectoryBias: number;
  bpmWeightScale: number;
  bpmWeightBias: number;
  bpmVariancePenalty: number;
  shiftWeight: number;
  shiftWeightBias: number;
  overcorrectionWeightThreshold: number;
  overcorrectionBpmThreshold: number;
  overcorrectionPhaseThreshold: number;
  bpmOvercorrectionFactor: number;
  phaseOvercorrectionFactor: number;
  deltaHistorySize: number;
  exportDebugData: boolean;
}

export interface StabilizerDebugData {
  trajectories: StabilizerTrajectory[];
  bestTrajectory: StabilizerTrajectory | null;
  hasBestTrajectory: boolean;
  overallConfidence: number;
  bpmVariance: number;
  bpmHistory: number[];
}

export interface StabilizerTrajectory extends PhaseSample, BarPhaseSample {
  id: number;
  phase: number;
  barPhase: number;
  magnitude: number;
  bpm: number;
  weight: number;
  lastUpdateTime: number;
}

export interface ExternalClockControllerConfig {
  updateInterval: number; // seconds
  largePhaseErrorThreshold: number; // radians
  largeBpmDifferenceThreshold: number; // bpm
  phaseCorrectionThreshold: number; // radians
  predictionHorizonS: number; // seconds
  bpmNudgeThreshold: number; // bpm
  minNudgeIntervalS: number; // seconds
  bpmDriftThreshold: number; // bpm
  bpmTightDriftThreshold: number; // bpm
  bpmTightDriftIntervalS: number; // seconds
  bpmFilterWindowLength: number; // samples
  phaseFilterWindowLength: number; // samples
  exportDebugData: boolean;
}

export interface ScheduledBpmCorrection {
  time: number;
  bpm: number;
  scheduledAt: number;
}

export type ExternalClockAdjustType = 'sync' | 'nudge';
export type ExternalClockAdjustEvent = { bpm?: number; phase?: number; timestamp: number; type: ExternalClockAdjustType; };
export type ExternalClockAdjustedCallback = (changes: ExternalClockAdjustEvent & { debugData: ExternalClockDebugData; }) => void;

export interface ExternalClockDebugData extends PhaseSample, BarPhaseSample {
  lastUpdateTime: number;
  bpm: number;
  phase: number;
  barPhase: number;
  scheduledBpmCorrection: ScheduledBpmCorrection | null;
}

export interface PhaseSample {
  lastUpdateTime: number;
  bpm: number;
  phase: number;
}

export interface BarPhaseSample {
  lastUpdateTime: number;
  bpm: number;
  barPhase: number;
}

import { ExternalClockDebugData, ExternalClockControllerConfig, ExternalClockAdjustedCallback, ScheduledBpmCorrection, ExternalClockAdjustType } from "./schema";

export class ExternalClockController {
  private debugData: ExternalClockDebugData = {
    lastUpdateTime: 0.0,
    bpm: 120.0,
    phase: 0.0,
    barPhase: 0.0,
    scheduledBpmCorrection: null,
  };

  private readonly config: ExternalClockControllerConfig;

  private externalBpm: number = 120.0;
  private externalPhase: number = 0.0;
  private externalBarPhase: number = 0.0;
  private lastUpdateTime: number = 0;

  private clockAdjustedCallback?: ExternalClockAdjustedCallback;

  private scheduledBpmCorrection: ScheduledBpmCorrection | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private latestPredictedBpm: number = 120.0;
  private latestPredictedPhase: number = 0.0;
  private latestPredictedBarPhase: number = 0.0;
  private latestCurrentTime: number = 0;
  private lastBpmChangeTime: number = 0;

  private readonly bpmFilterHistories: number[] = [];
  private readonly phaseFilterHistories: { phase: number, time: number }[] = [];

  constructor(config?: Partial<ExternalClockControllerConfig>) {
    this.config = {
      updateInterval: 1.0 / 30.0,
      largePhaseErrorThreshold: Math.PI / 6,
      largeBpmDifferenceThreshold: 5.0,
      phaseCorrectionThreshold: Math.PI / 8, // radians
      predictionHorizonS: 5.0, // seconds
      bpmNudgeThreshold: 4.0, // bpm
      minNudgeIntervalS: 1.0, // seconds
      bpmDriftThreshold: 0.5, // bpm
      bpmTightDriftThreshold: 0.01, // bpm
      bpmTightDriftIntervalS: 2.0, // seconds
      bpmFilterWindowLength: 5, // samples
      phaseFilterWindowLength: 5, // samples
      exportDebugData: false,
      ...config,
    };
  }

  start() {
    if (this.intervalId !== null) {
      return;
    }
    this.intervalId = setInterval(() => this.tick(), this.config.updateInterval * 1000);
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  onClockAdjusted(callback: ExternalClockAdjustedCallback) {
    this.clockAdjustedCallback = callback;
  }

  update(predictedBpm: number, predictedPhase: number, predictedBarPhase: number, currentTime: number) {
    // BPM filtering
    this.bpmFilterHistories.push(predictedBpm);
    if (this.bpmFilterHistories.length > this.config.bpmFilterWindowLength) {
        this.bpmFilterHistories.shift();
    }
    const averageBpm = this.bpmFilterHistories.reduce((a, b) => a + b, 0) / this.bpmFilterHistories.length;
    this.latestPredictedBpm = averageBpm;

    // Phase filtering
    this.phaseFilterHistories.push({ phase: predictedPhase, time: currentTime });
    if (this.phaseFilterHistories.length > this.config.phaseFilterWindowLength) {
        this.phaseFilterHistories.shift();
    }

    let sumSin = 0;
    let sumCos = 0;
    for (const obs of this.phaseFilterHistories) {
        const timeDiff = currentTime - obs.time;
        const phaseAdvance = (timeDiff * averageBpm / 60.0) * 2 * Math.PI;
        const projectedPhase = obs.phase + phaseAdvance;
        sumSin += Math.sin(projectedPhase);
        sumCos += Math.cos(projectedPhase);
    }

    const averagePhase = Math.atan2(sumSin, sumCos);
    this.latestPredictedPhase = averagePhase;
    this.latestPredictedBarPhase = predictedBarPhase;

    this.latestCurrentTime = currentTime;
  }

  private tick() {
    const currentTime = this.latestCurrentTime;
    const predictedBpm = this.latestPredictedBpm;
    const predictedPhase = this.latestPredictedPhase;
    const predictedBarPhase = this.latestPredictedBarPhase;

    if (this.lastUpdateTime === 0) {
      this.externalBpm = predictedBpm;
      this.externalPhase = predictedPhase;
      this.externalBarPhase = predictedBarPhase;
      this.lastBpmChangeTime = currentTime;
      this.lastUpdateTime = currentTime;
      this.doExportDebugData();
      this.clockAdjustedCallback?.({ bpm: this.externalBpm, phase: this.externalPhase, timestamp: currentTime, type: 'sync', debugData: this.debugData });
      return;
    }

    const dt = currentTime - this.lastUpdateTime;
    if (dt <= 0) return;

    let didUpdateWithType: ExternalClockAdjustType | undefined = undefined;

    // 1. Simulate our external clock forward
    const tickPhaseAdvance = (dt * this.externalBpm / 60.0) * 2 * Math.PI;
    this.externalPhase += tickPhaseAdvance;
    // Ensure absolute lock-step!
    const externalPhase01 = wrap(this.externalPhase / Math.PI / 2.0, 1.0);
    if (Math.round(predictedBarPhase) !== Math.round(this.externalBarPhase)) {
      this.externalBarPhase = predictedBarPhase;
    }
    this.externalBarPhase = Math.round(this.externalBarPhase + tickPhaseAdvance / Math.PI / 2.0 - externalPhase01) + externalPhase01;

    // 2. Check for scheduled BPM corrections
    if (this.scheduledBpmCorrection && currentTime >= this.scheduledBpmCorrection.time) {
      this.externalBpm = this.scheduledBpmCorrection.bpm;
      this.lastBpmChangeTime = currentTime;
      didUpdateWithType = 'nudge';
      this.scheduledBpmCorrection = null;
    }

    // 3. Calculate phase error by predicting future phases
    const predictionHorizonS = this.config.predictionHorizonS;
    const futureInternalPhase = predictedPhase + (predictionHorizonS * predictedBpm / 60.0) * 2 * Math.PI;

    let predictionPhaseAdvance;
    const dtCorrection = this.scheduledBpmCorrection ? this.scheduledBpmCorrection.time - currentTime : -1;

    if (this.scheduledBpmCorrection && dtCorrection > 0 && dtCorrection < predictionHorizonS) {
      const currentBpmPhaseAdvance = dtCorrection * this.externalBpm;
      const futureBpmPhaseAdvance = (predictionHorizonS - dtCorrection) * this.scheduledBpmCorrection.bpm;
      predictionPhaseAdvance = (currentBpmPhaseAdvance + futureBpmPhaseAdvance) / 60.0 * 2 * Math.PI;
    } else {
      predictionPhaseAdvance = (predictionHorizonS * this.externalBpm / 60.0) * 2 * Math.PI;
    }
    const futureExternalPhase = this.externalPhase + predictionPhaseAdvance;
    const phaseError = wrapSigned(futureInternalPhase - futureExternalPhase, Math.PI);

    // 4. Decide on correction
    const bpmNudgeRequired = (phaseError * 60.0) / (2.0 * Math.PI * this.config.predictionHorizonS);

    if ((Math.abs(phaseError) > this.config.largePhaseErrorThreshold && Math.abs(bpmNudgeRequired) > this.config.bpmNudgeThreshold) ||
        Math.abs(predictedBpm - this.externalBpm) > this.config.largeBpmDifferenceThreshold) {
      // Hard reset
      this.externalBpm = predictedBpm;
      this.externalPhase = predictedPhase;
      this.lastBpmChangeTime = currentTime;
      didUpdateWithType = 'sync';
      this.scheduledBpmCorrection = null;
    } else if ((this.scheduledBpmCorrection === null || (currentTime - this.scheduledBpmCorrection.scheduledAt) > this.config.minNudgeIntervalS) && Math.abs(phaseError) > this.config.phaseCorrectionThreshold) {
      // Nudge BPM to correct phase over predictionHorizonS seconds.
      const bpmNudge = bpmNudgeRequired;
      this.externalBpm += bpmNudge;
      this.lastBpmChangeTime = currentTime;
      didUpdateWithType = 'nudge';

      // Schedule a correction back to the predicted BPM
      this.scheduledBpmCorrection = {
        time: currentTime + this.config.predictionHorizonS,
        bpm: predictedBpm,
        scheduledAt: currentTime,
      };
    } else if (this.scheduledBpmCorrection === null) {
      const bpmDifference = predictedBpm - this.externalBpm;
      const timeSinceLastBpmChange = currentTime - this.lastBpmChangeTime;

      if (timeSinceLastBpmChange > this.config.bpmTightDriftIntervalS && Math.abs(bpmDifference) > this.config.bpmTightDriftThreshold) {
        // Snap BPM
        this.externalBpm = predictedBpm;
        this.lastBpmChangeTime = currentTime;
        didUpdateWithType = 'nudge';
      } else if (Math.abs(bpmDifference) > this.config.bpmDriftThreshold) {
        // No correction scheduled and phase error is small, slowly drift towards predicted BPM
        this.externalBpm = predictedBpm;
        this.lastBpmChangeTime = currentTime;
        didUpdateWithType = 'nudge';
      }
    }

    this.lastUpdateTime = currentTime;

    this.doExportDebugData();

    if (didUpdateWithType !== undefined) {
      const phaseToReport = didUpdateWithType === 'nudge' ? undefined : this.externalPhase;
      this.clockAdjustedCallback?.({
        bpm: this.externalBpm,
        phase: phaseToReport,
        timestamp: currentTime,
        type: didUpdateWithType,
        debugData: this.debugData,
      });
    }
  }

  private doExportDebugData() {
    if (this.config.exportDebugData) {
      this.debugData = {
        lastUpdateTime: this.lastUpdateTime,
        bpm: this.externalBpm,
        phase: wrap(this.externalPhase, 2 * Math.PI),
        barPhase: this.externalBarPhase,
        scheduledBpmCorrection: structuredClone(this.scheduledBpmCorrection),
      };
    }
  }
}

function wrap(x: number, mod: number): number {
  return ((x % mod) + mod) % mod;
}

function wrapSigned(x: number, range: number): number {
  let wrapped = wrap(x + range, range * 2);
  return wrapped - range;
}

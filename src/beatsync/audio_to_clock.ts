import { ExternalClockController } from "./external_clock_controller";
import { AudioToClockConfig, IAudioToClock, IAudioToClockConstructor } from "./schema";
import { InferenceManager, InferenceManagerConfigInternal } from "./inference_manager";
import { Stabilizer } from "./stabilizer";
import { SAMPLE_RATE, BLOCK_DURATION_S, HI_RES_HOP_LENGTH, LOW_RES_HOP_LENGTH, LOW_RES_N_FFT } from './config_audio';
import { predictPhase, predictBarPhase } from "./extrapolation";

class AudioToClock implements IAudioToClock {
  private inferenceManager: InferenceManager | null = null;
  private readonly stabilizer: Stabilizer;
  private readonly externalClockController: ExternalClockController;
  private latestTime = 0.0;

  constructor(config: AudioToClockConfig) {
    const inferenceConfig: InferenceManagerConfigInternal = {
      ...config.inferenceConfig,
      onPrediction: ({ bpm, phase, phaseMagnitude, inputTime, debugData }) => {
        this.stabilizer.addPrediction(phase, phaseMagnitude, bpm, inputTime);
        config.onDebugDataExported?.({ inference: debugData });
      },
      runFeatureExtractor: config.runFeatureExtractor,
      runBpmPhasePredictor: config.runBpmPhasePredictor,
    } as InferenceManagerConfigInternal;
    this.inferenceManager = new InferenceManager(inferenceConfig);

    this.stabilizer = new Stabilizer({
      ...config.stabilizerConfig,
      onTrajectoryUpdated: (bestTrajectory) => {
        const currentTime = this.latestTime;
        this.externalClockController.update(
          bestTrajectory.bpm,
          predictPhase(bestTrajectory, currentTime),
          predictBarPhase(bestTrajectory, currentTime),
          currentTime,
        );
      },
      onDebugDataUpdated: (debugData) => {
        config.onDebugDataExported?.({ stabilizer: debugData });
      }
    });

    this.externalClockController = new ExternalClockController({
      ...config.externalClockControllerConfig,
    });
    this.externalClockController.onClockAdjusted((changes) => {
      config.onExternalClockAdjusted?.({ bpm: changes.bpm, phase: changes.phase, timestamp: changes.timestamp });
      config.onDebugDataExported?.({ externalClock: changes.debugData, externalClockEvent: changes });
    });
    this.externalClockController.start();
  }

  addAudio(audioSamples: Float32Array[], currentTime: number, inputSampleRate: number) {
    this.latestTime = currentTime;
    this.inferenceManager?.addAudio(audioSamples, currentTime, inputSampleRate);
  }

  resync(hard?: boolean): void {
    // No-op for now
  }

  resetHardSync(): void {
    // No-op for now
  }

  setForceExportAllDebugData(force: boolean): void {
    // No-op for now
  }
}

export const AudioToClockConstructor: IAudioToClockConstructor = AudioToClock;

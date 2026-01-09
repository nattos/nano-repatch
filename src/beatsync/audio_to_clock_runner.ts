import { InferenceManagerDebugData, StabilizerDebugData, ExternalClockDebugData, ExternalClockAdjustEvent, InferenceManagerConfig, StabilizerConfig, ExternalClockControllerConfig, AudioToClockConfig } from "./schema";

/**
 * A WebWorker threaded version of AudioToClock.
 */
export class AudioToClockRunner {
  private readonly worker: Worker;
  private readonly onStatusUpdated?: (status: {
    message: string;
    isError: boolean;
  }) => void;
  private readonly onExternalClockAdjusted?: (changes: {
    bpm?: number;
    phase?: number;
    timestamp: number;
  }) => void;
  private readonly onDebugDataExported?: (updates: {
    inference?: InferenceManagerDebugData;
    stabilizer?: StabilizerDebugData;
    externalClock?: ExternalClockDebugData;
    externalClockEvent?: ExternalClockAdjustEvent;
  }) => void;

  constructor(config: {
    featureExtractorUrl: string;
    bpmPhaseModelUrl: string;

    exportAllDebugData?: boolean,
    inferenceConfig?: InferenceManagerConfig;
    stabilizerConfig?: StabilizerConfig;
    externalClockControllerConfig?: ExternalClockControllerConfig;

    onStatusUpdated?: (status: {
      message: string;
      isError: boolean;
    }) => void;

    onExternalClockAdjusted?: (changes: {
      bpm?: number;
      phase?: number;
      timestamp: number;
    }) => void;

    onDebugDataExported?: (updates: {
      inference?: InferenceManagerDebugData;
      stabilizer?: StabilizerDebugData;
      externalClock?: ExternalClockDebugData;
      externalClockEvent?: ExternalClockAdjustEvent;
    }) => void;
  }) {
    this.onStatusUpdated = config.onStatusUpdated;
    this.onExternalClockAdjusted = config.onExternalClockAdjusted;
    this.onDebugDataExported = config.onDebugDataExported;

    this.worker = new Worker(new URL('./audio_to_clock.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'ready') {
        this.onStatusUpdated?.({ message: 'Ready', isError: false });
      } else if (type === 'status') {
        this.onStatusUpdated?.(payload);
      } else if (type === 'clock') {
        this.onExternalClockAdjusted?.(payload);
      } else if (type === 'debug') {
        this.onDebugDataExported?.(payload);
      }
    };

    this.worker.postMessage({
      type: 'init',
      payload: {
        featureExtractorUrl: config.featureExtractorUrl,
        bpmPhaseModelUrl: config.bpmPhaseModelUrl,
        audioToClockConfig: {
          exportAllDebugData: config.exportAllDebugData,
          inferenceConfig: config.inferenceConfig,
          stabilizerConfig: config.stabilizerConfig,
          externalClockControllerConfig: config.externalClockControllerConfig,
        } satisfies Partial<AudioToClockConfig>,
      }
    });
  }

  addAudio(audioSamples: Float32Array[], currentTime: number, inputSampleRate: number) {
    this.worker.postMessage({
      type: 'addAudio',
      payload: {
        buffer: audioSamples,
        currentTime: currentTime,
        sampleRate: inputSampleRate
      }
    });
  }
}

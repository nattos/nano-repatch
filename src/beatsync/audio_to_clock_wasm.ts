import createAudioToClockWasm, { WasmInstance } from './wasm/audio_to_clock_wasm';
import { IAudioToClock, AudioToClockConfig, IAudioToClockConstructor, DebugUpdates } from './schema';
import { SAMPLE_RATE, BLOCK_DURATION_S, HI_RES_HOP_LENGTH, LOW_RES_HOP_LENGTH, LOW_RES_N_FFT } from './config_audio';
import { OperationQueue, sleep } from './utils';

class AudioToClockWasm implements IAudioToClock {
  private readonly config: AudioToClockConfig;
  private wasmInstance?: WasmInstance;
  private audioToClock?: any;
  private readonly taskQueue = new OperationQueue();
  private latestTimestamp: number = 0;
  private timerInterval?: ReturnType<typeof setInterval>;

  constructor(config: AudioToClockConfig) {
    this.config = config;
    this.initWasm();
  }

  private async initWasm() {
    try {
      this.config.onStatusUpdated?.({ message: 'Initializing WASM...', isError: false });

      this.wasmInstance = await createAudioToClockWasm();
      this.audioToClock = new this.wasmInstance.AudioToClock(
        this.config,
        (message: string, isError: boolean) => {
          this.config.onStatusUpdated?.({ message, isError });
        },
        (changes: { bpm?: number; phase?: number; timestamp: number; type: string; }) => {
          this.config.onExternalClockAdjusted?.(changes);
        },
        (debugData: DebugUpdates) => {
          this.config.onDebugDataExported?.(debugData);
        },
        async (audio: Float32Array) => {
          const result = await this.config.runFeatureExtractor(audio);
          this.resolveFeatureExtractor(result);
        },
        (odf: Float32Array, spec: Float32Array, inputTime: number) => { this.config.runBpmPhasePredictor(odf, spec, inputTime).then(result => this.resolveBpmPhasePredictor(result)) },
      );

      this.timerInterval = setInterval(() => this.audioToClock.tick(this.latestTimestamp), (this.config.externalClockControllerConfig?.updateInterval ?? (1.0 / 30.0)) * 1000);

      this.config.onStatusUpdated?.({ message: 'WASM module loaded.', isError: false });
    } catch (e) {
      console.error(e);
      this.config.onStatusUpdated?.({ message: 'Failed to load WASM module.', isError: true });
    }
  }

  addAudio(audioSamples: Float32Array[], currentTime: number, inputSampleRate: number): void {
    this.latestTimestamp = currentTime;
    const numChannels = audioSamples.length;
    if (numChannels === 0) {
      return;
    }
    this.taskQueue.push(async () => {
      if (!this.wasmInstance || !this.audioToClock) {
        return; // WASM not ready
      }

      const numSamples = audioSamples[0].length;
      const totalSamples = numChannels * numSamples;

      const buffer = new Float32Array(totalSamples);
      for (let i = 0; i < numChannels; i++) {
        buffer.set(audioSamples[i], i * numSamples);
      }

      const dataPtr = this.wasmInstance._malloc(totalSamples * Float32Array.BYTES_PER_ELEMENT);
      this.wasmInstance.HEAPF32.set(buffer, dataPtr / Float32Array.BYTES_PER_ELEMENT);

      await this.audioToClock.addAudio(dataPtr, numChannels, numSamples, currentTime, inputSampleRate);

      this.wasmInstance._free(dataPtr);
    });
  }

  resync(hard?: boolean): void {
    if (this.audioToClock) {
      this.audioToClock.resync(!!hard);
    }
  }

  resetHardSync(): void {
    if (this.audioToClock) {
      this.audioToClock.resetHardSync();
    }
  }

  setForceExportAllDebugData(force: boolean): void {
    if (this.audioToClock) {
      this.audioToClock.setForceExportAllDebugData(force);
    }
  }

  setRunning(running: boolean): void {
    // WASM implementation might not support pause yet, or we handle it here by clearing interval?
    // The main implementation clears interval of InternalClockController.
    // WASM uses a timerInterval.
    if (running) {
      if (!this.timerInterval && this.audioToClock) {
        this.timerInterval = setInterval(() => this.audioToClock.tick(this.latestTimestamp), (this.config.externalClockControllerConfig?.updateInterval ?? (1.0 / 30.0)) * 1000);
      }
    } else {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = undefined;
      }
    }
  }

  async resolveFeatureExtractor(result: { odf: Float32Array; spec: Float32Array; }) {
    if (!this.wasmInstance || !this.audioToClock) {
      return;
    }
    const odfData = result.odf;
    const specData = result.spec;
    const odfDataPtr = this.wasmInstance._malloc(odfData.length * Float32Array.BYTES_PER_ELEMENT);
    this.wasmInstance.HEAPF32.set(odfData, odfDataPtr / Float32Array.BYTES_PER_ELEMENT);
    const specDataPtr = this.wasmInstance._malloc(specData.length * Float32Array.BYTES_PER_ELEMENT);
    this.wasmInstance.HEAPF32.set(specData, specDataPtr / Float32Array.BYTES_PER_ELEMENT);
    this.audioToClock.resolveFeatureExtractor(odfDataPtr, odfData.length, specDataPtr, specData.length);
    this.wasmInstance._free(odfDataPtr);
    this.wasmInstance._free(specDataPtr);
  }

  async resolveBpmPhasePredictor(result: { bpm: number; phase: number; phaseMagnitude: number; inputTime: number; phaseX: number; phaseY: number; debugData: any }) {
    this.audioToClock?.resolveBpmPhasePredictor(result);
  }

  stop() {
    clearInterval(this.timerInterval);
  }
}

export const AudioToClockWasmConstructor: IAudioToClockConstructor = AudioToClockWasm;

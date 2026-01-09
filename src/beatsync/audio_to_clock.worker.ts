/**
 * The WebWorker frontend for AudioToClockRunner.
 */

import * as ort from 'onnxruntime-web';
import { ModelManager } from './models';
import { AudioToClockConfig, IAudioToClock } from "./schema";
import { SAMPLE_RATE, BLOCK_DURATION_S, HI_RES_HOP_LENGTH, LOW_RES_HOP_LENGTH, LOW_RES_N_FFT, ODF_CHANNELS, SPEC_CHANNELS, BPM_MIN, BPM_MAX } from './config_audio';
// import { AudioToClockConstructor } from './audio_to_clock'; // TODO
import { AudioToClockWasmConstructor } from './audio_to_clock_wasm';
const AudioToClockConstructor = AudioToClockWasmConstructor;

let audioToClock: IAudioToClock | undefined = undefined;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    const { featureExtractorUrl, bpmPhaseModelUrl, audioToClockConfig } = payload;
    const modelManager = new ModelManager();
    await modelManager.loadModels(featureExtractorUrl, bpmPhaseModelUrl);

    const odfFrames = Math.floor(BLOCK_DURATION_S * SAMPLE_RATE / HI_RES_HOP_LENGTH) + 1;
    const specFrames = Math.floor(BLOCK_DURATION_S * SAMPLE_RATE / LOW_RES_HOP_LENGTH) + 1;

    const fullConfig: AudioToClockConfig = {
      ...audioToClockConfig,
      inferenceConfig: {
        hopSamples: LOW_RES_HOP_LENGTH,
        maxHopsPerStep: 8,
        odfFrames: odfFrames,
        specFrames: specFrames,
        inferenceInterval: 1,
        targetSampleRate: SAMPLE_RATE,
        specSliceFraction: 0.25,
        lookbehindSamples: LOW_RES_N_FFT / 2,
        delayCompensation: 0.05,
        exportDebugData: audioToClockConfig.exportAllDebugData,
        ...audioToClockConfig.inferenceConfig,
      },
      stabilizerConfig: {
        exportDebugData: audioToClockConfig.exportAllDebugData,
        ...audioToClockConfig.stabilizerConfig
      },
      externalClockControllerConfig: {
        exportDebugData: audioToClockConfig.exportAllDebugData,
        ...audioToClockConfig.externalClockControllerConfig
      },
      runFeatureExtractor: async (audio: Float32Array) => {
        const audioTensor = new ort.Tensor('float32', audio, [1, audio.length]);
        const featureFeeds: ort.InferenceSession.FeedsType = { [modelManager.getFeatureExtractor().inputNames[0]]: audioTensor };
        const featureResults = await modelManager.getFeatureExtractor().run(featureFeeds);
        const odfWide = featureResults[modelManager.getFeatureExtractor().outputNames[0]];
        const specWide = featureResults[modelManager.getFeatureExtractor().outputNames[1]];
        return {
          odf: odfWide.data as Float32Array,
          spec: specWide.data as Float32Array,
        };
      },
      runBpmPhasePredictor: async (odf: Float32Array, spec: Float32Array, inputTime: number) => {
        const odfTensor = new ort.Tensor('float32', odf, [1, ODF_CHANNELS, (odf.length / ODF_CHANNELS) | 0]);
        const specTensor = new ort.Tensor('float32', spec, [1, SPEC_CHANNELS, (spec.length / SPEC_CHANNELS) | 0]);
        const modelFeeds: ort.InferenceSession.FeedsType = {
          'odf_input': odfTensor,
          'spec_input': specTensor,
        };
        const modelResults = await modelManager.getMainModel().run(modelFeeds);
        const predictionTensor = modelResults[modelManager.getMainModel().outputNames[0]];
        const data = predictionTensor.data as Float32Array;
        const phaseX = data[0];
        const phaseY = data[1];
        const normalizedBpm = data[2];
        const bpm = normalizedBpm * (BPM_MAX - BPM_MIN) + BPM_MIN;
        const phase = Math.atan2(phaseY, phaseX);
        const phaseMagnitude = Math.sqrt(phaseX * phaseX + phaseY * phaseY);

        return {
          bpm,
          phase,
          phaseMagnitude,
          inputTime,
          phaseX,
          phaseY,
          debugData: {},
        };
      },
      onStatusUpdated: (status) => {
        self.postMessage({ type: 'status', payload: status });
      },
      onExternalClockAdjusted: (changes) => {
        self.postMessage({ type: 'clock', payload: changes });
      },
      onDebugDataExported: (updates) => {
        self.postMessage({ type: 'debug', payload: updates });
      },
    };

    const thisAudioToClock = new AudioToClockConstructor(fullConfig);
    audioToClock = thisAudioToClock;

    self.postMessage({ type: 'ready' });
  } else if (type === 'addAudio') {
    audioToClock?.addAudio(payload.buffer, payload.currentTime, payload.sampleRate);
  }
};
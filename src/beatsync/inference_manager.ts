import { HI_RES_HOP_LENGTH, LOW_RES_HOP_LENGTH, BPM_MAX, BPM_MIN, ODF_CHANNELS, SPEC_CHANNELS } from './config_audio';
import { Resampler, downmix } from './audio_utils';
import { InferenceManagerConfig, InferenceManagerDebugData, RunBpmPhasePredictor, RunFeatureExtractor } from './schema';

export interface InferenceManagerConfigInternal extends InferenceManagerConfig {
  onPrediction: (prediction: {
    inputTime: number;
    bpm: number;
    phase: number;
    phaseMagnitude: number;
    phaseX: number;
    phaseY: number;
    debugData: InferenceManagerDebugData;
  }) => void;
  runFeatureExtractor: RunFeatureExtractor;
  runBpmPhasePredictor: RunBpmPhasePredictor;
}

export class InferenceManager {
  private readonly config: InferenceManagerConfigInternal;
  private resampler: Resampler | null = null;
  private isProcessing = false;
  private audioBlocks: { data: Float32Array, timestamp: number }[] = [];
  private odfWindow: Float32Array | null = null;
  private specWindow: Float32Array | null = null;
  private hopCounter = 0;
  private debugData: InferenceManagerDebugData = {
    inputTime: 0,
    bpm: 120.0,
    phase: 0.0,
    phaseMagnitude: 0.0,
    phaseX: 0.0,
    phaseY: 0.0,
  };

  constructor(config: InferenceManagerConfigInternal) {
    this.config = config;
  }

  public addAudio(channels: Float32Array[], currentTime: number, inputSampleRate: number): void {
    if (!this.resampler) {
      this.resampler = new Resampler(inputSampleRate, this.config.targetSampleRate);
    }
    const monoData = downmix(channels);
    this.resampler.addData(monoData);
    const resampled = this.resampler.resample();

    if (resampled.length === 0) {
      return;
    }

    if (this.audioBlocks.length > 0) {
      const lastBlock = this.audioBlocks[this.audioBlocks.length - 1];
      const expectedTime = lastBlock.timestamp + lastBlock.data.length / this.config.targetSampleRate;
      if (Math.abs(currentTime - expectedTime) > 0.1) {
        console.warn(`Audio timestamp discontinuity detected. Expected ~${expectedTime.toFixed(3)}, got ${currentTime.toFixed(3)}. Resetting queue.`);
        this.audioBlocks = [];
        this.odfWindow = null;
        this.specWindow = null;
        this.hopCounter = 0;
        this.resampler.reset();
      }
    }

    this.audioBlocks.push({ data: resampled, timestamp: currentTime });
    this.processQueue();
  }

  private getAudioChunk(numSamples: number): { audioChunk: Float32Array, timestamp: number } {
    if (this.audioBlocks.length === 0) {
      throw new Error("Cannot get audio chunk from empty queue.");
    }
    const timestamp = this.audioBlocks[0].timestamp;
    const audioChunk = new Float32Array(numSamples);
    let samplesCopied = 0;
    let blockIdx = 0;
    while (samplesCopied < numSamples && blockIdx < this.audioBlocks.length) {
      const block = this.audioBlocks[blockIdx];
      const samplesToCopy = Math.min(numSamples - samplesCopied, block.data.length);
      audioChunk.set(block.data.subarray(0, samplesToCopy), samplesCopied);
      samplesCopied += samplesToCopy;
      blockIdx++;
    }
    if (samplesCopied < numSamples) {
      console.warn(`Requested ${numSamples} samples but only got ${samplesCopied}. Padding with silence.`);
    }
    return { audioChunk, timestamp };
  }

  private consumeAudio(numSamples: number): void {
    let samplesToConsume = numSamples;
    while (samplesToConsume > 0 && this.audioBlocks.length > 0) {
      const block = this.audioBlocks[0];
      const blockSamples = block.data.length;
      if (samplesToConsume >= blockSamples) {
        samplesToConsume -= blockSamples;
        this.audioBlocks.shift();
      } else {
        block.data = block.data.subarray(samplesToConsume);
        block.timestamp += samplesToConsume / this.config.targetSampleRate;
        samplesToConsume = 0;
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      await this.processQueueImpl();
    } finally {
      this.isProcessing = false;
    }
  }

  private async processQueueImpl(): Promise<void> {
    const lookbehindSamples = this.config.lookbehindSamples;
    const totalSamples = this.audioBlocks.reduce((sum, block) => sum + block.data.length, 0);
    let numHopsToProcess = Math.floor((totalSamples - lookbehindSamples) / this.config.hopSamples);

    if (numHopsToProcess <= 0) {
      return;
    }

    if (numHopsToProcess > this.config.maxHopsPerStep) {
      const hopsToDiscard = numHopsToProcess - this.config.maxHopsPerStep;
      const samplesToDiscard = hopsToDiscard * this.config.hopSamples;
      this.consumeAudio(samplesToDiscard);
      console.warn(`Audio processing fell behind. Discarding ${hopsToDiscard} hops.`);
      numHopsToProcess = this.config.maxHopsPerStep;
    }

    const samplesToProcess = numHopsToProcess * this.config.hopSamples;
    const processChunkSamples = samplesToProcess + lookbehindSamples;
    const firstHopStartTime = this.audioBlocks[0].timestamp;

    const { audioChunk } = this.getAudioChunk(processChunkSamples);
    this.consumeAudio(samplesToProcess);

    const { odf: odfWideData, spec: specWideData } = await this.config.runFeatureExtractor(audioChunk);
    const odfBands = ODF_CHANNELS;
    const specBands = SPEC_CHANNELS;

    const odfFramesWide = odfWideData.length / odfBands;
    const specFramesWide = specWideData.length / specBands;

    const lookbehindOdfFrames = Math.floor(lookbehindSamples / HI_RES_HOP_LENGTH);
    const lookbehindSpecFrames = Math.floor(lookbehindSamples / LOW_RES_HOP_LENGTH);

    const hopTime = this.config.hopSamples / this.config.targetSampleRate;

    for (let i = 0; i < numHopsToProcess; i++) {
      const currentHopStartTime = firstHopStartTime + i * hopTime;

      const odfFramesFor_i_hops = Math.floor(i * this.config.hopSamples / HI_RES_HOP_LENGTH);
      const odfFramesFor_i_plus_1_hops = Math.floor((i + 1) * this.config.hopSamples / HI_RES_HOP_LENGTH);
      const hopOdfFramesCount = odfFramesFor_i_plus_1_hops - odfFramesFor_i_hops;

      const specFramesFor_i_hops = Math.floor(i * this.config.hopSamples / LOW_RES_HOP_LENGTH);
      const specFramesFor_i_plus_1_hops = Math.floor((i + 1) * this.config.hopSamples / LOW_RES_HOP_LENGTH);
      const hopSpecFramesCount = specFramesFor_i_plus_1_hops - specFramesFor_i_hops;

      const odfFrameStart = lookbehindOdfFrames + odfFramesFor_i_hops;
      console.log('odfFrameStart', odfFrameStart, 'hopOdfFramesCount', hopOdfFramesCount, 'odfWideData.length', odfWideData.length);
      const newOdfData = new Float32Array(odfBands * hopOdfFramesCount);
      for (let b = 0; b < odfBands; b++) {
        const bandData = odfWideData.subarray(b * odfFramesWide, (b + 1) * odfFramesWide);
        const newFrames = bandData.subarray(odfFrameStart, odfFrameStart + hopOdfFramesCount);
        newOdfData.set(newFrames, b * hopOdfFramesCount);
      }

      const specFrameStart = lookbehindSpecFrames + specFramesFor_i_hops;
      const newSpecData = new Float32Array(specBands * hopSpecFramesCount);
      for (let b = 0; b < specBands; b++) {
        const bandData = specWideData.subarray(b * specFramesWide, (b + 1) * specFramesWide);
        const newFrames = bandData.subarray(specFrameStart, specFrameStart + hopSpecFramesCount);
        newSpecData.set(newFrames, b * hopSpecFramesCount);
      }

      if (!this.odfWindow || !this.specWindow) {
        this.odfWindow = new Float32Array(odfBands * this.config.odfFrames);
        this.specWindow = new Float32Array(specBands * this.config.specFrames);
      }

      const odfFrames = this.config.odfFrames;
      if (hopOdfFramesCount > 0) {
        const newOdfWindowData = new Float32Array(this.odfWindow.length);
        for (let j = 0; j < odfBands; j++) {
          const oldBand = this.odfWindow.subarray(j * odfFrames, (j + 1) * odfFrames);
          const newFramesForBand = newOdfData.subarray(j * hopOdfFramesCount, (j + 1) * hopOdfFramesCount);
          const newBand = new Float32Array(odfFrames);
          newBand.set(oldBand.subarray(hopOdfFramesCount));
          newBand.set(newFramesForBand, odfFrames - hopOdfFramesCount);
          newOdfWindowData.set(newBand, j * odfFrames);
        }
        this.odfWindow = newOdfWindowData;
        this.doExportDebugData();
      }

      const specFrames = this.config.specFrames;
      if (hopSpecFramesCount > 0) {
        const newSpecWindowData = new Float32Array(this.specWindow.length);
        for (let j = 0; j < specBands; j++) {
          const oldBand = this.specWindow.subarray(j * specFrames, (j + 1) * specFrames);
          const newFramesForBand = newSpecData.subarray(j * hopSpecFramesCount, (j + 1) * hopSpecFramesCount);
          const newBand = new Float32Array(specFrames);
          newBand.set(oldBand.subarray(hopSpecFramesCount));
          newBand.set(newFramesForBand, specFrames - hopSpecFramesCount);
          newSpecWindowData.set(newBand, j * specFrames);
        }
        this.specWindow = newSpecWindowData;
      }

      this.hopCounter++;

      if (this.hopCounter % this.config.inferenceInterval === 0) {
        let specInput = this.specWindow!;
        const specSliceFraction = this.config.specSliceFraction ?? 1.0;

        if (specSliceFraction < 1.0) {
          const originalSpecData = this.specWindow!;
          const originalFrames = this.config.specFrames;
          const slicedFrames = Math.floor(originalFrames * specSliceFraction);

          if (slicedFrames < originalFrames) {
            const slicedData = new Float32Array(specBands * slicedFrames);
            for (let j = 0; j < specBands; j++) {
              const bandData = originalSpecData.subarray(j * originalFrames, (j + 1) * originalFrames);
              const slicedBand = bandData.subarray(originalFrames - slicedFrames);
              slicedData.set(slicedBand, j * slicedFrames);
            }
            specInput = slicedData;
          }
        }

        const predictionTime = currentHopStartTime - this.config.delayCompensation - this.config.lookbehindSamples / this.config.targetSampleRate;
        const { phaseX, phaseY, bpm } = await this.config.runBpmPhasePredictor(this.odfWindow!, specInput, predictionTime);

        const phase = Math.atan2(phaseY, phaseX);
        const phaseMagnitude = Math.sqrt(phaseX * phaseX + phaseY * phaseY);

        const prediction = {
          inputTime: predictionTime,
          bpm,
          phase,
          phaseMagnitude,
          phaseX,
          phaseY,
        };
        if (this.config.exportDebugData && this.odfWindow) {
          Object.assign(this.debugData, prediction);
        }
        this.config.onPrediction({
          ...prediction,
          debugData: this.debugData,
        });
      }
    }
  }

  private doExportDebugData() {
    if (this.config.exportDebugData && this.odfWindow) {
      const odfWindowData = this.odfWindow;
      const odfFrames = this.config.odfFrames;
      const odfWindowBands = [];
      for (let i = 0; i < ODF_CHANNELS; i++) {
        odfWindowBands.push(odfWindowData.slice(i * odfFrames, (i + 1) * odfFrames));
      }
      this.debugData.odfWindow = odfWindowBands;
    }
    if (this.config.exportDebugData && this.specWindow) {
      const odfWindowData = this.specWindow;
      const specFrames = this.config.specFrames;
      const specWindowBands = [];
      for (let i = 0; i < SPEC_CHANNELS; i++) {
        specWindowBands.push(odfWindowData.slice(i * specFrames, (i + 1) * specFrames));
      }
      this.debugData.specWindow = specWindowBands;
    }
  }
}

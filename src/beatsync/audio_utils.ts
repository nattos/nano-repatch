export class Resampler {
  private readonly inputSampleRate: number;
  private readonly outputSampleRate: number;
  private readonly ratio: number;
  private inputBuffer: Float32Array = new Float32Array(0);

  constructor(inputSampleRate: number, outputSampleRate: number) {
    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.ratio = this.inputSampleRate / this.outputSampleRate;
  }

  public addData(data: Float32Array) {
    const combined = new Float32Array(this.inputBuffer.length + data.length);
    combined.set(this.inputBuffer);
    combined.set(data, this.inputBuffer.length);
    this.inputBuffer = combined;
  }

  public resample(): Float32Array {
    if (this.inputBuffer.length < this.ratio) {
      return new Float32Array(0);
    }

    const outputLength = Math.floor((this.inputBuffer.length - 1) / this.ratio);
    if (outputLength === 0) {
        return new Float32Array(0);
    }
    const outputData = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const inputIndex = i * this.ratio;
      const lowIndex = Math.floor(inputIndex);
      const highIndex = lowIndex + 1;
      const weight = inputIndex - lowIndex;

      const lowValue = this.inputBuffer[lowIndex];
      const highValue = this.inputBuffer[highIndex];
      outputData[i] = lowValue + (highValue - lowValue) * weight;
    }

    const consumedInput = outputLength * this.ratio;
    this.inputBuffer = this.inputBuffer.subarray(consumedInput);

    return outputData;
  }

  public reset() {
    this.inputBuffer = new Float32Array(0);
  }
}

export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) {
    return channels[0];
  }
  const numChannels = channels.length;
  const length = channels[0].length;
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < numChannels; j++) {
      sum += channels[j][i];
    }
    result[i] = sum / numChannels;
  }
  return result;
}

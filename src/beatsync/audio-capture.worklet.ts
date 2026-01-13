class AudioCaptureProcessor extends AudioWorkletProcessor {
  private processingPort: MessagePort | null = null;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data.type === 'init') {
        this.processingPort = event.data.port;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    if (!this.processingPort) return true;

    const input = inputs[0];
    if (input && input.length > 0) {
      const channels: Float32Array[] = [];
      const transferList: Transferable[] = [];

      for (let i = 0; i < input.length; i++) {
        const channel = new Float32Array(input[i]);
        channels.push(channel);
        transferList.push(channel.buffer);
      }

      this.processingPort.postMessage({
        type: 'audio',
        payload: {
          buffer: channels,
          currentTime: currentTime,
          sampleRate: sampleRate
        }
      }, transferList);
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);

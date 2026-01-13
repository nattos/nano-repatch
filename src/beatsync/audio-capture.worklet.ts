class AudioCaptureProcessor extends AudioWorkletProcessor {
  private processingPort: MessagePort | null = null; // Renamed to avoid overlap

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
      // We need to copy the data because the input buffer is owned by the audio thread
      // and cannot be transferred? Actually, we can just slice it.
      // Or we can just send it.

      // We want to minimize allocation.
      // But we need to structure it for the worker: { buffer: Float32Array[], currentTime, sampleRate }
      // Sample rate is global in AudioWorkletGlobalScope? No, context.sampleRate.
      // Wait, AudioWorkletProcessor doesn't have access to context directly?
      // It has `currentTime`.

      // Let's copy channels.
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
          sampleRate: sampleRate // global scope
        }
      }, transferList);
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);

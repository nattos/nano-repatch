export class AudioInputManager {
  private activeStream: MediaStream | null = null;
  private activeDeviceId: string | null = null;
  private _audioContext: AudioContext | null = null;
  private _sourceNode: MediaStreamAudioSourceNode | null = null;

  public get stream() {
    return this.activeStream;
  }

  public get context() {
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
    }
    return this._audioContext;
  }

  public get sourceNode() {
    return this._sourceNode;
  }

  public get deviceId() {
    return this.activeDeviceId;
  }

  /**
   * Enumerates available audio input devices.
   */
  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput' && d.deviceId);
    } catch (e) {
      console.error("Error enumerating devices", e);
      return [];
    }
  }

  /**
   * Requests initial microphone permission.
   * Immediately stops the stream to just grant the permission in the browser.
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (err) {
      console.error('Permission denied or error:', err);
      return false;
    }
  }

  /**
   * Starts an audio stream for the specific device ID.
   * Enforces strict constraints: no AGC, no noise suppression, no echo cancellation.
   */
  async startStream(deviceId: string): Promise<AudioContext> {
    const ctx = this.context;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn('Failed to resume AudioContext:', e);
      }
    }

    // If we are already running this device, return current context
    if (this.activeDeviceId === deviceId && this.activeStream?.active && this._sourceNode) {
      return ctx;
    }

    // Stop existing if any
    this.stopStream();

    const constraints = {
      audio: {
        deviceId: { exact: deviceId },
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: false,
        channelCount: 1
      }
    };

    try {
      this.activeStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn(`Exact deviceId constraint failed for ${deviceId}, trying fallback...`, err);
      // Fallback without 'exact' if specific failed (rare, but good safety)
      const fallbackConstraints = {
        audio: {
          deviceId: deviceId,
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
          channelCount: 1
        }
      };
      this.activeStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }

    this.activeDeviceId = deviceId;

    this._sourceNode = ctx.createMediaStreamSource(this.activeStream);

    return ctx;
  }

  /**
   * Stops the currently active stream.
   */
  stopStream() {
    this._sourceNode?.disconnect();
    this._sourceNode = null;

    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }
    this.activeDeviceId = null;
  }
}

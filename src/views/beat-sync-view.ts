
import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { BeatSyncVisualizer } from './beat-sync/visualizer';
import { AudioToClockRunner } from '../beatsync/audio_to_clock_runner';
import { globalStyles } from '../styles';

@customElement('beat-sync-view')
export class BeatSyncView extends MobxLitElement {
  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background-color: var(--bg-color);
        color: var(--text-color);
        overflow-y: auto;
        overflow-x: hidden;
      }

      .header {
        padding: 20px;
        background-color: var(--panel-header-bg);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
      }

      .title {
        font-size: 1.2em;
        font-weight: bold;
        margin-bottom: 10px;
        color: var(--text-color);
      }

      .content {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        width: 100%;
        box-sizing: border-box;
      }

      .device-selector {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }

      .chip {
        padding: 6px 12px;
        background-color: var(--button-bg);
        border-radius: 16px;
        font-size: 0.9em;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
      }

      .chip:hover {
        background-color: var(--button-hover);
        border-color: var(--border-color);
        color: var(--text-color);
      }

      .chip.selected {
        background-color: var(--selection-color);
        border-color: var(--selection-border);
        color: var(--text-color);
      }

      .chip i {
        font-size: 1.2em;
      }

      .container {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: flex-start;
      }

      .viz-container {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .viz-column {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .viz-text-summaries {
        min-width: 200px;
        background-color: var(--panel-bg);
        padding: 15px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.9em;
      }

      .viz-text-summaries div {
        margin-bottom: 4px;
      }

      canvas {
        background-color: #282828;
        border-radius: 4px;
        border: 1px solid var(--border-color);
      }

      label {
        margin-top: 5px;
        margin-bottom: 2px;
        font-size: 12px;
        color: var(--text-muted);
        text-align: center;
        width: 100%;
        display: block;
      }

      .graph-container {
        position: relative;
        width: 100%;
        max-width: 800px;
      }

      .large-graph {
        width: 100%;
        height: 100px;
      }

      .clock-graph {
        width: 150px;
        height: 150px;
      }

      .waveform-wrapper {
        position: relative;
        width: 100%;
        max-width: 800px;
      }

      .graph-label {
        position: absolute;
        font-size: 10px;
        color: #b3b3b3;
        pointer-events: none;
      }
      .graph-label.top { top: 4px; }
      .graph-label.middle { top: 50%; transform: translateY(-50%); }
      .graph-label.bottom { bottom: 4px; }
      .graph-label.right { right: 4px; }

      .status-message {
        margin-top: 10px;
        font-size: 0.9em;
        color: var(--accent-color);
        opacity: 0.8;
      }
    `
  ];

  @query('#mainWaveform') private mainWaveformCanvas!: HTMLCanvasElement;
  @query('#odfGraph') private odfCanvas!: HTMLCanvasElement;
  @query('#specGraph') private specCanvas!: HTMLCanvasElement;
  @query('#phaseClock') private phaseClockCanvas!: HTMLCanvasElement;
  @query('#barClock') private barClockCanvas!: HTMLCanvasElement;
  @query('#trajectoryClock') private trajectoryClockCanvas!: HTMLCanvasElement;
  @query('#bpmGraph') private bpmGraphCanvas!: HTMLCanvasElement;
  @query('#phaseGraph') private phaseGraphCanvas!: HTMLCanvasElement;

  @state() private loadingMessage = 'Initializing...';
  @state() private predictedBpm: number = 0;
  @state() private bestBpm: number = 0;
  @state() private bestBarPhase: number = 0;
  @state() private externalBpm: number = 0;
  @state() private audioDevices: MediaDeviceInfo[] = [];
  @state() private isMicActive = false;
  @state() private selectedDeviceId: string | null = null;
  @state() private overallConfidence: number = 0;
  @state() private bestTrajectoryWeight: number = 0;
  @state() private bpmVariance: number = 0;

  private audioContext?: AudioContext;
  private mainAudioBuffer?: AudioBuffer;
  private audioCaptureNode: ScriptProcessorNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private rollingWaveformBuffer: Float32Array | null = null;
  private animationFrameId: number | null = null;
  private audioToClock?: AudioToClockRunner;
  private visualizer!: BeatSyncVisualizer;

  async firstUpdated() {
    this.visualizer = new BeatSyncVisualizer({
      mainWaveformCanvas: this.mainWaveformCanvas,
      odfCanvas: this.odfCanvas,
      specCanvas: this.specCanvas,
      phaseClockCanvas: this.phaseClockCanvas,
      barClockCanvas: this.barClockCanvas,
      trajectoryClockCanvas: this.trajectoryClockCanvas,
      bpmGraphCanvas: this.bpmGraphCanvas,
      phaseGraphCanvas: this.phaseGraphCanvas,
    });

    this.loadingMessage = 'Loading models...';
    // Use proper paths for models relative to public assets
    this.audioToClock = new AudioToClockRunner({
      featureExtractorUrl: 'models/mel25/feature_extractor_fp32.onnx',
      bpmPhaseModelUrl: 'models/mel25/main_model_fp32.onnx',

      exportAllDebugData: true,

      onStatusUpdated: (status) => {
        this.loadingMessage = status.message;
      },
      onExternalClockAdjusted: (changes) => {
        if (changes.bpm) {
          this.externalBpm = changes.bpm;
        }
      },
      onDebugDataExported: (updates) => {
        if (updates.inference) {
          this.predictedBpm = updates.inference.bpm;
          this.visualizer.updateInference(updates.inference);
        }
        if (updates.stabilizer) {
          this.visualizer.updateStabilizer(updates.stabilizer);
          const bestTraj = updates.stabilizer.bestTrajectory;
          if (bestTraj) {
            this.bestBpm = bestTraj.bpm;
            this.bestBarPhase = bestTraj.barPhase;
          }
          this.overallConfidence = updates.stabilizer.overallConfidence;
          this.bpmVariance = updates.stabilizer.bpmVariance;
          this.bestTrajectoryWeight = bestTraj ? bestTraj.weight : 0;
        }
        if (updates.externalClock) {
          this.visualizer.updateExternalClock(updates.externalClock);
        }
        if (updates.externalClockEvent) {
          this.visualizer.addExternalClockHistory(updates.externalClockEvent);
        }
      },
    });

    this.audioContext = new AudioContext();
    this.visualizer.setAudioContext(this.audioContext);

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter(d => d.kind === 'audioinput' && d.deviceId);
      if (this.audioDevices.length > 0) {
        // Don't auto-select, let user choose to start
      }
    } catch (e) {
      console.error("Error enumerating devices", e);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.handleStopMic();
    this.audioContext?.close();
  }

  private setupAudioGraph(sourceElement: MediaStream) {
    if (!this.audioContext) return;

    if (this.audioCaptureNode) {
      this.audioCaptureNode.disconnect();
    }
    if (this.micSource) {
      this.micSource.disconnect();
    }

    this.micSource = this.audioContext.createMediaStreamSource(sourceElement);
    const source = this.micSource;

    this.audioCaptureNode = this.audioContext.createScriptProcessor(1024, 1, 1);

    this.audioCaptureNode.onaudioprocess = (audioProcessingEvent) => {
      if (!this.isMicActive) {
        return;
      }
      const inputBuffer = audioProcessingEvent.inputBuffer;
      const channelData = [];
      for (let i = 0; i < inputBuffer.numberOfChannels; i++) {
        channelData.push(inputBuffer.getChannelData(i));
      }
      this.audioToClock?.addAudio(channelData, this.audioContext?.currentTime ?? 0.0, this.audioContext?.sampleRate ?? 0);

      const inputData = inputBuffer.getChannelData(0);
      if (!this.rollingWaveformBuffer) {
        this.rollingWaveformBuffer = new Float32Array(this.audioContext?.sampleRate ?? 44100); // 1 second buffer
      }
      const bufferLength = this.rollingWaveformBuffer.length;
      const newLength = inputData.length;
      this.rollingWaveformBuffer.copyWithin(0, newLength);
      this.rollingWaveformBuffer.set(inputData, bufferLength - newLength);
      this.visualizer.updateRollingWaveform(this.rollingWaveformBuffer);
    };

    source.connect(this.audioCaptureNode);
    this.audioCaptureNode.connect(this.audioContext.destination);
  }

  private animationLoop() {
    if (!this.isMicActive) {
      return;
    }
    this.visualizer.updateVisualizations(this.bestBpm, this.overallConfidence, this.bestTrajectoryWeight);
    this.animationFrameId = requestAnimationFrame(() => this.animationLoop());
  }

  private async selectDevice(deviceId: string) {
    if (this.selectedDeviceId === deviceId && this.isMicActive) {
      await this.handleStopMic();
      this.selectedDeviceId = null;
      return;
    }

    // Stop current if any
    if (this.isMicActive) {
      await this.handleStopMic();
    }

    this.selectedDeviceId = deviceId;
    await this.handleStartMic(deviceId);
  }

  private async requestPermissions() {
    try {
      // Requesting generic audio access to trigger permission prompt
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Once granted, stop the stream immediately
      stream.getTracks().forEach(t => t.stop());

      // Re-enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter(d => d.kind === 'audioinput' && d.deviceId);
    } catch (err) {
      console.error('Permission denied or error:', err);
      this.loadingMessage = 'Permission denied. Please allow microphone access.';
    }
  }

  private async handleStartMic(deviceId: string) {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }

    try {
      // Try exact constraint first
      const constraints = { audio: { deviceId: { exact: deviceId } } };
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('Exact deviceId constraint failed, trying ideal...', err);
      try {
        // Fallback to ideal constraint
        const constraints = { audio: { deviceId: deviceId } };
        this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (retryErr) {
        console.error('Error accessing microphone:', retryErr);
        this.loadingMessage = 'Error accessing microphone.';
        return;
      }
    }

    this.isMicActive = true;
    this.setupAudioGraph(this.micStream);
    if (this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(() => this.animationLoop());
    }
  }

  private async handleStopMic() {
    this.micStream?.getTracks().forEach(track => track.stop());
    this.isMicActive = false;
    this.micSource?.disconnect();
    this.micStream = null;
    this.micSource = null;
    this.rollingWaveformBuffer = null;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Clear the waveform
    const ctx = this.mainWaveformCanvas?.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.mainWaveformCanvas.width, this.mainWaveformCanvas.height);
    }
  }

  render() {
    return html`
      <div class="header">
        <div class="title">Beat Synchronization</div>
        <div>Select Input Device</div>
        <div class="device-selector">
          ${this.audioDevices.map(device => html`
            <div
              class="chip ${this.selectedDeviceId === device.deviceId && this.isMicActive ? 'selected' : ''}"
              @click=${() => this.selectDevice(device.deviceId)}
            >
              <i class="la ${this.selectedDeviceId === device.deviceId && this.isMicActive ? 'la-microphone' : 'la-microphone-slash'}"></i>
              ${device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
            </div>
          `)}
          ${this.audioDevices.length === 0 ? html`
            <div class="chip" @click=${this.requestPermissions}>
              <i class="la la-unlock"></i> Request Microphone Access
            </div>
            <div>No Audio Inputs Found</div>
          ` : ''}
        </div>
        <div class="status-message">${this.loadingMessage}</div>
      </div>

      <div class="content">
        <div class="viz-container">
            <div class="viz-text-summaries">
                <div><b>SEND BPM:</b> ${this.externalBpm.toFixed(1)}</div>
                <div><b>Best BPM:</b> ${this.bestBpm.toFixed(1)}</div>
                <div><b>Bar Phase:</b> ${this.bestBarPhase.toFixed(1)}</div>
                <div><b>Raw BPM:</b> ${this.predictedBpm.toFixed(1)}</div>
                <div><b>Confidence:</b> ${this.overallConfidence.toFixed(2)}</div>
                <div><b>BPM Variance:</b> ${this.bpmVariance.toFixed(2)}</div>
                <div><b>Traj. Weight:</b> ${this.bestTrajectoryWeight.toFixed(2)}</div>
            </div>

            <div class="viz-column">
              <canvas id="barClock" class="clock-graph" width="200" height="200"></canvas>
              <label>Bar Phase</label>
            </div>
            <div class="viz-column">
              <canvas id="trajectoryClock" class="clock-graph" width="200" height="200"></canvas>
              <label>Trajectories</label>
            </div>
            <div class="viz-column">
              <canvas id="phaseClock" class="clock-graph" width="200" height="200"></canvas>
              <label>Raw Phase</label>
            </div>
        </div>

        <div class="graph-container">
            <label class="graph-label top right">${(this.visualizer?.bpmGraphCenterBpm + 3.0).toFixed(1)}</label>
            <label class="graph-label middle right">${this.externalBpm.toFixed(1)}</label>
            <label class="graph-label bottom right">${(this.visualizer?.bpmGraphCenterBpm - 3.0).toFixed(1)}</label>
            <canvas id="bpmGraph" class="large-graph" width="800" height="100"></canvas>
            <label>BPM Predictions</label>
        </div>

        <div class="graph-container">
            <canvas id="phaseGraph" class="large-graph" width="800" height="100"></canvas>
            <label>Phase Predictions</label>
        </div>

        <div class="graph-container">
            <canvas id="odfGraph" class="large-graph" width="800" height="100"></canvas>
            <label>ODF Features</label>
        </div>

        <div class="graph-container">
             <canvas id="specGraph" class="large-graph" width="800" height="100"></canvas>
             <canvas id="mainWaveform" class="large-graph" width="800" height="100"></canvas>
             <label>Input Spectrogram & Waveform</label>
        </div>
      </div>
    `;
  }
}

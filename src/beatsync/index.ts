import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { Visualizer } from './visualizer';
import { AudioToClockRunner } from './audio_to_clock_runner';

@customElement('hyrax-app')
export class App extends MobxLitElement {
  static readonly styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      font-family: 'Questrial', sans-serif;
      color: #e0e0e0;
      background-color: #121212;
      width: 100%;
      box-sizing: border-box;
    }
    h1 {
      font-weight: normal;
    }
    #controls {
      margin: 20px;
    }
    button {
      background-color: #1db954;
      color: white;
      border: none;
      padding: 10px 20px;
      font-size: 16px;
      cursor: pointer;
      border-radius: 2px;
      margin: 5px;
    }
    button:hover {
      background-color: #1ed760;
    }
    canvas {
      background-color: #282828;
      border-radius: 2px;
      margin: 10px 0;
    }
    .container {
      display: flex;
      justify-content: space-around;
      width: 100%;
      max-width: 1200px;
      align-items: flex-start;
    }
    .waveform-container, .viz-container {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .graph-container {
      position: relative;
    }
    .graph-label {
      position: absolute;
      font-size: 12px;
      color: #b3b3b3;
    }
    .graph-label.top {
      top: 1em;
    }
    .graph-label.middle {
      top: 50%;
      transform: translate(0, -50%);
    }
    .graph-label.bottom {
      bottom: 1em;
    }
    .graph-label.left {
      left: 2px;
    }
    .graph-label.center-right {
      left: calc(50% + 2px);
    }
    .graph-label.right {
      right: 2px;
    }
    .viz-container {
      flex-direction: row;
      gap: 20px;
    }
    .viz-container > div {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .viz-text-summaries {
      min-width: 200px;
    }
    label {
      margin-top: 10px;
      font-size: 14px;
      color: #b3b3b3;
    }
    .external-send {
      color: #ff00ff;
    }
    .waveform-wrapper {
      position: relative;
    }
    #playback-head {
      position: absolute;
      top: 10px;
      left: 0;
      width: 2px;
      height: 150px;
      background-color: white;
      pointer-events: none;
    }
  `;

  @query('#mainWaveform')
  private mainWaveformCanvas!: HTMLCanvasElement;

  @query('#odfGraph')
  private odfCanvas!: HTMLCanvasElement;
  @query('#specGraph')
  private specCanvas!: HTMLCanvasElement;

  @query('#phaseClock')
  private phaseClockCanvas!: HTMLCanvasElement;

  @query('#barClock')
  private barClockCanvas!: HTMLCanvasElement;

  @query('#trajectoryClock')
  private trajectoryClockCanvas!: HTMLCanvasElement;

  @query('#bpmGraph')
  private bpmGraphCanvas!: HTMLCanvasElement;

  @query('#phaseGraph')
  private phaseGraphCanvas!: HTMLCanvasElement;

  @state() private loadingMessage = 'Initializing...';
  @state() private predictedBpm: number = 0;
  @state() private bestBpm: number = 0;
  @state() private bestBarPhase: number = 0;
  @state() private externalBpm: number = 0;
  @state() private audioDevices: MediaDeviceInfo[] = [];
  @state() private isMicActive = false;
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
  private visualizer!: Visualizer;

  async firstUpdated() {
    this.visualizer = new Visualizer({
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

    navigator.mediaDevices.enumerateDevices().then(devices => {
      this.audioDevices = devices.filter(d => d.kind === 'audioinput');
    });
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

  private async handleStartMic() {
    if (this.isMicActive) return;
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }

    const selectedDeviceId = (this.shadowRoot?.querySelector('#micSelect') as HTMLSelectElement)?.value;
    const constraints = { audio: { deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined } };

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.isMicActive = true;
      this.setupAudioGraph(this.micStream);
      if (this.animationFrameId === null) {
        this.animationFrameId = requestAnimationFrame(() => this.animationLoop());
      }
    } catch (err) {
      console.error('Error accessing microphone:', err);
      this.loadingMessage = 'Error accessing microphone.';
    }
  }

  private handleStopMic() {
    if (!this.isMicActive) return;

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
    const ctx = this.mainWaveformCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.mainWaveformCanvas.width, this.mainWaveformCanvas.height);
    // Redraw original waveform
    if (this.mainAudioBuffer) {
      this.visualizer.drawWaveform(this.mainWaveformCanvas.getContext('2d')!, this.mainAudioBuffer.getChannelData(0));
    }
  }

  private handleDeviceChange(e: Event) {
    if (this.isMicActive) {
      this.handleStopMic();
      this.handleStartMic();
    }
  }

  render() {
    return html`
      <div id="controls">
        ${!this.isMicActive
        ? html`<button @click=${this.handleStartMic}>Start</button>`
        : html`<button @click=${this.handleStopMic}>Stop</button>`
      }
        <select id="micSelect" @change=${this.handleDeviceChange}>
          ${this.audioDevices.map(device => html`<option value=${device.deviceId}>${device.label}</option>`)}
        </select>
      </div>

      <div class="container">
        <div class="waveform-container">
          <div class="viz-container">
            <div class="viz-text-summaries">
              <div style="margin-bottom: 1em;"><b>SEND BPM:</b> ${this.externalBpm.toFixed(1)}</div>
              <div><b>Best BPM:</b> ${this.bestBpm.toFixed(1)}</div>
              <div><b>Best Bar Phase:</b> ${this.bestBarPhase.toFixed(1)}</div>
              <div><b>Raw BPM:</b> ${this.predictedBpm.toFixed(1)}</div>
              <div><b>Confidence:</b> ${this.overallConfidence.toFixed(2)}</div>
              <div><b>BPM Variance:</b> ${this.bpmVariance.toFixed(2)}</div>
              <div><b>Best Traj. Weight:</b> ${this.bestTrajectoryWeight.toFixed(2)}</div>
              <div style="margin-top: 1em;">${this.loadingMessage}</div>
            </div>
            <div>
              <label for="barClock">Bar Phase</label>
              <canvas id="barClock" width="200" height="200"></canvas>
            </div>
            <div>
              <label for="trajectoryClock">Test Trajectories</label>
              <canvas id="trajectoryClock" width="200" height="200"></canvas>
            </div>
            <div>
              <label for="phaseClock">Raw Phase Prediction</label>
              <canvas id="phaseClock" width="200" height="200"></canvas>
            </div>
          </div>

          <label for="bpmGraph">BPM Predictions</label>
          <div class="graph-container">
            <div class="graph-label top center-right">${(this.visualizer?.bpmGraphCenterBpm + 6.0 * 0.5).toFixed(1)}</div>
            <div class="graph-label middle center-right external-send">${this.externalBpm.toFixed(1)}</div>
            <div class="graph-label bottom center-right">${(this.visualizer?.bpmGraphCenterBpm - 6.0 * 0.5).toFixed(1)}</div>
            <canvas id="bpmGraph" width="800" height="100"></canvas>
          </div>
          <label for="phaseGraph">Phase Predictions</label>
          <canvas id="phaseGraph" width="800" height="100"></canvas>
          <label for="odfGraph">ODF Features</label>
          <canvas id="odfGraph" width="800" height="100"></canvas>
          <canvas id="specGraph" width="800" height="100"></canvas>
          <label for="mainWaveform">${'Input'}</label>
          <div class="waveform-wrapper">
            <canvas id="mainWaveform" width="800" height="150"></canvas>
          </div>
        </div>
      </div>
    `;
  }
}

document.body.innerHTML = '<hyrax-app></hyrax-app>';

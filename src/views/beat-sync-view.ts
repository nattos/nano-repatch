
import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { BeatSyncVisualizer } from './beat-sync/visualizer';
import { globalStyles } from '../styles';
import { runtimeManager } from '../builder/controllers';

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

  private animationFrameId: number | null = null;
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

    if (this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(() => this.animationLoop());
    }
  }

  connectedCallback() {
    super.connectedCallback();
    runtimeManager.beatSyncManager.setDebugDataEnabled(true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    runtimeManager.beatSyncManager.setDebugDataEnabled(false);

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private animationLoop() {
    const manager = runtimeManager.beatSyncManager;

    if (!this.visualizer.hasAudioContext && manager.audioContextInstance) {
      this.visualizer.setAudioContext(manager.audioContextInstance);
    }

    // Sync visualizer with Manager
    if (manager.lastInferenceUpdate) {
      this.visualizer.updateInference(manager.lastInferenceUpdate);
    }
    if (manager.lastStabilizerUpdate) {
      this.visualizer.updateStabilizer(manager.lastStabilizerUpdate);
    }
    if (manager.lastExternalClockUpdate) {
      this.visualizer.updateExternalClock(manager.lastExternalClockUpdate);
    }
    if (manager.lastExternalClockEvent) {
      this.visualizer.addExternalClockHistory(manager.lastExternalClockEvent);
    }
    if (manager.rollingWaveformBuffer) {
      this.visualizer.updateRollingWaveform(manager.rollingWaveformBuffer);
    }

    this.visualizer.updateVisualizations(manager.bestBpm, manager.overallConfidence, manager.bestTrajectoryWeight);
    this.animationFrameId = requestAnimationFrame(() => this.animationLoop());
  }

  private stallMainThread() {
    const start = performance.now();
    while (performance.now() < start + 2000) {
      // Blocking loop
    }
    console.log("Main thread stalled for 2 seconds");
  }

  render() {
    const manager = runtimeManager.beatSyncManager;
    const { audioDevices, selectedDeviceId, isMicActive, loadingMessage,
      externalBpm, bestBpm, bestBarPhase, predictedBpm, overallConfidence, bpmVariance, bestTrajectoryWeight } = manager;

    return html`
      <div class="header">
        <div class="title">Beat Synchronization</div>
        <div>Select Input Device</div>
        <div class="device-selector">
          ${audioDevices.map(device => html`
            <div
              class="chip ${selectedDeviceId === device.deviceId && isMicActive ? 'selected' : ''}"
              @click=${() => manager.startMic(device.deviceId)}
            >
              <i class="la ${selectedDeviceId === device.deviceId && isMicActive ? 'la-microphone' : 'la-microphone-slash'}"></i>
              ${device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
            </div>
          `)}
          ${audioDevices.length === 0 ? html`
            <div class="chip" @click=${() => manager.requestPermissions()}>
              <i class="la la-unlock"></i> Request Microphone Access
            </div>
            <div>No Audio Inputs Found</div>
          ` : ''}
        </div>
        <div class="status-message">${loadingMessage}</div>
        <button @click=${() => this.stallMainThread()}>Stall Main Thread (2s)</button>
      </div>

      <div class="content">
        <div class="viz-container">
            <div class="viz-text-summaries">
                <div><b>SEND BPM:</b> ${externalBpm.toFixed(1)}</div>
                <div><b>Best BPM:</b> ${bestBpm.toFixed(1)}</div>
                <div><b>Bar Phase:</b> ${bestBarPhase.toFixed(1)}</div>
                <div><b>Raw BPM:</b> ${predictedBpm.toFixed(1)}</div>
                <div><b>Confidence:</b> ${overallConfidence.toFixed(2)}</div>
                <div><b>BPM Variance:</b> ${bpmVariance.toFixed(2)}</div>
                <div><b>Traj. Weight:</b> ${bestTrajectoryWeight.toFixed(2)}</div>
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
            <label class="graph-label middle right">${externalBpm.toFixed(1)}</label>
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

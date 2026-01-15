
import { MobxLitElement } from './mobx-lit-element';
import { reaction, IReactionDisposer } from 'mobx';
import { css, html } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { BeatSyncVisualizer } from './beat-sync/visualizer';
import { globalStyles } from '../styles';
import { runtimeManager } from '../builder/controllers';
import './ui-option-bar';

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
        min-width: 180px; /* Was 200px */
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
        max-width: 100%; /* Was 800px */
      }

      .large-graph {
        width: 100%;
        height: 80px; /* Was 100px */
      }

      .clock-graph {
        width: 120px; /* Was 150px */
        height: 120px;
      }

      .waveform-wrapper {
        position: relative;
        width: 100%;
        max-width: 100%;
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



      .action-button {
        padding: 6px 12px;
        background-color: var(--button-bg);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        color: var(--text-color);
        cursor: pointer;
        font-size: 0.9em;
      }

      .action-button:hover {
        background-color: var(--button-hover);
      }
      .resync-btn.large {
        height: 60px;
        font-size: 16px;
        font-weight: bold;
        background: var(--accent-color);
        color: white;
        border: none;
        margin-bottom: 8px;
        width: 100%;
        display: block;
      }

      .midi-mapping-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
      }

      .midi-learn-btn {
        background: transparent;
        border: 1px solid var(--text-color);
        color: var(--text-color);
        font-size: 10px;
        padding: 2px 6px;
        cursor: pointer;
        border-radius: 4px;
        opacity: 0.7;
      }

      .midi-learn-btn:hover {
        opacity: 1.0;
        background: rgba(255,255,255,0.1);
      }

      .midi-learn-btn.pulsing {
        animation: pulse-red 1s infinite;
        border-color: #ff4444;
        color: #ff4444;
        opacity: 1;
      }

      .midi-mapping-label {
        font-size: 10px;
        background: rgba(255,255,255,0.1);
        padding: 2px 6px;
        border-radius: 4px;
        cursor: pointer;
      }

      @keyframes pulse-red {
        0% { opacity: 0.5; }
        50% { opacity: 1; }
        100% { opacity: 0.5; }
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
  private loopDisposer: IReactionDisposer | null = null;

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

    // Start loop if already active
    if (runtimeManager.beatSyncManager.isMicActive && this.animationFrameId === null) {
      this.animationLoop();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    runtimeManager.beatSyncManager.setDebugDataEnabled(true);

    this.loopDisposer = reaction(
      () => runtimeManager.beatSyncManager.isMicActive,
      (active) => {
        if (active && this.animationFrameId === null && this.visualizer) {
          this.animationLoop();
        }
      }
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    runtimeManager.beatSyncManager.setDebugDataEnabled(false);

    if (this.loopDisposer) {
      this.loopDisposer();
      this.loopDisposer = null;
    }

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private animationLoop() {
    const manager = runtimeManager.beatSyncManager;

    if (!manager.isMicActive) {
      this.animationFrameId = null;
      return;
    }

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

  private renderMidiMapping(manager: any) {
    const mapping = manager.midiMapping;
    if (!mapping) return null;

    let label = '';
    if (mapping.type === 'note') {
      label = `Note ${mapping.index} (Ch${mapping.channel})`;
    } else {
      label = `CC ${mapping.index} (Ch${mapping.channel})`;
    }

    return html`
      <span
        class="midi-mapping-label chip"
        @dblclick=${() => manager.clearMidiMapping()}
        title="Double click to clear"
      >
        ${label}
      </span>
    `;
  }

  render() {
    const manager = runtimeManager.beatSyncManager;
    const { audioDevices, selectedDeviceId, isMicActive, loadingMessage,
      externalBpm, bestBpm, bestBarPhase, predictedBpm, overallConfidence, bpmVariance, bestTrajectoryWeight } = manager;

    return html`
      <div class="header">
        <div class="title">Audio Beat Sync</div>
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
        <div style="margin-top: 10px; display: flex; align-items: center; gap: 10px;">
           <label style="display: inline-flex; width: auto; align-items: center; gap: 5px; cursor: pointer;">
             <input type="checkbox"
               .checked=${manager.localControllerInstance.observableState.localSettings.beatSyncResolumeControlEnabled}
               @change=${(e: any) => manager.setResolumeControlEnabled(e.target.checked)}
             >
             Control Resolume BPM/Phase
           </label>
        </div>

        <div style="margin-top: 10px; display: flex; align-items: center;">
            <button class="action-button" @pointerdown=${() => manager.resync()}>
                <i class="la la-sync"></i> Resync
            </button>
            <ui-option-bar
                .value=${manager.isHardSync ? 'Hard' : 'Soft'}
                .options=${[{ label: 'Soft', value: 'Soft' }, { label: 'Hard', value: 'Hard' }]}
                @change=${(e: CustomEvent) => manager.setHardSync(e.detail.value === 'Hard')}
                style="margin-right: 10px;"
            ></ui-option-bar>
            <div class="midi-mapping-controls">
                <button
                  class="midi-learn-btn ${classMap({ pulsing: manager.isMidiMappingActive })}"
                  @click=${() => manager.toggleMidiDoLearn()}
                  title=${manager.isMidiMappingActive ? 'Listening for MIDI...' : 'Click to map MIDI'}
                >
                  MIDI
                </button>
                ${this.renderMidiMapping(manager)}
            </div>
          </div>
        </div>

        <div class="monitor-section">
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
              <canvas id="barClock" class="clock-graph" width="240" height="240"></canvas>
              <label>Bar Phase</label>
            </div>
            <div class="viz-column">
              <canvas id="trajectoryClock" class="clock-graph" width="240" height="240"></canvas>
              <label>Trajectories</label>
            </div>
            <div class="viz-column">
              <canvas id="phaseClock" class="clock-graph" width="240" height="240"></canvas>
              <label>Raw Phase</label>
            </div>
        </div>

        <div class="graph-container">
            <label class="graph-label top right">${(this.visualizer?.bpmGraphCenterBpm + 3.0).toFixed(1)}</label>
            <label class="graph-label middle right">${externalBpm.toFixed(1)}</label>
            <label class="graph-label bottom right">${(this.visualizer?.bpmGraphCenterBpm - 3.0).toFixed(1)}</label>
            <canvas id="bpmGraph" class="large-graph" width="600" height="80"></canvas>
            <label>BPM Predictions</label>
        </div>

        <div class="graph-container">
            <canvas id="phaseGraph" class="large-graph" width="600" height="80"></canvas>
            <label>Phase Predictions</label>
        </div>

        <div class="graph-container">
            <canvas id="odfGraph" class="large-graph" width="600" height="80"></canvas>
            <label>ODF Features</label>
        </div>

        <div class="graph-container">
             <canvas id="specGraph" class="large-graph" width="600" height="80"></canvas>
             <canvas id="mainWaveform" class="large-graph" width="600" height="80"></canvas>
             <label>Input Spectrogram & Waveform</label>
        </div>
      </div>
    `;
  }
}

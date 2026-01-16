
import { MobxLitElement } from './mobx-lit-element';
import { reaction, IReactionDisposer } from 'mobx';
import { css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { BeatSyncVisualizer } from './beat-sync/visualizer';
import { globalStyles, animations } from '../styles';
import { runtimeManager } from '../builder/controllers';
import './ui-option-bar';

@customElement('beat-sync-view')
export class BeatSyncView extends MobxLitElement {
  static styles = [
    globalStyles,
    animations,
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
        padding: 12px 20px;
        background-color: var(--panel-header-bg);
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .header-row {
        display: flex;
        align-items: center;
        gap: 12px;
        position: relative;
      }

      .controls-row {
         display: flex;
         align-items: center;
         justify-content: space-between;
      }

      /* Inline Device List */
      .inline-device-list {
         margin-top: 12px;
         display: flex;
         flex-wrap: wrap;
         gap: 8px;
         padding: 12px;
         background: var(--bg-color); /* Slightly darker/lighter background to distinguish? */
         border: 1px solid var(--border-color);
         border-radius: 4px;
      }

      .title {
        font-size: 1.2em;
        font-weight: bold;
        color: var(--text-color);
        margin: 0;
      }

      .content {
        padding: 0; /* Clear old padding */
        display: flex;
        flex-direction: column;
        width: 100%;
        box-sizing: border-box;
      }

      .monitor-section {
         padding: 16px;
         display: flex;
         flex-direction: column;
         gap: 20px;
         box-sizing: border-box;
      }

      .container {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: flex-start;
      }

      .viz-container {
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
        align-items: flex-start;
      }

      .viz-clocks {
         display: flex;
         gap: 12px;
      }

      .viz-column {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .viz-text-summaries {
        min-width: 180px;
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
        width: 80px;
        height: 80px;
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
      }

      .controls-right-col {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-left: 12px;
          align-items: flex-start;
      }

      .controls-row {
          display: flex;
          align-items: center;
      }

      .resync-btn {
        height: 100%;
        min-height: 52px;
        font-size: 1.1em;
        font-weight: bold;
        padding: 0 16px;
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

  @query('.resync-btn') private resyncBtn!: HTMLButtonElement;

  @state() private isDeviceListOpen = false;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;
  private visualizer!: BeatSyncVisualizer;
  private loopDisposer: IReactionDisposer | null = null;
  private resyncDisposer: IReactionDisposer | null = null;

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

    // Setup ResizeObserver for large graphs
    this.setupResizeObserver();

    // Start loop if already active
    if (runtimeManager.beatSyncManager.isMicActive && this.animationFrameId === null) {
      this.animationLoop();
    }
  }

  private setupResizeObserver() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLCanvasElement;
        const { width } = entry.contentRect;
        // Adjust canvas internal resolution to match display width * dpr
        // But keep height fixed/controlled by CSS?
        // CSS height is 80px.
        // We only care about width matching container.
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = width;
        const displayHeight = target.clientHeight; // Reads CSS height

        // Avoid resizing if close enough to prevent flicker loop?
        // Actually, Visualizer draws every frame, so resizing just clears buffer.
        // Drawing happens next frame.
        if (target.width !== Math.round(displayWidth * dpr)) {
          target.width = Math.round(displayWidth * dpr);
        }
        // Height is typically fixed for these graphs, but let's sync it too
        if (target.height !== Math.round(displayHeight * dpr)) {
          target.height = Math.round(displayHeight * dpr);
        }
      }
    });

    // Observe large graphs
    const canvases = [
      this.mainWaveformCanvas, this.odfCanvas, this.specCanvas,
      this.bpmGraphCanvas, this.phaseGraphCanvas
    ];
    canvases.forEach(c => {
      if (c) this.resizeObserver?.observe(c);
    });
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

    // Flash Animation Trigger
    this.resyncDisposer = reaction(
      () => runtimeManager.beatSyncManager.lastResyncTime,
      () => {
        if (this.resyncBtn) {
          this.resyncBtn.classList.remove('flashing');
          void this.resyncBtn.offsetWidth; // Force Reflow
          this.resyncBtn.classList.add('flashing');

          // Cleanup on animation end
          const handler = () => {
            this.resyncBtn.classList.remove('flashing');
            this.resyncBtn.removeEventListener('animationend', handler);
          };
          this.resyncBtn.addEventListener('animationend', handler);
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

    if (this.resyncDisposer) {
      this.resyncDisposer();
      this.resyncDisposer = null;
    }

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.resizeObserver?.disconnect();
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
    const { audioDevices, selectedDeviceId, isMicActive, systemEnabled,
      externalBpm, bestBpm, bestBarPhase, predictedBpm, overallConfidence, bpmVariance, bestTrajectoryWeight } = manager;

    const currentDevice = audioDevices.find(d => d.deviceId === selectedDeviceId);
    const deviceLabel = currentDevice ? (currentDevice.label || `Microphone ${currentDevice.deviceId.slice(0, 5)}...`) : 'Select Input';

    return html`
      <div class="header">
        <div class="title">Audio Beat Sync</div>

        <div class="header-row">
            <!-- System Toggle -->
            <ui-option-bar
                .value=${systemEnabled ? 'On' : 'Off'}
                .options=${[{ label: 'Off', value: 'Off' }, { label: 'On', value: 'On' }]}
                @change=${(e: CustomEvent) => manager.setSystemEnabled(e.detail.value === 'On')}
            ></ui-option-bar>

            <!-- Device Selector Chip -->
            <div
                class="chip ${isMicActive ? (systemEnabled ? 'selected' : '') : ''} ${this.isDeviceListOpen ? 'active' : ''}"
                style="cursor: pointer; min-width: 150px; justify-content: space-between;"
                @click=${() => { this.isDeviceListOpen = !this.isDeviceListOpen; }}
            >
                <div style="display: flex; align-items: center; gap: 6px;">
                    <i class="la ${isMicActive ? 'la-microphone' : 'la-microphone-slash'}"></i>
                    ${deviceLabel}
                </div>
                <i class="la ${this.isDeviceListOpen ? 'la-angle-up' : 'la-angle-down'}"></i>
            </div>

            <div style="flex: 1"></div>

             <!-- Resolume Toggle -->
             <ui-option-bar
                .value=${manager.localControllerInstance.observableState.localSettings.beatSyncResolumeControlEnabled ? 'On' : 'Off'}
                .options=${[{ label: 'Resolume Off', value: 'Off' }, { label: 'Resolume On', value: 'On' }]}
                @change=${(e: CustomEvent) => manager.setResolumeControlEnabled(e.detail.value === 'On')}
            ></ui-option-bar>
        </div>

        <!-- Inline Device List -->
        ${this.isDeviceListOpen ? html`
            <div class="inline-device-list">
                ${audioDevices.map(device => html`
                    <div
                        class="chip ${selectedDeviceId === device.deviceId ? 'selected' : ''}"
                        @click=${() => {
        manager.startMic(device.deviceId);
        this.isDeviceListOpen = false;
      }}
                    >
                        ${device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                    </div>
                `)}
                ${audioDevices.length === 0 ? html`<div>No Inputs</div>` : ''}
                <div class="chip" @click=${() => manager.requestPermissions()}>
                        <i class="la la-unlock"></i> Request Access
                </div>
            </div>
        ` : ''}

        <div class="controls-row">
             <button class="action-button resync-btn" @pointerdown=${() => manager.resync()}>
                <i class="la la-sync"></i> Resync
             </button>

             <div class="controls-right-col">
                <ui-option-bar
                    .value=${manager.isHardSync ? 'Hard' : 'Soft'}
                    .options=${[{ label: 'Soft', value: 'Soft' }, { label: 'Hard', value: 'Hard' }]}
                    @change=${(e: CustomEvent) => manager.setHardSync(e.detail.value === 'Hard')}
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

            <div class="viz-clocks">
                <div class="viz-column">
                  <canvas id="barClock" class="clock-graph" width="160" height="160"></canvas>
                  <label>Bar Phase</label>
                </div>
                <div class="viz-column">
                  <canvas id="trajectoryClock" class="clock-graph" width="160" height="160"></canvas>
                  <label>Trajectories</label>
                </div>
                <div class="viz-column">
                  <canvas id="phaseClock" class="clock-graph" width="160" height="160"></canvas>
                  <label>Raw Phase</label>
                </div>
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

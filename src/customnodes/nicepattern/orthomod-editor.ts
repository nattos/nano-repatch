import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GridNode } from '../../builder/state';
import { runtimeManager } from '../../builder/controllers';
import { appController } from '../../builder/controllers';
import { reaction } from 'mobx';

@customElement('nicepattern-orthomod-editor')
export class OrthomodEditor extends LitElement {
  @property({ type: Object }) node!: GridNode;

  @state() private codes: number[][] = [];
  @state() private activeIndex: number = 0;
  @state() private channels: number[] = [0, 0, 0, 0];
  @state() private rawChannels: number[] = [0, 0, 0, 0];
  @state() private envelope: number = 0;
  @state() private gateOpen: boolean = false;

  private cleanup: (() => void) | null = null;
  private animationFrame: number | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #111;
      color: #eee;
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      user-select: none;
      pointer-events: auto; /* Ensure interactivity */
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 6px;
      border-bottom: 1px solid #222;
      background: #080808;
      height: 20px;
      flex-shrink: 0;
    }

    .title {
      font-weight: 800;
      color: #fff;
      font-size: 10px;
      letter-spacing: -0.5px;
      line-height: 1;
    }

    .highlight { color: #ffcc00; }

    .gate-led {
        width: 6px; height: 6px; background: #222; border-radius: 50%;
        margin-right: 4px;
        transition: background 0.05s, box-shadow 0.05s;
    }
    .gate-led.on { background: #fff; box-shadow: 0 0 6px #fff; }

    /* Visualizer Area */
    .visualizer {
      flex: 1;
      display: flex;
      flex-direction: column; /* Stacked Vertically */
      border-bottom: 1px solid #222;
      min-height: 200px;
    }

    /* Matrix */
    .matrix {
      flex: 1; /* Take remaining space */
      width: 100%;
      display: flex;
      flex-direction: column;
      background: #000;
    }

    .matrix-row {
      flex: 1;
      display: flex;
      border-bottom: 1px solid #111;
      opacity: 0.5;
      border-left: 2px solid transparent; /* Reserve space for active border */
      box-sizing: border-box;
    }
    .matrix-row.active {
      opacity: 1.0;
      background: rgba(255, 204, 0, 0.15);
      border-left: 2px solid #ffcc00;
    }

    .bit {
      flex: 1;
      border-right: 1px solid #111;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
    }
    .bit.on {
      background: #ffcc00;
      color: #000;
      font-weight: 800;
    }

    /* Channels */
    .channels {
      height: 80px; /* Fixed height for channels */
      display: flex;
      flex-direction: row;
      border-bottom: 1px solid #222;
    }

    .channel {
      flex: 1;
      border-right: 1px solid #222;
      position: relative;
      background: #000;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
    }
    .channel:last-child { border-right: none; }



    .channel-ghost {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      background: rgba(255, 204, 0, 0.25); /* Faint Yellow */
      border-top: 1px solid rgba(255, 204, 0, 0.5); /* Rim */
      z-index: 0;
    }

    .channel-fill {
      width: 100%;
      background: #ffcc00; /* Solid punchy yellow */
      opacity: 1.0;
      z-index: 1;
      position: relative;
      box-shadow: 0 0 10px rgba(255, 204, 0, 0.3); /* Glow */
    }

    .channel-label {
        position: absolute;
        top: 4px;
        left: 0; right: 0;
        text-align: center;
        font-size: 9px;
        font-weight: 700;
        color: #666;
        z-index: 10;
        pointer-events: none;
        letter-spacing: 0.5px;
    }

    .channel-type {
        position: absolute;
        bottom: 4px;
        left: 0; right: 0;
        text-align: center;
        font-size: 9px;
        font-weight: 900;
        color: rgba(255, 255, 255, 0.9);
        z-index: 11;
        pointer-events: none;
        opacity: 1.0;
    }

    /* Footer / Controls */
    .footer {
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #080808;
      border-top: 1px solid #222;
      padding: 0 4px;
    }

    button {
      background: #111;
      border: 1px solid #333;
      color: #777;
      font-size: 9px;
      cursor: pointer;
      padding: 2px 8px;
      font-family: inherit;
    }
    button:hover {
        border-color: #ffcc00;
        color: #ffcc00;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.startLoop();
    // We strictly rely on worker UI outputs now.
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.cleanup) this.cleanup();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
  }



  private startLoop() {
    const loop = () => {
      this.animationFrame = requestAnimationFrame(loop);

      // Poll RuntimeManager for UI outputs
      const uiState = runtimeManager.uiStates.get(this.node.id);

      if (uiState) {
          // { codes, env, vec, gate }
          if (uiState.codes && uiState.codes.length > 0) {
              this.codes = uiState.codes;
          }

          this.envelope = uiState.env ?? 0;
          this.channels = uiState.vec ?? [0, 0, 0, 0];
          this.rawChannels = uiState.rawVec ?? [0, 0, 0, 0];
          this.gateOpen = (uiState.gate ?? 0) > 0.5;

          // Use the activeIndex provided by worker if available, else calc
          if (typeof uiState.activeCodeIndex === 'number') {
              if (this.activeIndex !== uiState.activeCodeIndex) {
                  this.activeIndex = uiState.activeCodeIndex;
              }
          } else {
              // Fallback (legacy worker?)
              let pos = 1.0 - this.envelope;
              pos = Math.max(0, Math.min(0.999, pos));
              const idx = Math.floor(pos * this.codes.length);
              if (this.activeIndex !== idx) this.activeIndex = idx;
          }
          this.requestUpdate();
      }
    };
    loop();
  }

  private handleShuffle() {
      // Update seed
      const newSeed = Math.floor(Math.random() * 100000);
      appController.setNodeConfig(this.node.id, { seed: newSeed });
  }

  private handleMatrixDown(e: PointerEvent) {
      e.preventDefault();
      e.stopPropagation(); // Prevent drag initiating graph moves
      (e.target as Element).setPointerCapture(e.pointerId);
      this.updateScrub(e);
  }

  private handleMatrixMove(e: PointerEvent) {
      if ((e.target as Element).hasPointerCapture(e.pointerId)) {
          this.updateScrub(e);
      }
  }

  private handleMatrixUp(e: PointerEvent) {
      (e.target as Element).releasePointerCapture(e.pointerId);
      // Reset manual phase to -1
      const currentValues = this.node.config.values || {};
      appController.setNodeConfig(this.node.id, { values: { ...currentValues, manual_phase: -1 } });
  }

  private updateScrub(e: PointerEvent) {
      const matrix = this.shadowRoot?.querySelector('.matrix');
      if (!matrix) return;

      const rect = matrix.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const normalizedY = Math.max(0, Math.min(1, relativeY / rect.height));

      // Map Y (0..1) to Phase (1..0) because Top is Index 0 (High Env)
      // Wait: Env=1 -> Index 0. Env=0 -> Index Max.
      // So Top (Y=0) should be Env=1. Bottom (Y=1) should be Env=0.
      const phase = 1.0 - normalizedY;

      const currentValues = this.node.config.values || {};
      appController.setNodeConfig(this.node.id, { values: { ...currentValues, manual_phase: phase } });
  }

  render() {
      const activeCode = this.codes[this.activeIndex] || [];
      // Use envelope to determine activity, so it stays active during release
      const isActive = this.envelope > 0.001;

      return html`
        <div class="container" @dblclick="${(e: Event) => e.stopPropagation()}">
        <div class="header">
            <div style="display:flex; align-items:center;">
                <span class="title">ORTHO<span class="highlight">MOD</span></span>
            </div>
            <div style="display:flex; align-items:center;">
                <div class="gate-led ${this.gateOpen ? 'on' : ''}"></div>
                <span class="title" style="color: #555;">GATE</span>
            </div>
        </div>

        <div class="visualizer">
            <!-- Channels (Top) -->
            <div class="channels">
                ${this.channels.map((val, i) => {
                    const activeCode = this.codes[this.activeIndex] || [];
                    const b1 = activeCode[i * 2] || 0;
                    const b2 = activeCode[i * 2 + 1] || 0;
                    let typeLabel = "OFF";
                    if (b1 === 0 && b2 === 0) typeLabel = "OFF";
                    else if (b1 === 1 && b2 === 1) typeLabel = "ON";
                    else if (b1 === 1 && b2 === 0) typeLabel = "SQR"; // 10
                    else if (b1 === 0 && b2 === 1) typeLabel = "SIN"; // 01

                    const rawVal = this.rawChannels[i] || 0;

                    return html`
                    <div class="channel">
                        <div class="channel-label">CH ${i+1}</div>
                        <!-- Ghost Bar (Raw / Unmodulated) -->
                        <div class="channel-ghost" style="height: ${Number.isNaN(rawVal) ? 0 : Math.min(100, Math.max(0, rawVal * 100))}%"></div>

                        <!-- Main Bar (Enveloped) -->
                        <div class="channel-fill" style="height: ${Number.isNaN(val) ? 0 : Math.min(100, Math.max(0, val * 100))}%"></div>

                        <div class="channel-type" style="color: ${isActive ? '#000' : '#555'}">${typeLabel}</div>
                    </div>
                `})}
            </div>

            <!-- Matrix (Bottom) -->
            <div class="matrix"
                @pointerdown="${this.handleMatrixDown}"
                @pointermove="${this.handleMatrixMove}"
                @pointerup="${this.handleMatrixUp}"
                @pointercancel="${this.handleMatrixUp}"
            >
                ${this.codes.map((code, rIdx) => html`
                    <div class="matrix-row ${rIdx === this.activeIndex && isActive ? 'active' : ''}">
                        <div class="bit" style="width:12px; border-right:1px solid #222;">${rIdx}</div>
                        ${code.map(bit => html`
                            <div class="bit ${bit ? 'on' : ''}">${bit}</div>
                        `)}
                    </div>
                `)}
            </div>

            <!-- Channels -->
            <!-- Moved to top -->
        </div>

        <div class="footer">
             <button @click=${this.handleShuffle}>SHUFFLE CODES</button>
            </div>
        </div> <!-- container -->
      `;
  }
}

// Export renderer
export const OrthomodEditorRenderer = (node: GridNode) => {
    return html`<nicepattern-orthomod-editor .node=${node}></nicepattern-orthomod-editor>`;
}

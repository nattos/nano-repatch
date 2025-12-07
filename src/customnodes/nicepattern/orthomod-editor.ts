import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GridNode } from '../../builder/state';
import { runtimeManager } from '../../builder/controllers';
import { appController } from '../../builder/controllers';
import { generateCodes } from './orthomod';
import { reaction } from 'mobx';

@customElement('nicepattern-orthomod-editor')
export class OrthomodEditor extends LitElement {
  @property({ type: Object }) node!: GridNode;

  @state() private codes: number[][] = [];
  @state() private activeIndex: number = 0;
  @state() private channels: number[] = [0, 0, 0, 0];
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

    .channel-fill {
      width: 100%;
      background: #ffcc00;
      opacity: 0.8;
      opacity: 0.8;
    }

    .channel-label {
        position: absolute;
        top: 2px;
        left: 0; right: 0;
        text-align: center;
        font-size: 8px;
        color: #555;
        z-index: 10;
        pointer-events: none;
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
    this.updateCodes();

    // React to config changes (seed/resolution) to update matrix
    this.cleanup = reaction(
        () => ({
            seed: this.node.config.seed,
            resolution: this.node.inputs?.fields?.resolution ?? 8 // Using input? resolution is an input.
            // Wait, resolution is an INPUT node.
            // If it's connected, we can't easily know the value here unless we peek inputs.
            // Inputs are in `runtimeManager.inputs`.
        }),
        () => {
             this.updateCodes();
        }
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.cleanup) this.cleanup();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
  }

  private updateCodes() {
      // Get values.
      // Inputs: resolution might be dynamic.
      const inputs = runtimeManager.inputs.get(this.node.id);

      const seed = this.node.config.seed ?? 12345;

      let resolution = 8;
      // 1. Try Config (Inspector)
      if (this.node.config.values && this.node.config.values.resolution !== undefined) {
          resolution = this.node.config.values.resolution;
      }
      // 2. Try Runtime Input (Connection overrides config)
      if (inputs && inputs.fields && inputs.fields.resolution !== undefined) {
          const resRaw = inputs.fields.resolution;
          if (Number.isFinite(resRaw)) resolution = resRaw;
      }
      resolution = Math.max(2, Math.min(8, Math.floor(resolution)));

      // Also check if resolution is static in inputs config?
      // `node.inputs.fields` isn't where values are.
      // Values are in `runtimeManager` or `node.config` if defaults?
      // Actually `inputs.resolution` might be a constant in definitions, but here we want the RUNTIME value.
      // If the runtime hasn't run yet, fall back to default?
      // Default is 8.

      resolution = Math.max(2, Math.min(8, Math.floor(resolution)));

      this.codes = generateCodes(resolution, seed);
      this.requestUpdate(); // Force re-render of matrix
  }

  private startLoop() {
    const loop = () => {
      this.animationFrame = requestAnimationFrame(loop);

      // Poll RuntimeManager for outputs
      const outputs = runtimeManager.outputs.get(this.node.id);
      if (outputs && outputs.fields) {
          // { env, vec, ch1... }
          const env = outputs.fields.env ?? 0;
          const vec = outputs.fields.vec ?? [0,0,0,0];
          const gate = outputs.fields.gate ?? 0;

          this.envelope = env;
          this.channels = vec;
          this.gateOpen = gate > 0.5;

          // Calculate active index from envelope
          // Logic mirrors orthomod.ts logic
          let pos = 1.0 - env;
          pos = Math.max(0, Math.min(0.999, pos));
          const idx = Math.floor(pos * this.codes.length);


          if (this.activeIndex !== idx) {
              this.activeIndex = idx;
          }
           this.requestUpdate();
      }

      // Also check inputs for resolution updates (poll vs reaction)
      // Since resolution is an input, it might change every frame if modulated.
      // But typically it's static. Polling is cheap enough.
      const inputs = runtimeManager.inputs.get(this.node.id);
      if (inputs && inputs.fields && inputs.fields.resolution !== undefined) {
           const res = inputs.fields.resolution;
           // If resolution changed, update codes.
           // However, storing 'lastResolution' local state is needed.
           // For now, let's rely on reaction for config changes and maybe poll for input changes if we really care about dynamic resolution updates affecting the visualizer.
           // Given standard usage, resolution is likely static or rarely changed.
           // I'll skip polling resolution for code rebuild to avoid perf hit, unless necessary.
           // Wait, `reaction` above tracked `this.node.inputs...` which is structural, not values.
           // To track value changes of input, we need to observe `runtimeManager.inputs`.
           // But `runtimeManager.inputs` is observable map.

           // Let's rely on manual refresh for now or just check it here.
           // Checking `generateCodes` every frame is too heavy? No, it's small (8x8).
           // Let's store lastRes.
      }
    };
    loop();
  }

  private handleShuffle() {
      // Update seed
      const newSeed = Math.floor(Math.random() * 100000);
      appController.setNodeConfig(this.node.id, { seed: newSeed });
      this.updateCodes(); // Optimistic update
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
                ${this.channels.map((val, i) => html`
                    <div class="channel">
                        <div class="channel-label">CH ${i+1}</div>
                        <!-- Use style height percentage. Clamp val to 0-1 just in case of NaN/overflow -->
                        <div class="channel-fill" style="height: ${Number.isNaN(val) ? 0 : Math.min(100, Math.max(0, val * 100))}%"></div>
                    </div>
                `)}
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

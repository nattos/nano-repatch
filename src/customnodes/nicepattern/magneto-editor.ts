import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { GridNode } from '../../builder/state';
import { runtimeManager } from '../../builder/controllers';
import { appController } from '../../builder/controllers';

@customElement('nicepattern-magneto-editor')
export class MagnetoEditor extends LitElement {
    @property({ type: Object }) node!: GridNode;
    @query('#sim-canvas') simCanvas!: HTMLCanvasElement;
    @query('#adsr-canvas') adsrCanvas!: HTMLCanvasElement;

    private cleanup: (() => void) | null = null;
    private animationFrame: number | null = null;

    // Simulation State
    private spheres: any[] = [];
    private plateY: number = 0;
    private phase: string = 'IDLE';
    private sustainProgress: number = 0;

    // ADSR State (Visualization only for now, sourced from worker feedback or config)
    private adsr: any = { attack: 0.2, decay: 0.25, sustain: 0.6, release: 0.3, peak: 0.9 };

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: #050505;
            color: #888;
            font-family: "Space Mono", "JetBrains Mono", monospace;
            font-size: 10px;
            user-select: none;
            position: relative;
        }

        canvas {
            display: block;
            width: 100%;
        }

        .panel {
            background: #0a0a0a;
            border-bottom: 1px solid #333;
            position: relative;
            flex-shrink: 0;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 6px;
            background: #000;
            border-bottom: 1px solid #222;
        }

        .status {
            font-size: 9px;
            font-weight: bold;
            color: #444;
        }
        .status.active { color: #00ff00; }

        .param-label {
            position: absolute;
            top: 2px; right: 4px;
            font-size: 8px;
            color: #555;
            pointer-events: none;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        this.startLoop();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    }

    private startLoop() {
        const loop = () => {
            this.animationFrame = requestAnimationFrame(loop);

            const uiState = runtimeManager.uiStates.get(this.node.id);
            if (uiState) {
                if (uiState.spheres) this.spheres = uiState.spheres;
                if (typeof uiState.plateY === 'number') this.plateY = uiState.plateY;
                if (uiState.phase) this.phase = uiState.phase;
                if (typeof uiState.sustainProgress === 'number') this.sustainProgress = uiState.sustainProgress;
                if (uiState.adsr) this.adsr = uiState.adsr;

                this.drawSim();
                this.drawADSR();
                this.requestUpdate();
            }
        };
        loop();
    }

    firstUpdated() {
        this.resizeCanvases();
    }

    private resizeCanvases() {
        if (this.simCanvas) {
            const rect = this.simCanvas.parentElement?.getBoundingClientRect();
            if (rect) {
                this.simCanvas.width = rect.width;
                this.simCanvas.height = rect.height;
            }
        }
        if (this.adsrCanvas) {
            const rect = this.adsrCanvas.parentElement?.getBoundingClientRect();
            if (rect) {
                this.adsrCanvas.width = rect.width;
                this.adsrCanvas.height = rect.height;
            }
        }
    }

    private drawSim() {
        const ctx = this.simCanvas?.getContext('2d');
        if (!ctx) return;

        const w = this.simCanvas.width;
        const h = this.simCanvas.height;
        // Map simulation height (600) to canvas height
        const scaleY = h / 600;

        ctx.clearRect(0, 0, w, h);

        // Draw Plate
        const py = this.plateY * scaleY;

        // Magnet Field
        if (this.phase !== 'IDLE' && this.phase !== 'RELEASE') {
            const grad = ctx.createLinearGradient(0, py, 0, py + (100 * scaleY)); // Arbitrary field viz range
            grad.addColorStop(0, 'rgba(0, 255, 0, 0.2)');
            grad.addColorStop(1, 'rgba(0, 255, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, py, w, h - py);
        }

        ctx.fillStyle = (this.phase !== 'IDLE' && this.phase !== 'RELEASE') ? '#00ff00' : '#444';
        ctx.fillRect(0, py - 2, w, 4);

        // Draw Spheres
        this.spheres.forEach(s => {
            const sx = (s.x / 600) * w; // Assuming 600 width in sim, though sim had dynamic width.
            // In worker, x was init based on 'cw=600'.
            const sy = s.y * scaleY;
            const sr = s.r * scaleY;
            const t = s.t || 0;

            let r = 255, g = 255, b = 0;
            if (t < 0.5) { r = Math.floor((t * 2) * 255); g = 255; }
            else { r = 255; g = Math.floor((1.0 - (t - 0.5) * 2) * 255); }

            ctx.fillStyle = s.l ? `rgb(${r},${g},0)` : '#ccc';

            // Draw String
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, h); // Anchor at bottom? No, top logic was inverted?
            // In magnetoenv.html: `this.y = h - this.restLength;`
            // and `gravityForce = CONFIG.gravity * this.mass;` (positive down).
            // So y=0 is top. h is bottom.
            // Sphere anchor: `targetY = h - this.restLength`.
            // Wait, spring pulls towards `targetY`.
            // `springForce = (targetY - this.y) * k`.
            // So if y < targetY, force is positive (push down).
            // Wait.
            // In HTML: `simCtx.moveTo(s.x, ch);`
            // It drew lines from BOTTOM (checking html code).

            ctx.moveTo(sx, h);
            ctx.lineTo(sx, sy);
            ctx.stroke();

            // Draw Sphere
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(2, sr), 0, Math.PI * 2);
            ctx.fill();
        });
    }

    private drawADSR() {
        const ctx = this.adsrCanvas?.getContext('2d');
        if (!ctx) return;

        const w = this.adsrCanvas.width;
        const h = this.adsrCanvas.height;

        ctx.clearRect(0, 0, w, h);

        const { attack, decay, sustain, release, peak } = this.adsr;

        // Normalize time visualization (heuristic width)
        const totalT = attack + decay + 0.5 + release;
        const scaleX = w / Math.max(1.0, totalT); // Ensure minimal width

        const xA = attack * scaleX;
        const xD = (attack + decay) * scaleX;
        const xS = xD + (0.5 * scaleX); // Fixed sustain width visualization
        const xR = xS + (release * scaleX);

        // Y coords (0 is TOP, 1 is BOTTOM in canvas coords)
        // Peak 0.9 means HIGH level. In sim, plateClosedY (high level) was small Y value (top).
        // Let's visualize envelope Level (Y inverted).
        // 0 level = h. 1 level = 0.

        const y0 = h;
        const yP = h - (peak * h);
        const yS = h - (sustain * h);

        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y0); // Start
        ctx.lineTo(xA, yP); // Attack to Peak
        ctx.lineTo(xD, yS); // Decay to Sustain
        ctx.lineTo(xS, yS); // Sustain Hold
        ctx.lineTo(xR, y0); // Release to Zero
        ctx.stroke();

        // Fill
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(0, 255, 255, 0.2)');
        grad.addColorStop(1, 'rgba(0, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Playhead Visualization
        let px = 0;
        if (this.phase === 'ATTACK') {
             // Map plateY to attack progress
             // Rough approx since plateY logic is complex physics
             const progress = (1 - (this.plateY / 600)); // Normalize
             // Actually rely on phase?
             // Just draw a blip based on plateY roughly mapping to the curve?
             // Or just draw based on phase if we knew phase time.
        }

        // Simple Phase Highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        if (this.phase === 'ATTACK') ctx.fillRect(0, 0, xA, h);
        if (this.phase === 'DECAY') ctx.fillRect(xA, 0, xD - xA, h);
        if (this.phase === 'SUSTAIN') ctx.fillRect(xD, 0, xS - xD, h);
        if (this.phase === 'RELEASE') ctx.fillRect(xS, 0, w - xS, h);
    }

    render() {
        return html`
            <div class="header">
                <div class="status ${this.phase !== 'IDLE' ? 'active' : ''}">${this.phase}</div>
                <div style="font-size: 8px;">MAGNETO</div>
            </div>
            <div class="panel" style="height: 140px;">
                <canvas id="sim-canvas"></canvas>
                <div class="param-label">SIMULATION</div>
            </div>
            <div class="panel" style="height: 80px; flex: 1; border-bottom: none;">
                <canvas id="adsr-canvas"></canvas>
                <div class="param-label">ENVELOPE</div>
            </div>
        `;
    }
}

export const MagnetoEditorRenderer = (node: GridNode) => {
    return html`<nicepattern-magneto-editor .node=${node}></nicepattern-magneto-editor>`;
}

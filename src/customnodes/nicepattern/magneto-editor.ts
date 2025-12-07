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
    @query('#history-canvas') historyCanvas!: HTMLCanvasElement;

    private cleanup: (() => void) | null = null;
    private animationFrame: number | null = null;

    // Simulation State
    // History for Graph
    private history: {t: number, e: number, fs: number, fm: number}[] = new Array(200).fill({t:0, e:0, fs:0, fm:0});

    // Interaction State
    private dragging: 'attack' | 'decay' | 'sustain' | 'release' | null = null;
    private dragOrigin: { peak: number, sustain: number } | null = null;
    private longEdit: any = null;

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
            pointer-events: auto;
            touch-action: none; /* Prevent scrolling during interaction */
        }

        canvas {
            display: block;
            width: 100%;
            height: 100%;
            touch-action: none;
        }

        .panel {
            background: #0a0a0a;
            border-bottom: 1px solid #333;
            position: relative;
            width: 100%;
            overflow: hidden;
            touch-action: none;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 6px;
            background: #000;
            border-bottom: 1px solid #222;
            flex-shrink: 0;
            height: 20px;
            box-sizing: border-box;
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

        .legend {
            position: absolute;
            top: 2px;
            left: 2px;
            display: flex;
            gap: 4px;
            pointer-events: none;
        }
        .dot { width: 4px; height: 4px; margin-top: 3px; }
    `;

    connectedCallback() {
        super.connectedCallback();
        this.startLoop();
        this.addEventListener('dblclick', this.handleDblClick);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.removeEventListener('dblclick', this.handleDblClick);
    }

    private handleDblClick = (e: Event) => {
        e.stopPropagation();
    }

    private startLoop() {
        const loop = () => {
            if (!this.isConnected) return;
            this.animationFrame = requestAnimationFrame(loop);

            const uiState = runtimeManager.uiStates.get(this.node.id);
            if (uiState) {
                if (uiState.spheres) this.spheres = uiState.spheres;
                if (typeof uiState.plateY === 'number') this.plateY = uiState.plateY;
                if (uiState.phase) this.phase = uiState.phase;
                if (typeof uiState.sustainProgress === 'number') this.sustainProgress = uiState.sustainProgress;

                // Only update ADSR if we are NOT dragging (prevent fighting)
                if (!this.dragging && uiState.adsr) this.adsr = uiState.adsr;

                this.updateHistory(); // Pull latest output from RuntimeManager for graph
                this.drawSim();
                this.drawHistory();
                this.drawADSR();
                this.requestUpdate();
            }
        };
        loop();
    }

    private updateHistory() {
        // We need the output values. UI state sends them? No, UI state sends spheres/plate.
        // We can get outputs from runtimeManager.outputs.get(id)
        const outputs = runtimeManager.outputs.get(this.node.id);
        if (outputs && outputs.fields) {
            this.history.push({
                t: outputs.fields.env ?? 0,
                e: outputs.fields.ch2 ?? 0,
                fs: outputs.fields.ch3 ?? 0,
                fm: outputs.fields.ch4 ?? 0
            });
            if(this.history.length > 200) this.history.shift();
        }
    }

    // Explicitly handle resize if needed, though grid handles it via size changes
    firstUpdated() {
        this.resizeCanvases();
        // Bind events if not using @ syntax
        if (this.adsrCanvas) {
            // Note: We use arrow functions or bind in render usually, but manual add works too.
            // Using @pointerdown in render is cleaner for Lit.
        }
    }

    private resizeCanvases() {
        const resize = (c: HTMLCanvasElement) => {
            if(!c) return;
            // Force read from offsetWidth/Height to ensure we get pixel size
            const w = c.offsetWidth;
            const h = c.offsetHeight;
            // Only update if changed and non-zero (to avoid flicker or gone)
            if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) {
                c.width = w;
                c.height = h;
            }
        };
        resize(this.simCanvas);
        resize(this.adsrCanvas);
        resize(this.historyCanvas);
    }

    // --- INTERACTION ---

    private handleADSRDown(e: PointerEvent) {
        // Stop propagation to prevent node drag
        e.preventDefault();
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        this.handleADSRInput(e, true);
    }

    private handleADSRMove(e: PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        if(this.dragging) this.handleADSRInput(e, false);
    }

    private handleADSRUp(e: PointerEvent) {
        e.stopPropagation(); // Prevent partial drags affecting node
        this.dragging = null;
        this.dragOrigin = null;
        if (this.longEdit) {
            this.longEdit.accept();
            this.longEdit = null;
        }
        (e.target as Element).releasePointerCapture(e.pointerId);
    }

    private handleADSRInput(e: PointerEvent, isDown: boolean) {
        const rect = this.adsrCanvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if(w === 0 || h === 0) return;

        // Normalized Inputs
        const xNorm = (e.clientX - rect.left) / w;
        const yNorm = (e.clientY - rect.top) / h;

        const { attack, decay, sustain, release, peak } = this.adsr;

        // FIXED TIME WINDOW (1.5s) - Decouples layout from values
        const VIEW_DURATION = 1.5;
        const timeAtCursor = xNorm * VIEW_DURATION;

        // Visual Layout with Minimum Widths
        const MIN_VIS_W = 0.05; // 50ms min visual width
        const visA = Math.max(attack, MIN_VIS_W);
        const visD = Math.max(decay, MIN_VIS_W);
        const visS = 0.5; // Fixed sustain visual width

        // Handle Positions (in Time domain)
        const tA = visA;
        const tD = visA + visD;
        const tS = tD + visS;
        // const tR = tS + release; // End of graph

        if (isDown) {
            this.dragOrigin = { peak, sustain };

            // Hit Testing (Distance in Time Domain)
            // 0.2s threshold for easier grabbing
            const HIT_THRESH = 0.2;
            let closestDist = HIT_THRESH;
            let target = null;

            // Attack Handle (at tA)
            const distA = Math.abs(timeAtCursor - tA);
            if(distA < closestDist) { closestDist = distA; target = 'attack'; }

            // Decay Handle (at tD)
            const distD = Math.abs(timeAtCursor - tD);
            if(distD < closestDist) { closestDist = distD; target = 'decay'; }

            // Release Drag (Sustain/Release Junction at tS)
            // We drag the "start of release" to set release time?
            // Actually, usually we drag the TAIL of release to set release time.
            // Or drag the start of release to... change sustain width? No, S is fixed.
            // In prev logic: 'release' target set `release`.
            // Previous code: `const dRelease = Math.abs(x - xS);` -> xS is start of release.
            // So we click the "Corner" between Sustain and Release.
            // And then drag to set Release duration?
            // "if dragging release... newRelease = timeAtCursor - tStartRelease"
            // So if I click start, length is 0?
            // Maybe we should allow clicking ANYWHERE in the release tail?
            // Let's stick to handle first. "Sustain End / Release Start" handle.
            const distS = Math.abs(timeAtCursor - tS);
            if(distS < closestDist) { closestDist = distS; target = 'release'; }

            // Sustain Y-axis (Priority if X matches Sustain zone)
            if (!target && timeAtCursor > tD && timeAtCursor < tS) {
                target = 'sustain';
            }

            // Fallback: If clicking loosely near segments
            if(!target) {
                if (timeAtCursor < tA) target = 'attack';
                else if (timeAtCursor < tD) target = 'decay';
                else if (timeAtCursor > tS) target = 'release';
            }

            this.dragging = target as any;
        }

        if (!this.dragging) return;

        // Apply Logic using LINEAR MAPPING
        const updates: any = {};
        const config = this.node.config.values || {};

        if (this.dragging === 'attack') {
            // Dragging A handle sets Attack Time
            const newAttack = Math.max(0.01, timeAtCursor);
            updates.attack = newAttack;

            const newPeak = Math.max(0.1, Math.min(1.0, yNorm));
            updates.peak = newPeak;

            // Rubber band
            if (sustain > newPeak) updates.sustain = newPeak;
            else if (this.dragOrigin) updates.sustain = Math.min(newPeak, this.dragOrigin.sustain);

        } else if (this.dragging === 'decay') {
             // Dragging D handle sets Attack + Decay point
             // Decay = Cursor - Attack
             // But Attack is fixed during this drag? Yes.
             const newDecay = Math.max(0.01, timeAtCursor - attack);
             updates.decay = newDecay;

        } else if (this.dragging === 'sustain') {
             const newSus = Math.max(0.0, Math.min(1.0, yNorm));
             updates.sustain = newSus;

             if (newSus > peak) updates.peak = newSus;
             else if (this.dragOrigin) updates.peak = Math.max(newSus, this.dragOrigin.peak);

        } else if (this.dragging === 'release') {
             // Dragging S/R junction?
             // If we treat this handle as "Release Length controller",
             // We want it to behave like dragging the END of release?
             // BUT we clicked the START (tS).
             // If I click tS and drag right, I expect release to grow?
             // Logic: newRelease = timeAtCursor - tS?
             // Since tS is fixed (A+D+S_viz), dragging right from there increases R.
             // This works.
             const tStartRelease = attack + decay + 0.5;
             const newRelease = Math.max(0.01, timeAtCursor - tStartRelease);
             updates.release = newRelease;
        }
        // Commit Update (Long Edit)
        const action = (c: any) => {
             c.setNodeConfig(this.node.id, { values: { ...config, ...updates } });
        };

        if (isDown) { // Start of Drag
             if (this.longEdit) { console.warn('Existing long edit found, accepting'); this.longEdit.accept(); }
             this.longEdit = appController.beginLongEdit({ apply: action });
        } else { // Continuation
             if (this.longEdit) {
                 this.longEdit.applyAgain(action);
             } else {
                 // Fallback
                 appController.setNodeConfig(this.node.id, { values: { ...config, ...updates } });
             }
        }

        // Optimistic update for UI smoothness
        Object.assign(this.adsr, updates);
    }

    // --- SIM INTERACTION ---
    private isSimDragging = false;

    private handleSimDown(e: PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        (e.target as Element).setPointerCapture(e.pointerId);
        this.isSimDragging = true;
        this.sendSimMessage(e);
    }

    private handleSimMove(e: PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (this.isSimDragging) {
            this.sendSimMessage(e);
        }
    }

    private handleSimUp(e: PointerEvent) {
        e.stopPropagation();
        this.isSimDragging = false;

        // Finish ADSR Drag if active
        if (this.longEdit) {
             this.longEdit.accept();
             this.longEdit = null;
        }

        (e.target as Element).releasePointerCapture(e.pointerId);
        runtimeManager.sendNodeMessage(this.node.id, {
            type: 'manual_interaction',
            active: false
        });
    }

    private sendSimMessage(e: PointerEvent) {
        const rect = this.simCanvas.getBoundingClientRect();
        // Calculate Y in simulation space (0-600)
        // Canvas height scales to simulation height.
        // Screen Y -> Canvas Y -> Sim Y
        // Canvas Height = rect.height
        // Sim Height = 600
        const scale = 600 / rect.height;
        const y = (e.clientY - rect.top) * scale;

        runtimeManager.sendNodeMessage(this.node.id, {
            type: 'manual_interaction',
            active: true,
            y: y
        });
    }

    // --- DRAWING ---

    private drawHistory() {
        if(!this.historyCanvas) return;
        const ctx = this.historyCanvas.getContext('2d');
        if(!ctx) return;

        // Ensure size
        if(this.historyCanvas.width !== this.historyCanvas.offsetWidth) {
            this.historyCanvas.width = this.historyCanvas.offsetWidth;
            this.historyCanvas.height = this.historyCanvas.offsetHeight;
        }

        const w = this.historyCanvas.width;
        const h = this.historyCanvas.height;
        ctx.clearRect(0,0,w,h);

        // Grid
        ctx.fillStyle = '#111';
        ctx.fillRect(0,0,w,h);

        const drawLine = (key: 't'|'e'|'fs'|'fm', color: string) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            const step = w / this.history.length;
            this.history.forEach((val, i) => {
                const y = h - (val[key] * h); // 0..1 to h..0
                if(i===0) ctx.moveTo(0, y);
                else ctx.lineTo(i * step, y);
            });
            ctx.stroke();
        };

        drawLine('fm', '#0088ff');
        drawLine('fs', '#ff0000');
        drawLine('e', '#ffff00');
        drawLine('t', '#00ffff');
    }

    private drawSim() {
        const ctx = this.simCanvas?.getContext('2d');
        if (!ctx) return;

        if(this.simCanvas.width !== this.simCanvas.offsetWidth) {
            this.simCanvas.width = this.simCanvas.offsetWidth;
            this.simCanvas.height = this.simCanvas.offsetHeight;
        }

        const w = this.simCanvas.width;
        const h = this.simCanvas.height;
        // Map simulation height (600) to canvas height
        const scaleY = h / 600;

        ctx.clearRect(0, 0, w, h);

        // Draw Plate (PlateY is 0..600? PlateOpenY=40. Deep=570.)
        const py = this.plateY * scaleY;

        // Magnet Field
        if (this.phase !== 'IDLE' && this.phase !== 'RELEASE') {
            const grad = ctx.createLinearGradient(0, py, 0, py + (100 * scaleY));
            grad.addColorStop(0, 'rgba(0, 255, 0, 0.2)');
            grad.addColorStop(1, 'rgba(0, 255, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, py, w, h - py);
        }

        ctx.fillStyle = (this.phase !== 'IDLE' && this.phase !== 'RELEASE') ? '#00ff00' : '#444';
        ctx.fillRect(0, py - 2, w, 4);

        // Draw Spheres
        this.spheres.forEach(s => {
            const sx = (s.x / 600) * w;
            const sy = s.y * scaleY;
            const sr = s.r * scaleY;
            const t = s.t || 0;

            let r = 255, g = 255, b = 0;
            if (t < 0.5) { r = Math.floor((t * 2) * 255); g = 255; }
            else { r = 255; g = Math.floor((1.0 - (t - 0.5) * 2) * 255); }

            ctx.fillStyle = s.l ? `rgb(${r},${g},0)` : '#ccc';

            // Draw String (from Top=Base to Sphere)
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, h); // Base is at bottom visually in sim?
            // Logic check: "targetY = h - restLength". So h is base.
            // Wait, MagnetoEnv.html says: `this.y = h - this.restLength;` (target).
            // `moveTo(s.x, ch)`. ch is Height. So strings hang from Bottom?
            // "Gravity = 800". Positive. So they fall "down" (increasing Y).
            // So H is "floor". 0 is "ceiling".
            // If Plate is at 40, it's at ceiling.
            // Spheres fall heavily towards floor (h).
            // Plate pulls them UP (to 0).
            // Strings anchor at FLOOR (h).
            // Correct.

            ctx.moveTo(sx, h);
            ctx.lineTo(sx, sy);
            ctx.stroke();

            // Draw Sphere
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(2, sr), 0, Math.PI * 2);
            ctx.fill();

            if (s.l) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = `rgb(${r},${g},0)`;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        });
    }

    private drawADSR() {
        const ctx = this.adsrCanvas?.getContext('2d');
        if (!ctx) return;

        if(this.adsrCanvas.width !== this.adsrCanvas.offsetWidth) {
            this.adsrCanvas.width = this.adsrCanvas.offsetWidth;
            this.adsrCanvas.height = this.adsrCanvas.offsetHeight;
        }

        const w = this.adsrCanvas.width;
        const h = this.adsrCanvas.height;

        ctx.clearRect(0, 0, w, h);

        const { attack, decay, sustain, release, peak } = this.adsr;

        // Iceberg Visualization (Inverted)

        // FIXED TIME WINDOW (1.5s)
        const VIEW_DURATION = 1.5;
        const scaleX = w / VIEW_DURATION; // pixels per second

        // Visual Layout with Minimum Widths
        const MIN_VIS_W = 0.05; // 50ms min visual width
        const visA = Math.max(attack, MIN_VIS_W);
        const visD = Math.max(decay, MIN_VIS_W);
        const visS = 0.5; // Fixed sustain visual width
        // Release is just "rest of graph" in concept, but we draw the Release Curve.
        // We draw R based on ACTUAL release value, but clipped to view if needed.
        const visR = release;

        const xA = visA * scaleX;
        const xD = (visA + visD) * scaleX;
        const xS = xD + (visS * scaleX);
        const xR = xS + (visR * scaleX);

        // Y coords (Iceberg: 0=Top=Base, 1=Bottom=Max)
        const y0 = 0;
        const yP = peak * h;
        const yS = sustain * h;

        // Active Zone Highlights (Draw first to be background)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        if (this.dragging === 'attack' || this.phase === 'ATTACK') ctx.fillRect(0, 0, xA, h);
        if (this.dragging === 'decay' || this.phase === 'DECAY') ctx.fillRect(xA, 0, xD - xA, h);
        if (this.dragging === 'sustain' || this.phase === 'SUSTAIN') ctx.fillRect(xD, 0, xS - xD, h);
        if (this.dragging === 'release' || this.phase === 'RELEASE') ctx.fillRect(xS, 0, w - xS, h);


        // Draw Shape
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.lineTo(xA, yP);
        ctx.lineTo(xD, yS);
        ctx.lineTo(xS, yS);
        ctx.lineTo(xR, y0);
        ctx.stroke();

        // Fill
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(0, 255, 255, 0)');
        grad.addColorStop(1, 'rgba(0, 255, 255, 0.2)');
        ctx.fillStyle = grad;
        ctx.lineTo(0, y0);
        ctx.fill();

        // Handles (if dragging or hovering?)
        // Draw dots at key points
        ctx.fillStyle = '#fff';
        const drawDot = (x: number, y: number) => {
            ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
        };
        drawDot(xA, yP);
        drawDot(xD, yS);
        drawDot(xS, yS);
        drawDot(xR, y0);
    }

    render() {
        return html`
            <div class="header" @pointerdown="${(e: Event) => e.stopPropagation()}">
                <div class="status ${this.phase !== 'IDLE' ? 'active' : ''}">${this.phase}</div>
                <div style="font-size: 8px;">MAGNETO</div>
            </div>

            <div class="panel" style="height: 40px; flex-shrink: 0;" @pointerdown="${(e: Event) => e.stopPropagation()}">
                <canvas id="history-canvas"></canvas>
                <div class="legend">
                    <div style="color:#00ffff">TEN<div class="dot" style="background:#00ffff; display:inline-block"></div></div>
                    <div style="color:#ffff00">EXT<div class="dot" style="background:#ffff00; display:inline-block"></div></div>
                    <div style="color:#ff0000">SPR<div class="dot" style="background:#ff0000; display:inline-block"></div></div>
                    <div style="color:#0088ff">MAG<div class="dot" style="background:#0088ff; display:inline-block"></div></div>
                </div>
            </div>

            <div class="panel" style="height: 140px; flex-shrink: 0; pointer-events: auto;"
                 @pointerdown="${this.handleSimDown}"
                 @pointermove="${this.handleSimMove}"
                 @pointerup="${this.handleSimUp}"
                 @pointercancel="${this.handleSimUp}">
                <canvas id="sim-canvas"></canvas>
                <div class="param-label">SIMULATION</div>
            </div>

            <div class="panel" style="height: 80px; flex: 1; border-bottom: none;"
                 @pointerdown="${this.handleADSRDown}"
                 @pointermove="${this.handleADSRMove}"
                 @pointerup="${this.handleADSRUp}"
                 @pointercancel="${this.handleADSRUp}">
                <canvas id="adsr-canvas"></canvas>
                <div class="param-label">ELASTIC EDITOR</div>
            </div>
        `;
    }
}

export const MagnetoEditorRenderer = (node: GridNode) => {
    return html`<nicepattern-magneto-editor .node=${node}></nicepattern-magneto-editor>`;
}


import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { runtimeManager } from '../../builder/controllers';

interface Step {
  noteIndex: number | null;
  velocity: number;
  hold: boolean;
}

@customElement('seq-sequencer-editor')
export class SequencerEditor extends LitElement {
  @property() nodeId: string = '';
  @property({ type: Object }) config: any = {};
  @property() requestConfigUpdate: (newConfig: any) => void = () => { };

  @state() private currentStepIndex: number = -1;
  private _frameId: number = 0;

  private isDragging: boolean = false;
  private targetState: boolean = false;
  private lastHoveredStep: number = -1;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      color: white;
      font-family: var(--font-family, sans-serif);
      background: #1e1e1e;
      border-radius: 4px;
      overflow: hidden;
      user-select: none;
    }

    .sequencer-grid {
      display: flex;
      flex-direction: row;
      height: 100%;
      gap: 2px;
      padding: 4px;
      box-sizing: border-box;
    }

    .step {
      flex: 1;
      background: #333;
      border-radius: 2px;
      position: relative;
      cursor: pointer;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      transition: background-color 0.1s;
    }

    .step:hover {
      background: #444;
    }

    .step.active {
      background: rgba(100, 149, 237, 0.2);
    }

    .step-bar {
      width: 100%;
      background: var(--accent-color, #6495ed);
      border-radius: 1px;
    }

    .playhead {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: 1px solid #fff;
      box-sizing: border-box;
      pointer-events: none;
      opacity: 0.8;
      box-shadow: 0 0 4px #fff;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.startLoop();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopLoop();
  }

  startLoop() {
    const loop = () => {
      if (this.nodeId && runtimeManager) {
        const uiState = runtimeManager.uiStates.get(this.nodeId);
        if (uiState && typeof uiState.currentStep === 'number') {
          if (this.currentStepIndex !== uiState.currentStep) {
            this.currentStepIndex = uiState.currentStep;
          }
        }
      }
      this._frameId = requestAnimationFrame(loop);
    };
    this._frameId = requestAnimationFrame(loop);
  }

  stopLoop() {
    cancelAnimationFrame(this._frameId);
  }

  getSequence(): Step[] {
    if (this.config && Array.isArray(this.config.sequence)) {
      return this.config.sequence;
    }
    return Array(16).fill({ noteIndex: null, velocity: 0, hold: false });
  }

  updateStep(index: number, active: boolean) {
    const seq = [...this.getSequence()];
    const oldStep = seq[index] || { noteIndex: null, velocity: 0, hold: false };
    const step = { ...oldStep };

    if (active) {
      if (step.noteIndex === null) {
        step.noteIndex = 60;
        step.velocity = 1.0;
        step.hold = false;
      }
    } else {
      step.noteIndex = null;
      step.velocity = 0;
      step.hold = false;
    }

    seq[index] = step;

    this.config = { ...this.config, sequence: seq };
    this.requestConfigUpdate({ sequence: seq });
    this.requestUpdate();
  }

  handlePointerDown(e: PointerEvent, index: number) {
    this.isDragging = true;
    (this as any).setPointerCapture(e.pointerId);

    const seq = this.getSequence();
    const step = seq[index] || { noteIndex: null, velocity: 0, hold: false };
    const isActive = step.noteIndex !== null;

    this.targetState = !isActive;

    this.updateStep(index, this.targetState);
    this.lastHoveredStep = index;
  }

  handlePointerMove(e: PointerEvent) {
    if (!this.isDragging) return;

    const elements = this.shadowRoot?.elementsFromPoint(e.clientX, e.clientY) || [];
    const stepEl = elements.find(el => el.classList.contains('step'));
    if (stepEl) {
      const indexStr = (stepEl as HTMLElement).dataset.index;
      if (indexStr) {
        const index = parseInt(indexStr, 10);
        if (index !== this.lastHoveredStep) {
          this.updateStep(index, this.targetState);
          this.lastHoveredStep = index;
        }
      }
    }
  }

  handlePointerUp(e: PointerEvent) {
    this.isDragging = false;
    this.lastHoveredStep = -1;
    (this as any).releasePointerCapture(e.pointerId);
  }

  render() {
    const seq = this.getSequence();

    return html`
      <div class="sequencer-grid"
           @pointermove=${this.handlePointerMove}
           @pointerup=${this.handlePointerUp}
           @pointercancel=${this.handlePointerUp}
      >
        ${seq.map((step, i) => {
      const isActive = step.noteIndex !== null;
      const velocity = step.velocity ?? 0;
      const height = isActive ? Math.max(10, velocity * 100) : 0;
      const isCurrent = i === this.currentStepIndex;

      return html`
            <div class="step ${isActive ? 'active' : ''}"
                 data-index="${i}"
                 @pointerdown=${(e: PointerEvent) => this.handlePointerDown(e, i)}
            >
              ${isActive ? html`<div class="step-bar" style="height: ${height}%"></div>` : ''}
              ${isCurrent ? html`<div class="playhead"></div>` : ''}
            </div>
          `;
    })}
      </div>
    `;
  }
}

export const SequencerEditorRenderer = 'seq-sequencer-editor';

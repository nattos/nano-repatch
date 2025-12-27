
import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { PointerDragOp } from '../../utils/pointer-drag-op';
import { appController } from '../../builder/controllers';
import { ROW_HEIGHT } from '../../constants';

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

  private lastHoveredStep: number = -1;
  private dragOp: PointerDragOp | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: ${unsafeCSS(3 * ROW_HEIGHT + 'px')};
      color: white;
      font-family: var(--font-family, sans-serif);
      background: #1e1e1e;
      border-radius: 4px;
      overflow: hidden;
      user-select: none;
      touch-action: none;
    }

    .sequencer-grid {
      display: flex;
      flex-direction: row;
      height: 100%;
      gap: 0;
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
      border-right: 1px solid #1e1e1e;
    }

    .step:last-child {
      border-right: none;
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
  `;

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.dragOp) {
      this.dragOp.dispose();
      this.dragOp = null;
    }
  }

  getSequence(): Step[] {
    const values = this.config.values || {};
    if (values.sequence && Array.isArray(values.sequence)) {
      return values.sequence;
    }
    return Array(16).fill({ noteIndex: null, velocity: 0, hold: false });
  }

  // Toggle the step at the given index
  toggleStep(seq: Step[], index: number) {
    const oldStep = seq[index] || { noteIndex: null, velocity: 0, hold: false };
    const step = { ...oldStep };

    const isActive = step.noteIndex !== null;
    if (!isActive) {
      step.noteIndex = 60;
      step.velocity = 1.0;
      step.hold = false;
    } else {
      step.noteIndex = null;
      step.velocity = 0;
      step.hold = false;
    }

    seq[index] = step;
  }

  updateConfig(seq: Step[]) {
    const newConfig = {
      ...this.config,
      values: {
        ...(this.config.values || {}),
        sequence: seq
      }
    };
    this.config = newConfig;
    this.requestConfigUpdate(newConfig);
    this.requestUpdate();
  }

  handlePointerDown(e: PointerEvent, index: number) {
    this.lastHoveredStep = index;
    const seq = [...this.getSequence()];

    // Toggle on down (Per-step inversion)
    this.toggleStep(seq, index);
    this.updateConfig(seq);

    this.dragOp = new PointerDragOp(e, this, {
      callMoveImmediately: false,
      move: (e) => this.handleDragMove(e),
      complete: () => {
        this.dragOp = null;
        this.lastHoveredStep = -1;
      }
    });
  }

  handleDragMove(e: PointerEvent) {
    const elements = this.shadowRoot?.elementsFromPoint(e.clientX, e.clientY) || [];
    const stepEl = elements.find(el => el.classList.contains('step'));

    if (stepEl) {
      const indexStr = (stepEl as HTMLElement).dataset.index;
      if (indexStr) {
        const index = parseInt(indexStr, 10);

        if (index !== this.lastHoveredStep) {
          const seq = [...this.getSequence()];

          // Continuous Collision Detection: Fill gaps between lastHovered and current
          // Logic: Move from lastHovered towards index
          const start = this.lastHoveredStep;
          const end = index;
          const dir = Math.sign(end - start);

          // We start from start + dir to avoid re-toggling the start step
          // We include the end step
          // Note: If fast drag, difference > 1
          if (dir !== 0) {
            let curr = start + dir;
            while (curr !== end + dir) {
              // Bounds check just in case, though grid is fixed
              if (curr >= 0 && curr < 16) {
                this.toggleStep(seq, curr);
              }
              curr += dir;
            }
          }

          this.updateConfig(seq);
          this.lastHoveredStep = index;
        }
      }
    }
  }

  render() {
    const seq = this.getSequence();

    return html`
      <div class="sequencer-grid" @dblclick=${(e: Event) => e.stopPropagation()}>
        ${seq.map((step, i) => {
      const isActive = step.noteIndex !== null;
      const velocity = step.velocity ?? 0;
      const height = isActive ? Math.max(10, velocity * 100) : 0;

      return html`
            <div class="step ${isActive ? 'active' : ''}"
                 data-index="${i}"
                 @pointerdown=${(e: PointerEvent) => this.handlePointerDown(e, i)}
            >
              <div class="step-bar" style="height: ${height}%"></div>
            </div>
          `;
    })}
      </div>
    `;
  }
}

// Export as a function that returns the template
export const SequencerEditorRenderer = (node: any) => {
  return html`<seq-sequencer-editor .nodeId=${node.id} .config=${node.config} .requestConfigUpdate=${(newConfig: any) => appController.setNodeConfig(node.id, newConfig)}></seq-sequencer-editor>`;
};

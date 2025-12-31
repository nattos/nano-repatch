import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { CancelReason, PointerDragOp } from '../utils/pointer-drag-op';

@customElement('scalar-slider')
export class ScalarSlider extends LitElement {
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 1;
  @property({ type: Number }) step = 0.01;
  @property({ type: Number }) defaultValue = 0;

  @state() private isDragging = false;
  @state() private isEditing = false;
  @state() private tempValue = '';

  private startValue = 0;
  private rect: DOMRect | null = null;
  private dragOp: PointerDragOp | null = null;

  static styles = css`
    :host {
      display: inline-block;
      user-select: none;
      cursor: ew-resize;
      position: relative;
      min-width: 40px;
      height: 22px;
      line-height: 22px;
      font-family: var(--font-family, sans-serif);
      font-size: 12px;
      color: var(--text-color, #ccc);
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--selection-border, rgba(255, 69, 0, 0.5));
      border-radius: 2px;
      box-sizing: border-box;
      touch-action: none;
      overflow: hidden;
    }

    :host(:hover) {
      border-color: var(--accent-color, #ff4500);
      background: rgba(0, 0, 0, 0.3);
    }

    :host([dragging]) {
      border-color: var(--accent-color, #ff4500);
      color: var(--accent-color, #ff4500);
      /* background: var(--selection-color, rgba(255, 69, 0, 0.1)); Remove full background on drag */
    }

    :host(:focus) {
      border-color: var(--accent-color, #ff4500);
      outline: none;
    }

    .bar {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      /* Slanted hashed pattern with thin blue lines */
      background-image: repeating-linear-gradient(
        45deg,
        transparent 0px,
        transparent 3px,
        var(--selection-color, rgba(255, 69, 0, 0.1)) 3px,
        var(--selection-color, rgba(255, 69, 0, 0.1)) 4px
      );
      background-size: 22px 22px; /* Explicit size to ensure right-anchoring works */
      background-position: 100% 0; /* Anchor to right edge */
      pointer-events: none;
      z-index: 0;
      border-right: 1px solid var(--accent-color, #ff4500); /* Vertical line */
      transition: border-right-width 0.1s ease-out;
    }

    :host([dragging]) .bar {
      background-color: var(--selection-color, rgba(255, 69, 0, 0.1));
      border-right-width: 3px; /* Thicker on drag */
      opacity: 1;
    }

    .value-display {
      position: relative;
      z-index: 1;
      padding: 0 4px;
      text-align: center;
      width: 100%;
      height: 100%;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    input {
      position: relative;
      z-index: 2;
      width: 100%;
      height: 100%;
      border: none;
      background: var(--input-bg, #222);
      color: var(--text-color, #fff);
      font-family: inherit;
      font-size: inherit;
      padding: 0 4px;
      margin: 0;
      outline: none;
      text-align: center;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('tabindex')) {
      this.setAttribute('tabindex', '0');
    }
    this.addEventListener('keydown', this.handleHostKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.handleHostKeyDown);
    this.dragOp?.dispose();
  }

  render() {
    if (this.isEditing) {
      return html`
        <input
          type="text"
          .value=${this.tempValue}
          @input=${this.handleInput}
          @keydown=${this.handleInputKeyDown}
          @blur=${this.commitEdit}
        />
      `;
    }

    let barWidth = 0;
    if (Number.isFinite(this.min) && Number.isFinite(this.max) && this.max > this.min) {
      const clamped = Math.max(this.min, Math.min(this.max, this.value));
      barWidth = ((clamped - this.min) / (this.max - this.min)) * 100;
    }

    return html`
      <div class="bar" style="width: ${barWidth}%"></div>
      <div
        class="value-display"
        @pointerdown=${this.handlePointerDown}
        @dblclick=${this.handleDoubleClick}
      >
        ${this.formatValue(this.value)}
      </div>
    `;
  }

  private formatValue(val: number): string {
    if (typeof val !== 'number' || isNaN(val)) {
      return '0';
    }
    if (Number.isInteger(this.step)) {
      return val.toString();
    }
    const decimals = this.step.toString().split('.')[1]?.length || 0;
    return val.toFixed(decimals);
  }

  private handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;

    // Check for double click
    if (e.detail === 2) {
      this.handleDoubleClick();
      return;
    }

    this.startValue = this.value;
    this.rect = this.getBoundingClientRect();
    this.isDragging = false;

    this.dragOp = new PointerDragOp(e, this, {
      threshold: 0, // Request immediate response

      move: (e, delta) => {
        this.updateValueFromDelta(e, delta[0]);
        if (!this.isDragging) {
          this.isDragging = true;
          this.setAttribute('dragging', '');
        }
      },

      accept: () => {
        // Commit
        if (this.isDragging) {
          this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
        }
        this.cleanupDrag();
        this.focus();
      },

      cancel: (reason) => {
        if (reason === CancelReason.UserAction || reason === CancelReason.Programmatic) {
          // Revert
          this.value = this.startValue;
          this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
        }
        this.cleanupDrag();
      }
    });
  }

  private updateValueFromDelta(e: PointerEvent, deltaX: number) {
    let newValue = this.value;

    if (e.shiftKey) {
      // Relative movement
      const range = this.max - this.min;
      if (!Number.isFinite(range)) {
        newValue = this.startValue + (deltaX * 0.1 * this.step);
      } else {
        const width = this.rect?.width || 100;
        const deltaValue = (deltaX / width) * range * 0.1; // 0.1 factor for fine control
        newValue = this.startValue + deltaValue;
      }
    } else {
      // Absolute jump
      if (this.rect && Number.isFinite(this.min) && Number.isFinite(this.max)) {
        const relativeX = e.clientX - this.rect.left;
        const ratio = Math.max(0, Math.min(1, relativeX / this.rect.width));
        newValue = this.min + ratio * (this.max - this.min);
      } else {
        // Fallback for unbounded: relative drag
        newValue = this.startValue + deltaX * this.step;
      }
    }

    // Quantize
    const precision = this.step.toString().split('.')[1]?.length || 0;
    const factor = Math.pow(10, precision);
    newValue = Math.round(newValue * factor) / factor;

    // Bound check (unless Ctrl held?)
    if (!e.ctrlKey) {
      newValue = Math.max(this.min, Math.min(this.max, newValue));
    }

    if (newValue !== this.value) {
      this.value = newValue;
      this.dispatchEvent(new CustomEvent('input', { detail: this.value }));
    }
  }

  private cleanupDrag() {
    this.removeAttribute('dragging');
    this.isDragging = false;
    this.rect = null;
    this.dragOp = null;
  }

  private async handleHostKeyDown(e: KeyboardEvent) {
    if (this.isEditing) return;

    if (/^[0-9.\-]$/.test(e.key) || e.key === 'Enter') {
      this.isEditing = true;
      this.tempValue = e.key === 'Enter' ? this.value.toString() : e.key;
      e.preventDefault();

      await this.updateComplete;
      const input = this.shadowRoot?.querySelector('input');
      if (input) {
        input.focus();
        if (e.key === 'Enter') {
          input.select();
        } else {
          input.selectionStart = input.selectionEnd = input.value.length;
        }
      }

    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      this.value = this.defaultValue;
      this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
    }
  }

  private async handleDoubleClick() {
    this.isEditing = true;
    this.tempValue = this.value.toString();

    await this.updateComplete;
    const input = this.shadowRoot?.querySelector('input');
    if (input) {
      input.focus();
      input.select();
    }
  }

  private handleInput(e: InputEvent) {
    this.tempValue = (e.target as HTMLInputElement).value;
  }

  private handleInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.commitEdit();
      e.stopPropagation();
    } else if (e.key === 'Escape') {
      this.isEditing = false;
      this.focus();
      e.stopPropagation();
    }
    e.stopPropagation();
  }

  private commitEdit() {
    if (this.tempValue.trim() === '') {
      this.value = this.defaultValue;
      this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
    } else {
      const num = parseFloat(this.tempValue);
      if (!isNaN(num)) {
        this.value = num;
        this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
      }
    }
    this.isEditing = false;
    this.focus();
  }
}

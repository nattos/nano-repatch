import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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

  private startX = 0;
  private startValue = 0;
  private rect: DOMRect | null = null;

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

    this.startX = e.clientX;
    this.startValue = this.value;
    this.rect = this.getBoundingClientRect();
    this.isDragging = false;

    this.addEventListener('pointermove', this.handlePointerMove);
    this.addEventListener('pointerup', this.handlePointerUp);
    this.addEventListener('lostpointercapture', this.handleLostPointerCapture);
  }

  private handlePointerMove = (e: PointerEvent) => {
    const deltaX = e.clientX - this.startX;
    this.setPointerCapture(e.pointerId);

    // Threshold to start dragging
    if (!this.isDragging && Math.abs(deltaX) > 1) {
      this.isDragging = true;
      this.setAttribute('dragging', '');
    }

    if (!this.isDragging) return;

    let newValue = this.value;

    if (e.shiftKey) {
      // Relative movement
      // Sensitivity: full range over 200px? or 1000px?
      // Let's say 1px = 0.1% of range? Or just use step?
      // User said "move relatively".
      // Let's use a pixel-to-value ratio.
      const range = this.max - this.min;
      // If range is infinite, default to step-based.
      if (!Number.isFinite(range)) {
         newValue = this.startValue + (deltaX * 0.1 * this.step);
      } else {
         // Fine control: 1px = 0.1% of range?
         // Or just slower than absolute.
         // Let's map 1px to (range / width) * 0.1
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
        // 1px = 1 step
        newValue = this.startValue + deltaX * this.step;
      }
    }

    // Quantize
    const precision = this.step.toString().split('.')[1]?.length || 0;
    const factor = Math.pow(10, precision);
    newValue = Math.round(newValue * factor) / factor;

    // Clamp (unless Ctrl held? User didn't mention Ctrl for jump, but kept it for bounds)
    // User said "jump to the value at the cursor's position". This implies bounds.
    if (!e.ctrlKey) {
       newValue = Math.max(this.min, Math.min(this.max, newValue));
    }

    if (newValue !== this.value) {
      this.value = newValue;
      this.dispatchEvent(new CustomEvent('change', { detail: this.value }));
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    this.cleanupDrag(e.pointerId);

    if (!this.isDragging) {
       this.focus();
    }
  };

  private handleLostPointerCapture = (e: PointerEvent) => {
    this.cleanupDrag(e.pointerId);
  };

  private cleanupDrag(pointerId: number) {
    this.releasePointerCapture(pointerId);
    this.removeEventListener('pointermove', this.handlePointerMove);
    this.removeEventListener('pointerup', this.handlePointerUp);
    this.removeEventListener('lostpointercapture', this.handleLostPointerCapture);
    this.removeAttribute('dragging');
    this.isDragging = false;
    this.rect = null;
  }

  private async handleHostKeyDown(e: KeyboardEvent) {
    if (this.isEditing) return;

    if (/^[0-9.\-]$/.test(e.key) || e.key === 'Enter') {
      this.isEditing = true;
      this.tempValue = e.key === 'Enter' ? this.value.toString() : e.key;
      e.preventDefault();

      // Wait for input to render then focus
      await this.updateComplete;
      const input = this.shadowRoot?.querySelector('input');
      if (input) {
        input.focus();
        // If we started with a character, maybe don't select all?
        // User said "The first digit does get entered correctly. However, the text box isn't selected".
        // If I type '5', tempValue is '5'. Cursor should be at end?
        // If I hit Enter, tempValue is full value. Select all?
        if (e.key === 'Enter') {
          input.select();
        } else {
          // Move cursor to end
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

    // Wait for input to render then focus and select all
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
      // Blank string -> Revert to default
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
    // Restore focus to the slider
    this.focus();
  }
}

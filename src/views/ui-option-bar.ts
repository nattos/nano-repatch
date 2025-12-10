import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('ui-option-bar')
export class UiOptionBar extends LitElement {
  @property({ type: String }) value = '';
  @property({ type: Array }) options: { label: string; value: string }[] = [];
  @property({ type: Boolean }) disabled = false;

  static readonly styles = css`
    :host {
      display: inline-flex;
      background-color: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 2px;
      gap: 2px;
      user-select: none;
    }

    .option {
      flex: 1;
      text-align: center;
      padding: 4px 12px;
      font-size: 11px;
      cursor: pointer;
      border-radius: 2px;
      color: var(--text-muted);
      transition: all 0.1s ease-out;
      border: 1px solid transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }

    .option:hover:not(.active):not(.disabled) {
      background-color: var(--button-hover);
      color: var(--text-color);
    }

    .option.active {
      background-color: var(--selection-color);
      border-color: var(--selection-border);
      color: var(--text-color);
      text-shadow: 0 0 2px rgba(255, 255, 255, 0.2);
      font-weight: 500;
    }

    .option.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `;

  private select(option: string) {
    if (this.disabled) return;
    if (this.value !== option) {
      this.value = option;
      this.dispatchEvent(new CustomEvent('change', {
        detail: { value: option },
        bubbles: true,
        composed: true
      }));
    }
  }

  render() {
    return html`
      ${this.options.map(opt => html`
        <div
          class="option ${this.value === opt.value ? 'active' : ''} ${this.disabled ? 'disabled' : ''}"
          @click=${() => this.select(opt.value)}
        >
          ${opt.label}
        </div>
      `)}
    `;
  }
}

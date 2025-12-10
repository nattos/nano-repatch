import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('inspector-tab-bar')
export class InspectorTabBar extends LitElement {
  @property({ type: String }) value = '';
  @property({ type: Array }) options: { label: string; value: string }[] = [];
  @property({ type: Boolean }) disabled = false;

  static readonly styles = css`
    :host {
      display: flex;
      background-color: var(--input-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
      user-select: none;
    }

    .tab {
      flex: 1;
      text-align: center;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      border-radius: 4px;
      color: var(--text-muted);
      transition: all 0.15s ease-out;
    }

    .tab:hover:not(.active):not(.disabled) {
      background-color: rgba(255, 255, 255, 0.05);
      color: var(--text-color);
    }

    .tab.active {
      background-color: var(--accent-color);
      color: #fff;
      font-weight: 500;
    }

    .tab.disabled {
      opacity: 0.5;
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
          class="tab ${this.value === opt.value ? 'active' : ''} ${this.disabled ? 'disabled' : ''}"
          @click=${() => this.select(opt.value)}
        >
          ${opt.label}
        </div>
      `)}
    `;
  }
}

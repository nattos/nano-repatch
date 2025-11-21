import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('ui-button')
export class UiButton extends LitElement {
  @property({ type: String }) icon = '';
  @property({ type: Boolean }) disabled = false;

  static readonly styles = css`
    :host {
      display: inline-block;
    }

    button {
      background-color: #333;
      color: white;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: background-color 0.2s;
    }

    button:hover:not(:disabled) {
      background-color: #444;
    }

    button:active:not(:disabled) {
      background-color: #222;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    i {
      font-size: 16px;
    }

    span {
      margin-left: 8px;
    }

    span:empty {
        margin-left: 0;
    }
  `;

  render() {
    return html`
      <button ?disabled=${this.disabled}>
        ${this.icon ? html`<i class="las ${this.icon}"></i>` : ''}
        <span><slot></slot></span>
      </button>
    `;
  }
}

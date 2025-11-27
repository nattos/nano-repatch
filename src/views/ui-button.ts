import 'line-awesome/dist/line-awesome/css/line-awesome.css';
// @ts-ignore
import lineawesomecss from 'line-awesome/dist/line-awesome/css/line-awesome.css?raw';
import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('ui-button')
export class UiButton extends LitElement {
  @property({ type: String }) icon = '';
  @property({ type: Boolean }) disabled = false;

  static readonly styles = [unsafeCSS(lineawesomecss), css`
    :host {
      display: inline-block;
    }

    button {
      background-color: var(--button-bg);
      color: var(--text-color);
      border: 1px solid var(--border-color);
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
      background-color: var(--button-hover);
    }

    button:active:not(:disabled) {
      background-color: var(--button-active);
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
  `];

  render() {
    return html`
      <button ?disabled=${this.disabled}>
        ${this.icon ? html`<i class="las ${this.icon}"></i>` : ''}
        <span><slot></slot></span>
      </button>
    `;
  }
}

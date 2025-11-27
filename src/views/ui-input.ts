import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { globalStyles } from '../styles';

@customElement('ui-input')
export class UiInput extends LitElement {
  @property({ type: String }) label = '';
  @property({ type: String }) value = '';
  @property({ type: String }) type = 'text';
  @property({ type: String }) placeholder = '';
  @property({ type: Number }) min?: number;
  @property({ type: Number }) max?: number;
  @property({ type: Number }) step?: number;

  static readonly styles = [
    ...globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
      }

      label {
        font-size: 0.8em;
        color: var(--text-muted);
      }

      input {
        background-color: var(--input-bg);
        border: 1px solid var(--border-color);
        color: var(--text-color);
        padding: 6px;
        border-radius: 4px;
        font-family: inherit;
        font-size: 1em;
        width: 100%;
        box-sizing: border-box;
      }

      input:focus {
        outline: none;
        border-color: var(--accent-color);
      }
    `
  ];

  private handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.value = target.value;
    this.dispatchEvent(new CustomEvent('change', {
      detail: { value: this.value },
      bubbles: true,
      composed: true
    }));
  }

  render() {
    return html`
      ${this.label ? html`<label>${this.label}</label>` : ''}
      <input
        .type=${this.type}
        .value=${this.value}
        .placeholder=${this.placeholder}
        .min=${this.min?.toString() || ''}
        .max=${this.max?.toString() || ''}
        .step=${this.step?.toString() || ''}
        @input=${this.handleInput}
      />
    `;
  }
}

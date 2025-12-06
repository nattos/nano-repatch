import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { globalStyles } from '../styles';

@customElement('ui-panel')
export class UiPanel extends LitElement {
  @property({ type: String }) title = '';

  static readonly styles = [
    ...globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--panel-bg);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        color: var(--text-color);
        overflow: hidden;
      }

      header {
        background-color: var(--panel-header-bg);
        padding: 10px;
        font-weight: bold;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .content {
        flex-grow: 1;
        overflow-y: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .actions {
        padding: 10px;
        border-top: 1px solid var(--border-color);
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }
    `
  ];

  render() {
    return html`
      <header>
        <span>${this.title}</span>
        <slot name="header-actions"></slot>
      </header>
      <div class="content">
        <slot></slot>
      </div>
      <div class="actions">
        <slot name="actions"></slot>
      </div>
    `;
  }
}

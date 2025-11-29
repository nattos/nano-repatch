import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appController, localController } from '../builder/controllers';
import { globalStyles } from '../styles';
import './ui-button';
import './ui-input';

@customElement('inspector-popup')
export class InspectorPopup extends MobxLitElement {
  static readonly styles = [
    ...globalStyles,
    css`
    :host {
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 260px;
      max-height: 80vh;
      background-color: var(--bg-color);
      color: var(--text-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
      z-index: 100;
    }

    .header {
      padding: 10px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      background-color: var(--panel-header-bg);
      border-radius: 8px 8px 0 0;
    }

    .content {
      padding: 20px;
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .field {
      margin-bottom: 0;
    }
  `];

  render() {
    const selection = localController.observableState.selection;
    const hasSelection = selection.size > 0;

    return html`
      <div class="header">
        <ui-button
          id="undo-btn"
          icon="la-undo"
          ?disabled=${!appController.canUndo}
          @click=${() => appController.undo()}
        ></ui-button>
        <ui-button
          id="redo-btn"
          icon="la-redo"
          ?disabled=${!appController.canRedo}
          @click=${() => appController.redo()}
        ></ui-button>
      </div>
      <div class="content">
        ${hasSelection ?
        (selection.size > 1 ?
          html`<div style="color: #ccc; text-align: center; margin-top: 20px;">${selection.size} nodes selected</div>` :
          Array.from(selection.values()).map(selectable => selectable.renderInspectorContent ? selectable.renderInspectorContent() : '')
        )
        : html`
          <div style="color: #666; text-align: center; margin-top: 50px;">
            Select a node to inspect
          </div>
        `}
      </div>
    `;
  }
}

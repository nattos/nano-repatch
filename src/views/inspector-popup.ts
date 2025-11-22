import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { AppController, LocalController } from '../builder/state';

import './ui-button';

@customElement('inspector-popup')
export class InspectorPopup extends MobxLitElement {
  @property({ attribute: false })
  controller!: AppController;

  @property({ attribute: false })
  localController!: LocalController;

  static readonly styles = css`
    :host {
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 300px;
      max-height: 80vh;
      background-color: #222;
      color: white;
      border: 1px solid #444;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
      z-index: 100;
    }

    .header {
      padding: 10px;
      border-bottom: 1px solid #444;
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .content {
      padding: 20px;
      flex: 1;
      overflow-y: auto;
    }

    .field {
      margin-bottom: 15px;
    }

    label {
      display: block;
      margin-bottom: 5px;
      color: #aaa;
      font-size: 12px;
    }

    select, input {
      width: 100%;
      padding: 8px;
      background-color: #333;
      border: 1px solid #555;
      color: white;
      border-radius: 4px;
    }
  `;

  render() {
    const selection = this.localController.observableState.selection;
    const hasSelection = selection.size > 0;

    return html`
      <div class="header">
        <ui-button
          id="undo-btn"
          icon="la-undo"
          ?disabled=${!this.controller.canUndo}
          @click=${() => this.controller.undo()}
        ></ui-button>
        <ui-button
          id="redo-btn"
          icon="la-redo"
          ?disabled=${!this.controller.canRedo}
          @click=${() => this.controller.redo()}
        ></ui-button>
      </div>
      <div class="content">
        ${hasSelection ?
        Array.from(selection.values()).map(selectable => selectable.renderInspectorContent ? selectable.renderInspectorContent() : '')
        : html`
          <div style="color: #666; text-align: center; margin-top: 50px;">
            Select a node to inspect
          </div>
        `}
      </div>
    `;
  }
}

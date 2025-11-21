import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GridNode, AppController } from '../builder/state';

import './ui-button';

@customElement('inspector-popup')
export class InspectorPopup extends MobxLitElement {
  @property({ attribute: false })
  node: GridNode | null = null;

  @property({ attribute: false })
  controller!: AppController;

  static readonly styles = css`
    :host {
      position: absolute;
      bottom: 20px;
      right: 20px;
      min-width: 250px;
      background-color: #222;
      color: white;
      border-left: 1px solid #444;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
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

  private handleTypeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    if (this.node) {
      this.controller.setNodeConfig(this.node.id, { typeId: target.value });
    }
  }

  private handleValueChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (this.node) {
      this.controller.setNodeConfig(this.node.id, { value: target.value });
    }
  }

  render() {
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
        ${this.node ? html`
          <h3>Inspector</h3>
          <div class="field">
            <label>Type:</label>
            <select .value=${this.node.config.typeId} @change=${this.handleTypeChange}>
              <option value="add">Add</option>
              <option value="literal">Literal</option>
              <option value="clamp">Clamp</option>
              <option value="apply">Apply</option>
            </select>
          </div>
          ${this.node.config.typeId === 'literal' ? html`
            <div class="field">
              <label>Value:</label>
              <input
                type="text"
                .value=${this.node.config.value || ''}
                @input=${this.handleValueChange}
              />
            </div>
          ` : ''}
        ` : html`
          <div style="color: #666; text-align: center; margin-top: 50px;">
            Select a node to inspect
          </div>
        `}
      </div>
    `;
  }
}

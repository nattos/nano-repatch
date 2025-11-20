import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GridNode, AppController } from '../builder/state';

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
      background-color: #222;
      color: white;
      padding: 20px;
      border-radius: 10px;
      display: none;
    }

    :host([active]) {
      display: block;
    }
  `;

  private handleTypeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    if (this.node) {
      this.controller.setNodeConfig(this.node.id, { typeId: target.value });
    }
  }

  render() {
    if (!this.node) return html``;

    return html`
      <div>
        <h3>Inspector</h3>
        <div>
          <label>Type:</label>
          <select .value=${this.node.config.typeId} @change=${this.handleTypeChange}>
            <option value="add">Add</option>
            <option value="literal">Literal</option>
            <option value="clamp">Clamp</option>
            <option value="apply">Apply</option>
          </select>
        </div>
      </div>
    `;
  }
}

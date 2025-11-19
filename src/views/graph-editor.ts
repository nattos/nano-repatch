import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { AppController } from '../builder/state';
import './graph-grid';
import './graph-node';

@customElement('graph-editor')
export class GraphEditor extends MobxLitElement {
  @state()
  private controller = new AppController();

  constructor() {
    super();
    // Add some initial nodes for testing
    this.controller.transaction(c => {
      c.createNode('add', 0, 0);
      c.createNode('literal', 1, 1);
    });
  }

  static readonly styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  render() {
    return html`
      <graph-grid .controller=${this.controller}></graph-grid>
    `;
  }
}

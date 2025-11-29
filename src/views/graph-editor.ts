import { MobxLitElement } from './mobx-lit-element';
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appController, localController, runtimeManager } from '../builder/controllers';
import './graph-grid';
import './inspector-popup';

@customElement('graph-editor')
export class GraphEditor extends MobxLitElement {
  static readonly styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      position: relative;
      user-select: none;
    }

    graph-grid {
      width: 100%;
      height: 100%;
    }
  `;

  render() {
    return html`
      <graph-grid></graph-grid>
      <inspector-popup></inspector-popup>
    `;
  }
}

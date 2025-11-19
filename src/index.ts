import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { globalStyles } from './styles';
import './views/graph-editor';

@customElement('nano-repatch')
export class App extends MobxLitElement {
  static readonly styles = [
    globalStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      color: var(--app-text-color1);
      background-color: var(--app-bg-color1);
      width: 100vw;
      height: 100vh;
      box-sizing: border-box;
    }
  `];


  render() {
    return html`
      <graph-editor></graph-editor>
    `;
  }
}
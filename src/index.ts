import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';

@customElement('nano-repatch')
export class App extends MobxLitElement {
  static readonly styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
      font-family: 'Questrial', sans-serif;
      color: #e0e0e0;
      background-color: #121212;
      width: 100%;
      box-sizing: border-box;
    }
  `;


  render() {
    return html`
      hello world
    `;
  }
}

document.body.innerHTML = '<nano-repatch></nano-repatch>';

import { MobxLitElement } from './views/mobx-lit-element';
import { localController } from './builder/controllers';
import { css, html } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { globalStyles } from './styles';
import './index.css';
import './customnodes/nicepattern/nodes';
import './customnodes/midi/nodes';
import './customnodes/expr/nodes';
import './customnodes/expr/register-ui';
import './customnodes/osc/nodes';
import './customnodes/resolume/nodes';
import './customnodes/debug/register-ui';
import './customnodes/curve/register-ui';
import './views/workspace-layout';
import './views/monaco-editor';

@customElement('nano-repatch')
export class App extends MobxLitElement {
  static readonly styles = [
    globalStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0;
      color: var(--app-text-color1);
      background-color: var(--app-bg-color1);
      width: 100vw;
      height: 100vh;
      box-sizing: border-box;
      overflow: hidden;
    }
`];

  @state()
  isReady = false;

  async connectedCallback() {
    super.connectedCallback();
    await localController.settingsLoaded;
    this.isReady = true;
  }


  render() {
    if (!this.isReady) return null;

    return html`
      <workspace-layout></workspace-layout>
    `;
  }
}
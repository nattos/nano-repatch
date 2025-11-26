import { MobxLitElement } from '@adobe/lit-mobx/lit-mobx';
import { css, html } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { globalStyles } from './styles';
import './structor/repository.ui';
import './customnodes/nicepattern/nodes.ui';
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


  render() {
    return html`
      <workspace-layout></workspace-layout>
    `;
  }
}
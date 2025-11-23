import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-sidebar';
import './workspace-panel';
import './graph-editor';

@customElement('workspace-layout')
export class WorkspaceLayout extends MobxLitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: #1e1e1e;
      color: #ccc;
    }

    app-sidebar {
      flex: 0 0 auto;
      z-index: 10;
    }

    .panels {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    workspace-panel {
      flex: 0 0 auto;
      transition: width 0.2s ease;
    }

    workspace-panel[hidden] {
      display: none;
    }

    .editor-container {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    graph-editor {
      width: 100%;
      height: 100%;
    }
  `;

  @state()
  workspaceOpen = true;

  render() {
    return html`
      <app-sidebar
        .active=${this.workspaceOpen}
        @toggle-workspace=${this.toggleWorkspace}
      ></app-sidebar>

      <div class="panels">
        ${this.workspaceOpen ? html`<workspace-panel></workspace-panel>` : ''}

        <div class="editor-container">
          <graph-editor></graph-editor>
        </div>
      </div>
    `;
  }

  private toggleWorkspace() {
    this.workspaceOpen = !this.workspaceOpen;
  }
}

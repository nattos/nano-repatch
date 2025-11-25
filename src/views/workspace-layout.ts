import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-sidebar';
import './workspace-panel';
import './io-tab';
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

    .sidebar-panel {
      flex: 0 0 auto;
      width: 300px;
      border-right: 1px solid #333;
      background: #252526;
      display: flex;
      flex-direction: column;
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
  activeTab: string | null = 'workspace';

  render() {
    return html`
      <app-sidebar
        .activeTab=${this.activeTab}
        @switch-tab=${this.handleSwitchTab}
      ></app-sidebar>

      <div class="panels">
        ${this.activeTab ? html`
          <div class="sidebar-panel">
            ${this.renderActivePanel()}
          </div>
        ` : ''}

        <div class="editor-container">
          <graph-editor></graph-editor>
        </div>
      </div>
    `;
  }

  private renderActivePanel() {
    switch (this.activeTab) {
      case 'workspace':
        return html`<workspace-panel></workspace-panel>`;
      case 'io':
        return html`<io-tab></io-tab>`;
      default:
        return null;
    }
  }

  private handleSwitchTab(e: CustomEvent) {
    const tab = e.detail.tab;
    if (this.activeTab === tab) {
      this.activeTab = null; // Toggle off
    } else {
      this.activeTab = tab;
    }
  }
}

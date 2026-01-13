import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './app-sidebar';
import './workspace-panel';
import './io-tab';
import './debug-tab';
import './graph-editor';
import './beat-sync-view';
import { localController } from '../builder/controllers';

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

    .sidebar-panel.wide {
      width: 500px;
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
  activeTab: string | null = 'workspace'; // Fallback initial state, will be updated by reaction

  connectedCallback() {
    super.connectedCallback();
    // Sync with local controller
    this.activeTab = localController.observableState.localSettings.activeTab;
  }

  render() {
    return html`
      <app-sidebar
        .activeTab=${localController.observableState.localSettings.activeTab}
        @switch-tab=${this.handleSwitchTab}
      ></app-sidebar>

      <div class="panels">
        ${localController.observableState.localSettings.activeTab ? html`
          <div class="sidebar-panel ${localController.observableState.localSettings.activeTab === 'beatsync' ? 'wide' : ''}">
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
    switch (localController.observableState.localSettings.activeTab) {
      case 'workspace':
        return html`<workspace-panel></workspace-panel>`;
      case 'io':
        return html`<io-tab></io-tab>`;
      case 'debug':
        return html`<debug-tab></debug-tab>`;
      case 'beatsync':
        return html`<beat-sync-view></beat-sync-view>`;
      default:
        return null;
    }
  }

  private handleSwitchTab(e: CustomEvent) {
    const tab = e.detail.tab;
    const current = localController.observableState.localSettings.activeTab;
    if (current === tab) {
      localController.setActiveTab(null);
    } else {
      localController.setActiveTab(tab);
    }
  }
}

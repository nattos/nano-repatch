import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { workspaceController } from '../builder/controllers';
import { globalStyles } from '../styles';
import './ui-button';
import './ui-panel';

@customElement('workspace-panel')
export class WorkspacePanel extends MobxLitElement {
  static readonly styles = [
    ...globalStyles,
    css`
      :host {
        display: block;
        height: 100%;
      }

      .file-icon {
        font-size: 1.2em;
      }

      .input-group {
        display: flex;
        gap: 5px;
        align-items: center;
        width: 100%;
      }

      .input-group input {
        flex: 1;
        background: var(--input-bg);
        border: 1px solid var(--border-color);
        color: var(--text-color);
        padding: 6px;
        border-radius: 4px;
        min-width: 0;
      }
      .empty-state {
        padding: 20px;
        text-align: center;
        color: #888;
        font-size: 12px;
      }
  `];

  @state() isCreatingGraph = false;
  @state() newGraphName = '';

  render() {
    const { files, currentGraphId } = workspaceController;

    return html`
      <ui-panel title="Workspace">
        <ui-button slot="header-actions" icon="la-sync" @click=${() => workspaceController.refreshFiles()} title="Refresh"></ui-button>

        <div class="ui-list">
          ${files.map((file) => html`
            <div
              class="ui-list-item ${file.name === currentGraphId ? 'selected' : ''}"
              @click=${() => workspaceController.openFile(file.name)}
            >
              <div style="display: flex; align-items: center; gap: 8px;">
                <i class="la la-file file-icon"></i>
                <span>${file.name}</span>
              </div>
            </div>
          `)}
        </div>

        <div slot="actions" style="display: flex; gap: 5px; width: 100%;">
          ${this.isCreatingGraph ? html`
            <div class="input-group">
              <input
                type="text"
                .value=${this.newGraphName}
                @input=${(e: any) => this.newGraphName = e.target.value}
                @keydown=${this.handleNewGraphKeydown}
                placeholder="Graph Name"
                autofocus
              />
              <ui-button icon="la-check" @click=${this.confirmNewGraph}></ui-button>
              <ui-button icon="la-times" @click=${this.cancelNewGraph}></ui-button>
            </div>
          ` : html`
            <ui-button icon="la-folder-open" @click=${() => workspaceController.openFolder()}>Open Folder</ui-button>
            <ui-button icon="la-plus" @click=${() => { this.isCreatingGraph = true; this.newGraphName = ''; }}>New Graph</ui-button>
          `}
        </div>
      </ui-panel>
    `;
  }

  private async confirmNewGraph() {
    if (this.newGraphName) {
      try {
        await workspaceController.createNewGraph(this.newGraphName);
        this.isCreatingGraph = false;
        this.newGraphName = '';
      } catch (e) {
        alert('Failed to create graph: ' + e);
      }
    }
  }

  private cancelNewGraph() {
    this.isCreatingGraph = false;
    this.newGraphName = '';
  }

  private handleNewGraphKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.confirmNewGraph();
    } else if (e.key === 'Escape') {
      this.cancelNewGraph();
    }
    e.stopPropagation();
  }
}

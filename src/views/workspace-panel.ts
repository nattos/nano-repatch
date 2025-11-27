import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
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

      .file-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .file-item {
        padding: 8px;
        cursor: pointer;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .file-item:hover {
        background-color: var(--button-hover);
      }

      .file-item.selected {
        background-color: var(--selection-color);
        color: white;
      }

      .file-icon {
        font-size: 1.2em;
      }
    `,
    css`
    .empty-state {
      padding: 20px;
      text-align: center;
      color: #888;
      font-size: 12px;
    }
  `];

  render() {
    const { currentDirHandle, files, currentGraphId, isWaitingForPermission } = workspaceController;
    const selectedFileIndex = files.findIndex(f => f.name === currentGraphId);

    return html`
      <ui-panel title="Workspace">
        <ui-button slot="header-actions" icon="la-sync" @click=${() => workspaceController.refreshFiles()} title="Refresh"></ui-button>

        <div class="file-list">
          ${files.map((file, index) => html`
            <div
              class="file-item ${file.name === currentGraphId ? 'selected' : ''}"
              @click=${() => workspaceController.openFile(file.name)}
            >
              <i class="la la-file file-icon"></i>
              <span>${file.name}</span>
            </div>
          `)}
        </div>

        <div slot="actions" style="display: flex; gap: 5px;">
          <ui-button icon="la-folder-open" @click=${() => workspaceController.openFolder()}>Open Folder</ui-button>
          <ui-button icon="la-plus" @click=${this.newGraph}>New Graph</ui-button>
        </div>
      </ui-panel>
    `;
  }

  private async newGraph() {
    const name = prompt('Enter graph name (e.g. my-graph):');
    if (name) {
      try {
        await workspaceController.createNewGraph(name);
      } catch (e) {
        alert('Failed to create graph: ' + e);
      }
    }
  }
}

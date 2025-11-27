import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { workspaceController } from '../builder/controllers';
import { globalStyles } from '../styles';

@customElement('workspace-panel')
export class WorkspacePanel extends MobxLitElement {
  static styles = [
    globalStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      width: 250px;
      background-color: #1e1e1e;
      border-right: 1px solid #3d3d3d;
      height: 100%;
      overflow: hidden;
    }

    .header {
      padding: 10px;
      border-bottom: 1px solid #3d3d3d;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background-color: #252526;
    }

    .title {
      font-weight: bold;
      font-size: 12px;
      text-transform: uppercase;
      color: #bbb;
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 5px 0;
    }

    .file-item {
      padding: 5px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      color: #ccc;
      font-size: 13px;
    }

    .file-item:hover {
      background-color: #2a2d2e;
    }

    .file-item.active {
      background-color: #37373d;
      color: #fff;
    }

    .file-icon {
      margin-right: 6px;
      width: 14px;
      height: 14px;
      fill: currentColor;
      opacity: 0.7;
    }

    button {
      background-color: #0e639c;
      color: white;
      border: none;
      padding: 4px 8px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 11px;
    }

    button:hover {
      background-color: #1177bb;
    }

    .empty-state {
      padding: 20px;
      text-align: center;
      color: #888;
      font-size: 12px;
    }

    .actions {
        display: flex;
        gap: 5px;
        padding: 5px 10px;
        border-bottom: 1px solid #3d3d3d;
    }

    .action-btn {
        background: none;
        border: 1px solid #3d3d3d;
        color: #ccc;
        cursor: pointer;
        padding: 2px 6px;
        font-size: 16px;
        border-radius: 3px;
    }

    .action-btn:hover {
        background-color: #3d3d3d;
    }
  `];

  render() {
    const { currentDirHandle, files, currentGraphId, isWaitingForPermission } = workspaceController;

    return html`
      <div class="header">
        <span class="title">Workspace</span>
        ${!currentDirHandle ? html`
          <button @click=${() => workspaceController.openFolder()}>Open Folder</button>
        ` : html`
          <button @click=${() => workspaceController.refreshFiles()} title="Refresh"><i class="la la-sync"></i></button>
        `}
      </div>

      ${currentDirHandle ? html`
          <div class="actions">
            <button class="action-btn" @click=${this.createNew} title="New Graph">+</button>
          </div>
      ` : ''}

      ${isWaitingForPermission && currentGraphId ? html`
        <div style="padding: 10px; background: #333; border-bottom: 1px solid #444;">
            <div style="margin-bottom: 5px; font-size: 12px; color: #ccc;">
                Graph <b>${currentGraphId}</b> requested.
            </div>
            <button @click=${() => workspaceController.openFile(currentGraphId)} style="width: 100%">
                Load Graph
            </button>
        </div>
      ` : ''}

      <div class="content">
        ${!currentDirHandle ? html`
          <div class="empty-state">
            No folder opened.<br>
            Open a folder to manage graphs.
          </div>
        ` : files.length === 0 ? html`
          <div class="empty-state">
            No .json files found.
          </div>
        ` : files.map(file => html`
          <div
            class="file-item ${file.name === currentGraphId ? 'active' : ''}"
            @dblclick=${() => workspaceController.openFile(file.name)}
          >
            <i class="la la-file file-icon"></i>
            ${file.name}
          </div>
        `)}
      </div>
    `;
  }

  private async createNew() {
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

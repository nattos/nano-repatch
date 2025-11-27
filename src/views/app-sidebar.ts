import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { appController } from '../builder/controllers';
import { globalStyles } from '../styles';

@customElement('app-sidebar')
export class AppSidebar extends MobxLitElement {
  static styles = [
    globalStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      width: 50px;
      background-color: #2d2d2d;
      border-right: 1px solid #3d3d3d;
      height: 100%;
      align-items: center;
      padding-top: 10px;
    }

    .icon {
      width: 32px;
      height: 32px;
      margin-bottom: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      color: #aaa;
      transition: all 0.2s;
    }

    .icon:hover {
      background-color: #3d3d3d;
      color: #fff;
    }

    .icon.active {
      background-color: #4d4d4d;
      color: #fff;
      border-left: 3px solid #646cff;
    }

    svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    .spacer {
      flex: 1;
    }

    .icon.disabled {
      opacity: 0.5;
      cursor: default;
      pointer-events: none;
    }
  `];

  @property({ type: String })
  activeTab: string | null = null;

  render() {
    return html`
      <div
        class="icon ${this.activeTab === 'workspace' ? 'active' : ''}"
        @click=${() => this.switchTab('workspace')}
        title="Workspace"
      >
        <i class="la la-folder-open" style="font-size: 20px;"></i>
      </div>

      <div
        class="icon ${this.activeTab === 'io' ? 'active' : ''}"
        @click=${() => this.switchTab('io')}
        title="I/O"
      >
        <i class="la la-exchange-alt" style="font-size: 20px;"></i>
      </div>

      <div class="spacer"></div>

      <div
        class="icon ${!appController.canUndo ? 'disabled' : ''}"
        @click=${() => appController.undo()}
        title="Undo"
      >
        <i class="la la-undo" style="font-size: 20px;"></i>
      </div>

      <div
        class="icon ${!appController.canRedo ? 'disabled' : ''}"
        @click=${() => appController.redo()}
        title="Redo"
      >
        <i class="la la-redo" style="font-size: 20px;"></i>
      </div>
    `;
  }

  private switchTab(tab: string) {
    this.dispatchEvent(new CustomEvent('switch-tab', {
      detail: { tab },
      bubbles: true,
      composed: true
    }));
  }
}

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
      background-color: var(--panel-bg);
      border-right: 1px solid var(--border-color);
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
      color: var(--text-muted);
      transition: all 0.2s;
    }

    .icon:hover {
      background-color: var(--button-hover);
      color: var(--text-color);
    }

    .icon.active {
      background-color: var(--button-active);
      color: var(--accent-color);
      border-left: 3px solid var(--accent-color);
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
    .branding {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 0;
      opacity: 0.4;
      transition: opacity 0.2s;
      cursor: default;
    }

    .branding:hover {
      opacity: 0.8;
    }

    .branding-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      letter-spacing: 1px;
      color: #fff;
      font-weight: 500;
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

      <div
        class="icon ${this.activeTab === 'debug' ? 'active' : ''}"
        @click=${() => this.switchTab('debug')}
        title="Debug"
      >
        <i class="la la-bug" style="font-size: 20px;"></i>
      </div>

      <div class="spacer"></div>

      <div class="branding" title="nano-repatch">
        <i class="la la-microchip" style="font-size: 16px; color: #fff; transform: rotate(90deg);"></i>
        <span class="branding-text">nano-repatch</span>
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

import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('app-sidebar')
export class AppSidebar extends MobxLitElement {
  static styles = css`
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
  `;

  @property({ type: Boolean })
  active = false;

  render() {
    return html`
      <div class="icon ${this.active ? 'active' : ''}" @click=${this.toggle} title="Workspace">
        <svg viewBox="0 0 24 24">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
      </div>
    `;
  }

  private toggle() {
    this.dispatchEvent(new CustomEvent('toggle-workspace', {
      bubbles: true,
      composed: true
    }));
  }
}

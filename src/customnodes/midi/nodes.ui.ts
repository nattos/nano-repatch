import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GridNode } from '../../builder/state';
import { GraphNodeRenderHandlers } from '../../structor/repository';
import { MobxLitElement } from '../../views/mobx-lit-element';
import { appController } from '../../builder/controllers';

@customElement('midi-trigger-renderer')
export class MidiTriggerRenderer extends MobxLitElement {
  @property({ attribute: false }) node!: GridNode;
  @property({ attribute: false }) handlers!: GraphNodeRenderHandlers;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      padding: 4px;
      box-sizing: border-box;
    }

    button {
      width: 100%;
      height: 100%;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #ccc;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.1s;
    }

    button:hover {
      background: #3a3a3a;
      border-color: #666;
      color: #fff;
    }

    button:active {
      background: #666;
      transform: translateY(1px);
    }

    .trigger-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .trigger-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.3);
    }
    .trigger-btn:active {
        background: rgba(255, 255, 255, 0.2);
    }
  `;

  private onTrigger() {
    // Update 'trigger' value in config to signal execution
    // We import appController dynamically or assume global availability if needed,
    // but better to import it since we are in main thread context.
    const currentValues = this.node.config.values || {};
    // Toggle or randomize to ensure change detected
    const newVal = (currentValues.trigger || 0) + 1;

    appController.setNodeConfig(this.node.id, {
      values: { ...currentValues, trigger: newVal }
    }, { skipHistory: true });
  }

  render() {
    return html`
      <button class="trigger-btn"
        @mousedown=${(e: Event) => e.stopPropagation()}
        @dblclick=${(e: Event) => e.stopPropagation()}
        @click=${this.onTrigger}
      >
        TRIGGER
      </button>
    `;
  }
}


export const MidiTriggerBodyRenderer = (node: GridNode, handlers: GraphNodeRenderHandlers) => {
  return html`<midi-trigger-renderer .node=${node} .handlers=${handlers}></midi-trigger-renderer>`;
};

export const MidiTriggerBodyHeight = (node: GridNode) => 48;

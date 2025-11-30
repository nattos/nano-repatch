import { html, css, HTMLTemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { Selectable } from '../builder/state';
import { ResolumeComposition, ResolumeLayer, ResolumeClip, ResolumeEffect, ResolumeParameter } from '../io/resolume/state';

@customElement('resolume-inspector')
export class ResolumeInspector extends MobxLitElement {
  static styles = [
    css`
      :host {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        font-size: 11px;
        color: #ddd;
        background-color: #1a1a1a;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }

      h3 {
        margin: 0;
        padding: 4px 8px;
        background-color: #2d5e4c; /* Teal header */
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        border-bottom: 1px solid #1a1a1a;
        display: flex;
        align-items: center;
      }

      h3::before {
        content: '▼';
        font-size: 8px;
        margin-right: 6px;
        opacity: 0.8;
      }

      .inspector-section {
        margin-bottom: 2px;
      }

      .parameters {
        padding: 4px 0;
        background-color: #262626;
      }

      .parameter-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 2px 8px;
        min-height: 18px;
      }

      .parameter-row:hover {
        background-color: #333;
      }

      .label {
        color: #aaa;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-right: 10px;
      }

      .value {
        color: #40a0ff; /* Blue for values */
        font-family: monospace;
      }

      .effects-section h4 {
        margin: 0;
        padding: 4px 8px;
        background-color: #2d5e4c;
        color: #fff;
        font-size: 11px;
        font-weight: normal;
        cursor: pointer;
      }

      details {
        background-color: #262626;
        margin-bottom: 1px;
      }

      summary {
        padding: 4px 8px;
        cursor: pointer;
        background-color: #333;
        color: #eee;
        font-weight: bold;
        list-style: none;
      }

      summary::-webkit-details-marker {
        display: none;
      }

      summary::before {
        content: '▶';
        font-size: 8px;
        margin-right: 6px;
        display: inline-block;
        transition: transform 0.1s;
      }

      details[open] summary::before {
        transform: rotate(90deg);
      }

      details[open] summary {
        background-color: #2d5e4c;
      }

      img.thumbnail {
        width: 100%;
        height: auto;
        display: block;
        border-bottom: 1px solid #444;
      }

      /* Rich Controls */
      .range-control {
        flex: 2;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .range-track {
        flex: 1;
        height: 4px;
        background-color: #444;
        border-radius: 2px;
        position: relative;
        overflow: hidden;
      }

      .range-fill {
        height: 100%;
        background-color: #40a080; /* Teal accent */
      }

      .range-value {
        font-family: monospace;
        color: #40a0ff;
        width: 40px;
        text-align: right;
      }

      .boolean-control {
        padding: 2px 8px;
        background-color: #333;
        border-radius: 2px;
        cursor: pointer;
        font-size: 10px;
        text-transform: uppercase;
      }

      .boolean-control.active {
        background-color: #40a080;
        color: #fff;
      }

      .choice-control {
        background-color: #333;
        padding: 2px 6px;
        border-radius: 2px;
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }

      .dropdown-arrow {
        font-size: 8px;
        opacity: 0.7;
      }

      .color-control {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .color-preview {
        width: 12px;
        height: 12px;
        border-radius: 2px;
        border: 1px solid #555;
      }

      .event-button {
        background-color: #444;
        border: none;
        color: #ddd;
        padding: 2px 8px;
        border-radius: 2px;
        cursor: pointer;
        font-size: 10px;
      }

      .event-button:hover {
        background-color: #555;
      }

      .event-button:active {
        background-color: #40a080;
      }
    `
  ];

  @property({ attribute: false })
  target: ResolumeComposition | ResolumeLayer | ResolumeClip | ResolumeEffect | null = null;

  render() {
    if (!this.target) return html``;

    if (this.target instanceof ResolumeComposition) {
      return this.renderComposition(this.target);
    } else if (this.target instanceof ResolumeLayer) {
      return this.renderLayer(this.target);
    } else if (this.target instanceof ResolumeClip) {
      return this.renderClip(this.target);
    } else if (this.target instanceof ResolumeEffect) {
      return this.renderEffect(this.target);
    }
    return html``;
  }

  private renderComposition(comp: ResolumeComposition) {
    return html`
      <div class="inspector-section">
        <h3>Composition</h3>
        <div class="parameters">
          ${comp.params.map(p => this.renderParameter(p))}
        </div>
      </div>
      ${this.renderEffects(comp.effects)}
    `;
  }

  private renderLayer(layer: ResolumeLayer) {
    return html`
      <div class="inspector-section">
        <h3>${layer.name}</h3>
        <div class="parameters">
          ${layer.params.map(p => this.renderParameter(p))}
        </div>
      </div>
      ${this.renderEffects(layer.effects)}
    `;
  }

  private renderClip(clip: ResolumeClip) {
    return html`
      <div class="inspector-section">
        <h3>${clip.name}</h3>
        ${clip.thumbnail ? html`<img class="thumbnail" src="http://127.0.0.1:8080${clip.thumbnail}">` : ''}
        <div class="parameters">
          ${clip.params.map(p => this.renderParameter(p))}
        </div>
      </div>
      ${this.renderEffects(clip.effects)}
    `;
  }

  private renderEffect(effect: ResolumeEffect) {
    return html`
      <div class="inspector-section">
        <h3>${effect.name}</h3>
        <div class="parameters">
          ${effect.params.map(p => this.renderParameter(p))}
        </div>
      </div>
    `;
  }

  private renderEffects(effects: ResolumeEffect[]) {
    if (effects.length === 0) return '';
    return html`
      <div class="effects-section">
        ${effects.map(e => html`
          <details open>
            <summary>${e.name}</summary>
            <div class="parameters">
              ${e.params.map(p => this.renderParameter(p))}
            </div>
          </details>
        `)}
      </div>
    `;
  }

  private renderParameter(param: ResolumeParameter) {
    let control = html`<span class="value">${param.value}</span>`;

    switch (param.type) {
      case 'ParamRange':
        control = this.renderRange(param);
        break;
      case 'ParamBoolean':
        control = this.renderBoolean(param);
        break;
      case 'ParamChoice':
        control = this.renderChoice(param);
        break;
      case 'ParamColor':
        control = this.renderColor(param);
        break;
      case 'ParamEvent':
        control = this.renderEvent(param);
        break;
      case 'ParamString':
      case 'ParamText':
        control = this.renderString(param);
        break;
    }

    return html`
      <div
        class="parameter-row"
        draggable="true"
        @dragstart=${(e: DragEvent) => this.handleDragStart(e, param)}
      >
        <span class="label" title="${param.path}">${param.name}</span>
        ${control}
      </div>
    `;
  }

  private renderRange(param: ResolumeParameter) {
    const percentage = (typeof param.value === 'number') ? Math.min(100, Math.max(0, param.value * 100)) : 0;
    return html`
      <div class="range-control">
        <div class="range-track">
          <div class="range-fill" style="width: ${percentage}%"></div>
        </div>
        <span class="range-value">${Number(param.value).toFixed(2)}</span>
      </div>
    `;
  }

  private renderBoolean(param: ResolumeParameter) {
    return html`
      <div class="boolean-control ${param.value ? 'active' : ''}">
        ${param.value ? 'On' : 'Off'}
      </div>
    `;
  }

  private renderChoice(param: ResolumeParameter) {
    return html`
      <div class="choice-control">
        ${param.value} <span class="dropdown-arrow">▼</span>
      </div>
    `;
  }

  private renderColor(param: ResolumeParameter) {
    return html`
      <div class="color-control">
        <div class="color-preview" style="background-color: ${param.value}"></div>
        <span class="color-value">${param.value}</span>
      </div>
    `;
  }

  private renderEvent(param: ResolumeParameter) {
    return html`
      <button class="event-button">Trigger</button>
    `;
  }

  private renderString(param: ResolumeParameter) {
    return html`<span class="value string-value">${param.value}</span>`;
  }

  private handleDragStart(e: DragEvent, param: ResolumeParameter) {
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'resolume:parameter',
        path: param.path,
        name: param.name
      }));
      e.dataTransfer.effectAllowed = 'copy';
    }
  }
}

export class ResolumeInspectorWrapper implements Selectable {
  constructor(public target: ResolumeComposition | ResolumeLayer | ResolumeClip | ResolumeEffect) { }

  get path() {
    return this.target.path;
  }

  renderInspectorContent(): HTMLTemplateResult {
    return html`<resolume-inspector .target=${this.target}></resolume-inspector>`;
  }
}

import { html, HTMLTemplateResult } from 'lit';
import { Selectable } from '../builder/state';
import { ResolumeComposition, ResolumeLayer, ResolumeClip, ResolumeEffect, ResolumeParameter } from '../io/resolume/state';

export class ResolumeInspectorWrapper implements Selectable {
  constructor(public target: ResolumeComposition | ResolumeLayer | ResolumeClip | ResolumeEffect) { }

  get path() {
    return this.target.path;
  }

  renderInspectorContent(): HTMLTemplateResult {
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
        ${this.renderEffects(comp.effects)}
      </div>
    `;
  }

  private renderLayer(layer: ResolumeLayer) {
    return html`
      <div class="inspector-section">
        <h3>${layer.name} (Layer)</h3>
        <div class="parameters">
          ${layer.params.map(p => this.renderParameter(p))}
        </div>
        ${this.renderEffects(layer.effects)}
      </div>
    `;
  }

  private renderClip(clip: ResolumeClip) {
    return html`
      <div class="inspector-section">
        <h3>${clip.name} (Clip)</h3>
        ${clip.thumbnail ? html`<img src="http://127.0.0.1:8080${clip.thumbnail}" style="max-width: 100%; margin-bottom: 10px; border-radius: 4px;">` : ''}
        <div class="parameters">
          ${clip.params.map(p => this.renderParameter(p))}
        </div>
        ${this.renderEffects(clip.effects)}
      </div>
    `;
  }

  private renderEffect(effect: ResolumeEffect) {
    return html`
      <div class="inspector-section">
        <h3>${effect.name} (Effect)</h3>
        <div class="parameters">
          ${effect.params.map(p => this.renderParameter(p))}
        </div>
      </div>
    `;
  }

  private renderEffects(effects: ResolumeEffect[]) {
    if (effects.length === 0) return '';
    return html`
      <div class="effects-section" style="margin-top: 15px;">
        <h4 style="margin-bottom: 5px; color: var(--text-muted);">Effects</h4>
        ${effects.map(e => html`
          <details style="margin-bottom: 5px;">
            <summary style="cursor: pointer; padding: 4px; background: var(--input-bg); border-radius: 4px;">${e.name}</summary>
            <div style="padding-left: 10px; padding-top: 5px;">
              ${e.params.map(p => this.renderParameter(p))}
            </div>
          </details>
        `)}
      </div>
    `;
  }

  private renderParameter(param: ResolumeParameter) {
    return html`
      <div
        class="ui-list-item"
        draggable="true"
        @dragstart=${(e: DragEvent) => this.handleDragStart(e, param)}
        style="font-size: 0.9em;"
      >
        <span class="label" title="${param.path}">${param.name}</span>
        <span class="value" style="color: var(--accent-color);">${param.value}</span>
      </div>
    `;
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

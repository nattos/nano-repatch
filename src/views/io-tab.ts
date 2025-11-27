import { html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { resolumeManager } from '../io/resolume/manager';
import { ResolumeComposition, ResolumeLayer, ResolumeClip, ResolumeParameter, ResolumeEffect } from '../io/resolume/state';
import { midiManager } from '../io/midi/manager';
import { MidiDevice, MidiEvent } from '../io/midi/state';

@customElement('io-tab')
export class IOTab extends MobxLitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #1e1e1e;
      color: #eee;
      font-family: 'Inter', sans-serif;
      overflow: hidden;
    }

    .header {
      padding: 10px;
      border-bottom: 1px solid #333;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .connect-btn {
      background: #4CAF50;
      color: white;
      border: none;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
    }

    .connect-btn:disabled {
        background: #555;
        cursor: default;
    }

    .tree {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
    }

    .item {
      margin-left: 10px;
      margin-bottom: 4px;
    }

    .label {
      display: flex;
      align-items: center;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
    }

    .label:hover {
      background: #333;
    }

    .param {
      color: #aaa;
      font-size: 0.9em;
      cursor: grab;
    }

    .param:hover {
        color: #fff;
        background: #444;
    }

    .thumbnail {
      width: 40px;
      height: 30px;
      background: #000;
      margin-right: 8px;
      object-fit: cover;
    }

    details > summary {
        list-style: none;
        cursor: pointer;
    }

    details > summary::-webkit-details-marker {
        display: none;
    }

    details > summary::before {
        content: '▶';
        font-size: 0.8em;
        margin-right: 5px;
        display: inline-block;
        transition: transform 0.1s;
    }

    details[open] > summary::before {
        transform: rotate(90deg);
    }
    details[open] > summary::before {
        transform: rotate(90deg);
    }

    .section-title {
      padding: 10px;
      font-weight: bold;
      background: #252525;
      border-bottom: 1px solid #333;
      border-top: 1px solid #333;
    }

    .midi-devices {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 10px;
    }

    .chip {
      background: #333;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.8em;
      cursor: pointer;
      border: 1px solid transparent;
    }

    .chip.selected {
      background: #4CAF50;
      color: white;
    }

    .chip.disconnected {
      opacity: 0.5;
    }

    .midi-events {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .event-card {
      background: #333;
      padding: 8px;
      border-radius: 4px;
      cursor: grab;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .event-card:hover {
      background: #444;
    }

    .event-info {
      display: flex;
      flex-direction: column;
    }

    .event-type {
      font-size: 0.8em;
      color: #aaa;
    }

    .event-value {
      font-weight: bold;
    }
  `;

  render() {
    const { state, ws } = resolumeManager;
    const connected = !!ws;

    return html`
      <div class="header">
        <span>Resolume Arena</span>
        <button class="connect-btn" @click=${() => resolumeManager.connect()} ?disabled=${connected}>
          ${connected ? 'Connected' : 'Connect'}
        </button>
      </div>
      <div class="tree">
        <div class="section-title">Resolume</div>
        ${this.renderComposition(state)}

        <div class="section-title">MIDI</div>
        ${this.renderMidiSection()}
      </div>
    `;
  }

  renderComposition(comp: ResolumeComposition) {
    return html`
      <div class="item">
        <details open>
            <summary class="label">Composition</summary>
            ${comp.params.map(p => this.renderParameter(p))}
            ${comp.layers.map(l => this.renderLayer(l))}
        </details>
      </div>
    `;
  }

  renderLayer(layer: ResolumeLayer) {
    return html`
      <div class="item">
        <details>
            <summary class="label">${layer.name}</summary>
            ${layer.params.map(p => this.renderParameter(p))}
            ${layer.effects.map(e => this.renderEffect(e))}
            ${layer.clips.map(c => this.renderClip(c))}
        </details>
      </div>
    `;
  }

  renderClip(clip: ResolumeClip) {
    return html`
      <div class="item">
        <details>
            <summary class="label">
                ${clip.thumbnail ? html`<img class="thumbnail" src="http://127.0.0.1:8080${clip.thumbnail}">` : ''}
                ${clip.name}
            </summary>
            ${clip.params.map(p => this.renderParameter(p))}
            ${clip.effects.map(e => this.renderEffect(e))}
        </details>
      </div>
    `;
  }

  renderEffect(effect: ResolumeEffect) {
    return html`
        <div class="item">
            <details>
                <summary class="label">FX: ${effect.name}</summary>
                ${effect.params.map(p => this.renderParameter(p))}
            </details>
        </div>
      `;
  }

  renderParameter(param: ResolumeParameter) {
    return html`
      <div
        class="item param"
        draggable="true"
        @dragstart=${(e: DragEvent) => this.handleDragStart(e, param)}
      >
        ${param.name} <span style="opacity: 0.5">(${param.value})</span>
      </div>
    `;
  }

  handleDragStart(e: DragEvent, param: ResolumeParameter) {
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'resolume:parameter',
        path: param.path,
        name: param.name
      }));
      e.dataTransfer.effectAllowed = 'copy';
    }
  }

  renderMidiSection() {
    const { state } = midiManager;
    return html`
      <div class="midi-devices">
        ${Array.from(state.devices.values()).map(d => this.renderDevice(d))}
      </div>
      <div class="midi-events">
        ${state.recentEvents.map(e => this.renderMidiEvent(e))}
      </div>
    `;
  }

  renderDevice(device: MidiDevice) {
    const selected = midiManager.state.selectedDeviceIds.has(device.id);
    return html`
      <div
        class="chip ${selected ? 'selected' : ''} ${device.state === 'disconnected' ? 'disconnected' : ''}"
        @click=${() => midiManager.state.toggleDeviceSelection(device.id)}
      >
        ${device.name}
      </div>
    `;
  }

  renderMidiEvent(event: MidiEvent) {
    const label = event.type === 'cc' ? `CC ${event.target}` : `Note ${event.target}`;
    const value = event.type === 'note_off' ? 'Off' : event.value;

    return html`
      <div
        class="event-card"
        draggable="true"
        @dragstart=${(e: DragEvent) => this.handleMidiDragStart(e, event)}
      >
        <div class="event-info">
          <span class="event-type">Ch ${event.channel}</span>
          <span>${label}</span>
        </div>
        <div class="event-value">${value}</div>
      </div>
    `;
  }

  handleMidiDragStart(e: DragEvent, event: MidiEvent) {
    if (!e.dataTransfer) return;

    let nodeType = '';
    let config: any = {};

    if (event.type === 'cc') {
      nodeType = 'midi_cc';
      config = {
        channel: event.channel,
        cc: event.target,
        deviceId: event.deviceId
      };
    } else {
      nodeType = 'midi_note';
      config = {
        channel: event.channel,
        note: event.target,
        deviceId: event.deviceId
      };
    }

    e.dataTransfer.setData('application/json', JSON.stringify({
      type: nodeType,
      config
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }
}

import { html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { resolumeManager } from '../io/resolume/manager';
import { ResolumeComposition, ResolumeLayer, ResolumeClip, ResolumeParameter, ResolumeEffect } from '../io/resolume/state';
import { midiManager } from '../io/midi/manager';
import { MidiDevice, MidiEvent } from '../io/midi/state';
import { globalStyles } from '../styles';
import './ui-button';
import './ui-panel';

@customElement('io-tab')
export class IOTab extends MobxLitElement {
  static readonly styles = [
    ...globalStyles,
    css`
      :host {
        display: block;
        height: 100%;
      }

      .section {
        margin-bottom: 20px;
      }

      .section-header {
        font-weight: bold;
        margin-bottom: 10px;
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 5px;
        color: var(--text-muted);
      }

      .device-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      .device-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px;
        background-color: var(--input-bg);
        border-radius: 4px;
      }

      .status {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: #555;
      }

      .status.connected {
        background-color: var(--port-connected);
        box-shadow: 0 0 5px var(--port-connected);
      }

      .resolume-status {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
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
  `];

  render() {
    const { state, ws } = resolumeManager;
    const connected = !!ws;

    return html`
      <ui-panel title="I/O Devices">
        <div class="section">
          <div class="section-header">MIDI Devices</div>
          <div class="device-list">
            ${Array.from(midiManager.state.devices.values()).map(input => html`
              <div class="device-item">
                <span>${input.name}</span>
                <div class="status ${input.state === 'connected' ? 'connected' : ''}"></div>
              </div>
            `)}
            ${midiManager.state.devices.size === 0 ? html`<div>No MIDI inputs found</div>` : ''}
          </div>
        </div>

        <div class="section">
          <div class="section-header">Resolume Arena</div>
          <div class="resolume-status">
            <div class="status ${resolumeManager.isConnected ? 'connected' : ''}"></div>
            <span>${resolumeManager.isConnected ? 'Connected' : 'Disconnected'}</span>
            <ui-button
              @click=${this.toggleResolume}
              ?disabled=${resolumeManager.isConnected}
              icon="la-plug"
            >
              ${resolumeManager.isConnected ? 'Connected' : 'Connect'}
            </ui-button>
          </div>
          ${resolumeManager.isConnected ? this.renderComposition(resolumeManager.state) : ''}
        </div>
      </ui-panel>
    `;
  }

  toggleResolume() {
    if (resolumeManager.isConnected) {
      resolumeManager.disconnect();
    } else {
      resolumeManager.connect();
    }
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

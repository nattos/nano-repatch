import './ui-button';
import './ui-panel';
import { html, css } from 'lit';
import { runtimeManager } from '../builder/controllers';
import { customElement } from 'lit/decorators.js';
import { MobxLitElement } from './mobx-lit-element';
import { resolumeManager } from '../io/resolume/manager';
import { ResolumeLayer, ResolumeClip } from '../io/resolume/state';
import { ResolumeInspectorWrapper } from './resolume-inspector';
import { midiManager } from '../io/midi/manager';
import { MidiDevice } from '../io/midi/state';
import { globalStyles } from '../styles';
import { localController } from '../builder/controllers';
import { MidiEvent } from '../io/midi/types';

@customElement('io-tab')
export class IOTab extends MobxLitElement {
  static readonly styles = [
    ...globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--panel-bg);
        overflow: hidden;
      }

      .tab-header {
        padding: 10px 15px;
        font-weight: bold;
        font-size: 1.1em;
        border-bottom: 1px solid var(--border-color);
        background-color: var(--panel-header-bg);
        flex-shrink: 0;
      }

      .container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-bottom: 20px;
        flex: 1;
        overflow-y: auto;
      }

      .section {
        display: flex;
        flex-direction: column;
      }

      .section-header {
        font-weight: bold;
        margin-bottom: 10px;
        border-bottom: 1px solid var(--border-color);
        padding: 5px 15px;
        color: var(--text-muted);
      }

      .resolume-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .composition-list {
        flex: 0 0 250px;
        border-right: 1px solid var(--border-color);
        overflow-y: auto;
        padding-right: 10px;
      }

      .clips-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 10px;
        align-content: start;
        padding: 5px;
        border-top: 1px solid var(--border-color);
        margin-top: 10px;
        padding-top: 15px;
      }

      .list-item {
        padding: 8px;
        cursor: pointer;
        border-radius: 4px;
        margin-bottom: 2px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .list-item:hover {
        background-color: var(--button-hover);
      }

      .list-item.selected {
        background-color: var(--selection-color);
        border: 1px solid var(--selection-border);
        color: var(--text-color);
      }

      .clip-card {
        background-color: var(--input-bg);
        border-radius: 4px;
        overflow: hidden;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        aspect-ratio: 4/3;
        border: 2px solid transparent;
      }

      .clip-card:hover {
        border-color: var(--text-muted);
      }

      .clip-card.selected {
        border-color: var(--accent-color);
      }

      .clip-thumb {
        flex: 1;
        background-color: #000;
        background-size: cover;
        background-position: center;
      }

      .clip-name {
        padding: 5px;
        font-size: 0.8em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        background-color: rgba(0,0,0,0.5);
      }

      .resolume-status {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
        padding: 0 15px;
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

      .midi-section {
        flex: 0 0 auto;
        border-top: 1px solid var(--border-color);
        padding-top: 20px;
        margin-top: 10px;
      }

      .midi-devices {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 10px;
        padding: 0 15px;
      }

      .chip {
        padding: 4px 8px;
        background-color: var(--button-bg);
        border-radius: 12px;
        font-size: 0.9em;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.2s;
      }

      .chip:hover {
        background-color: var(--button-hover);
      }

      .chip.selected {
        background-color: var(--selection-color);
        border-color: var(--selection-border);
        color: var(--text-color);
      }

      .chip.disconnected {
        opacity: 0.5;
        text-decoration: line-through;
      }

      .midi-events {
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 200px;
        overflow-y: auto;
        padding: 0 15px;
      }

      .event-card {
        background-color: var(--input-bg);
        padding: 8px;
        border-radius: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: grab;
        border: 1px solid transparent;
      }

      .event-card:hover {
        border-color: var(--border-color);
      }

      .event-info {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .event-type {
        font-size: 0.8em;
        color: var(--text-muted);
        background-color: rgba(0,0,0,0.2);
        padding: 2px 4px;
        border-radius: 3px;
      }

      .event-value {
        font-family: monospace;
        font-weight: bold;
      }
    `
  ];

  render() {
    return html`
      <div class="tab-header">I/O Devices</div>
      <div class="container">
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
          ${resolumeManager.isConnected ? this.renderResolumeContent() : ''}
        </div>

        <div class="section midi-section">
          <div class="section-header">MIDI Devices</div>
          ${this.renderMidiSection()}
        </div>
      </div>
    `;
  }

  toggleResolume() {
    if (resolumeManager.isConnected) {
      resolumeManager.disconnect();
      runtimeManager.sendResolumeControl('disconnect');
      localController.setEnableResolumeIO(false);
    } else {
      resolumeManager.connect().then(() => {
        localController.setEnableResolumeIO(resolumeManager.isConnected);
      });
      runtimeManager.sendResolumeControl('connect');
    }
  }

  renderResolumeContent() {
    const comp = resolumeManager.state;
    const selection = localController.observableState.selection;

    // Find selected layer to show clips
    let selectedLayer: ResolumeLayer | undefined;
    for (const layer of comp.layers) {
      if (selection.has(layer.path)) {
        selectedLayer = layer;
        break;
      }
    }

    // If a clip is selected, find its layer
    if (!selectedLayer) {
      for (const layer of comp.layers) {
        for (const clip of layer.clips) {
          if (selection.has(clip.path)) {
            selectedLayer = layer;
            break;
          }
        }
        if (selectedLayer) break;
      }
    }

    // Use original order (Layer 1, Layer 2, Layer 3)
    // const reversedLayers = [...comp.layers].reverse(); // Reverted

    return html`
      <div class="resolume-container">
        <div class="ui-list">
          <div
            class="ui-list-item ${selection.has(comp.path) ? 'selected' : ''}"
            @click=${() => localController.defineSelectable(new ResolumeInspectorWrapper(comp)).select()}
          >
            <strong>Composition</strong>
          </div>

          ${comp.layers.map(layer => {
      // Replace # with index (1-based index from end? or original index?)
      // Resolume usually names them "Layer 1", "Layer 2".
      // If the name contains '#', replace it with the layer index.
      // The layer object has an index (implied by position or id?).
      // ResolumeLayer has 'name' property.
      // If name is "Layer #", replace with "Layer N".
      // We can use the layer's ID or index.
      // Let's assume layer.name is raw.
      // Actually, Resolume API usually sends resolved names.
      // But user said "look for # characters... replace with layer index".
      // I'll use a regex.

      // We need the original index (1-based).
      // comp.layers is ordered 0..N.
      // So layer index is comp.layers.indexOf(layer) + 1.
      const index = comp.layers.indexOf(layer) + 1;
      const displayName = layer.name.replace('#', index.toString());

      return html`
              <div
                class="ui-list-item ${selection.has(layer.path) ? 'selected' : ''}"
                @click=${() => localController.defineSelectable(new ResolumeInspectorWrapper(layer)).select()}
              >
                ${displayName}
              </div>
            `;
    })}
        </div>

        ${selectedLayer ? html`
          <div class="clips-grid">
            ${selectedLayer.clips.map(clip => this.renderClipCard(clip))}
          </div>
        ` : ''}
      </div>
    `;
  }

  renderClipCard(clip: ResolumeClip) {
    const isSelected = localController.observableState.selection.has(clip.path);
    const thumbUrl = clip.thumbnail ? `http://127.0.0.1:8080${clip.thumbnail}` : '';

    return html`
      <div
        class="clip-card ${isSelected ? 'selected' : ''}"
        @click=${() => localController.defineSelectable(new ResolumeInspectorWrapper(clip)).select()}
      >
        <div class="clip-thumb" style="background-image: url('${thumbUrl}')"></div>
        <div class="clip-name">${clip.name}</div>
      </div>
    `;
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
    const label = event.type === 'cc' ? `CC ${event.cc}` : `Note ${event.note}`;
    const value = event.type === 'note_off' ? 'Off' : event.type === 'note_on' ? 'On' : event.value;

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
        cc: event.cc,
        deviceId: event.deviceId
      };
    } else {
      nodeType = 'midi_note';
      config = {
        channel: event.channel,
        note: event.note,
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

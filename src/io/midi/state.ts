import { makeObservable, observable, action } from 'mobx';
import { MidiEvent } from './types';

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
  connection: 'open' | 'closed' | 'pending';
}

export class MidiState {
  @observable devices = new Map<string, MidiDevice>();
  @observable selectedDeviceIds = new Set<string>();

  // Recent events for UI feedback
  @observable.shallow recentEvents: MidiEvent[] = [];

  // Current state for monitoring
  @observable activeNotes = new Map<string, number>(); // key: "deviceId:channel:note", value: velocity
  @observable ccValues = new Map<string, number>(); // key: "deviceId:channel:cc", value: value

  constructor() {
    makeObservable(this);
  }

  @action
  addDevice(device: MidiDevice) {
    this.devices.set(device.id, device);
  }

  @action
  removeDevice(id: string) {
    this.devices.delete(id);
    this.selectedDeviceIds.delete(id);
  }

  @action
  toggleDeviceSelection(id: string) {
    if (this.selectedDeviceIds.has(id)) {
      this.selectedDeviceIds.delete(id);
    } else {
      this.selectedDeviceIds.add(id);
    }
  }

  @action
  addEvent(event: MidiEvent) {
    // Keep only last 20 events
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > 20) {
      this.recentEvents.pop();
    }

    // Update current state
    const keyPrefix = `${event.deviceId}:${event.channel}`;
    if (event.type === 'note_on') {
      this.activeNotes.set(`${keyPrefix}:${event.note}`, event.velocity);
    } else if (event.type === 'note_off') {
      this.activeNotes.delete(`${keyPrefix}:${event.note}`);
    } else if (event.type === 'cc') {
      this.ccValues.set(`${keyPrefix}:${event.cc}`, event.value);
    }
  }
}

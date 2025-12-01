import { makeAutoObservable } from 'mobx';

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
  connection: 'open' | 'closed' | 'pending';
}

import { MidiEvent } from './types';

export class MidiState {
  devices = new Map<string, MidiDevice>();
  selectedDeviceIds = new Set<string>();

  // Recent events for UI feedback
  recentEvents: MidiEvent[] = [];

  // Current state for monitoring
  activeNotes = new Map<string, number>(); // key: "deviceId:channel:note", value: velocity
  ccValues = new Map<string, number>(); // key: "deviceId:channel:cc", value: value

  constructor() {
    makeAutoObservable(this);
  }

  addDevice(device: MidiDevice) {
    this.devices.set(device.id, device);
  }

  removeDevice(id: string) {
    this.devices.delete(id);
    this.selectedDeviceIds.delete(id);
  }

  toggleDeviceSelection(id: string) {
    if (this.selectedDeviceIds.has(id)) {
      this.selectedDeviceIds.delete(id);
    } else {
      this.selectedDeviceIds.add(id);
    }
  }

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

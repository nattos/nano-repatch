import { MidiState, MidiDevice } from './state';

// Minimal Web MIDI types
interface MIDIAccess extends EventTarget {
  inputs: Map<string, MIDIInput>;
  onstatechange: ((e: any) => void) | null;
}

interface MIDIInput extends EventTarget {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
  connection: 'open' | 'closed' | 'pending';
  onmidimessage: ((e: MIDIMessageEvent) => void) | null;
}

interface MIDIMessageEvent extends Event {
  data: Uint8Array;
}

export class MidiManager {
  state = new MidiState();
  private midiAccess: MIDIAccess | null = null;

  constructor() {
    this.init();
  }

  async init() {
    if (!(navigator as any).requestMIDIAccess) {
      console.warn('Web MIDI API not supported in this browser.');
      return;
    }

    try {
      this.midiAccess = await (navigator as any).requestMIDIAccess();
      this.updateDevices();

      if (this.midiAccess) {
        this.midiAccess.onstatechange = () => {
          this.updateDevices();
        };
      }
    } catch (e) {
      console.error('Failed to access Web MIDI API:', e);
    }
  }

  private updateDevices() {
    if (!this.midiAccess) return;

    // Mark all existing as disconnected first? Or just update.
    // Simpler to just re-scan.

    // We want to preserve selection if possible.

    if (!this.midiAccess) return;
    const inputs = Array.from(this.midiAccess.inputs.values());

    inputs.forEach((input: MIDIInput) => {
      const device: MidiDevice = {
        id: input.id,
        name: input.name || `Unknown Device ${input.id}`,
        manufacturer: input.manufacturer || '',
        state: input.state,
        connection: input.connection
      };

      this.state.addDevice(device);

      // Ensure we are listening
      input.onmidimessage = (e: any) => this.handleMidiMessage(e, input.id);
    });
  }

  private handleMidiMessage(event: MIDIMessageEvent, deviceId: string) {
    // Filter if specific devices are selected and this one isn't
    if (this.state.selectedDeviceIds.size > 0 && !this.state.selectedDeviceIds.has(deviceId)) {
      return;
    }

    const data = event.data;
    if (!data || data.length < 2) return;

    const status = data[0];
    const command = status >> 4;
    const channel = (status & 0xf) + 1; // 1-16
    const data1 = data[1];
    const data2 = data.length > 2 ? data[2] : 0;

    // Note On (0x9)
    if (command === 0x9) {
      const velocity = data2;
      if (velocity > 0) {
        this.state.addEvent({
          id: `${Date.now()}-${Math.random()}`,
          type: 'note_on',
          channel,
          target: data1,
          value: velocity,
          timestamp: Date.now(),
          deviceId
        });
      } else {
        // Velocity 0 is Note Off
        this.state.addEvent({
          id: `${Date.now()}-${Math.random()}`,
          type: 'note_off',
          channel,
          target: data1,
          value: 0,
          timestamp: Date.now(),
          deviceId
        });
      }
    }
    // Note Off (0x8)
    else if (command === 0x8) {
      this.state.addEvent({
        id: `${Date.now()}-${Math.random()}`,
        type: 'note_off',
        channel,
        target: data1,
        value: 0,
        timestamp: Date.now(),
        deviceId
      });
    }
    // Control Change (0xB)
    else if (command === 0xB) {
      this.state.addEvent({
        id: `${Date.now()}-${Math.random()}`,
        type: 'cc',
        channel,
        target: data1,
        value: data2,
        timestamp: Date.now(),
        deviceId
      });
    }
  }
}

export const midiManager = new MidiManager();

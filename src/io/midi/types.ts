export interface MidiBaseEvent {
  deviceId: string;
  channel: number;
  time?: number;
}

export interface MidiNoteOnEvent extends MidiBaseEvent {
  type: 'note_on';
  note: number;
  velocity: number; // 0.0 - 1.0 (float)
}

export interface MidiNoteOffEvent extends MidiBaseEvent {
  type: 'note_off';
  note: number;
  velocity: number; // Usually 0
}

export interface MidiCcEvent extends MidiBaseEvent {
  type: 'cc';
  cc: number;
  value: number;
}

export type MidiEvent = MidiNoteOnEvent | MidiNoteOffEvent | MidiCcEvent;

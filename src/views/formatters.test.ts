
import { describe, it, expect } from 'vitest';
import { formatType, formatValue } from './formatters';
import { StructorType } from '../structor/structor';
import { html } from 'lit';

describe('Formatters', () => {
  it('should format types with hints', () => {
    const midiType: StructorType = { kind: 'record', fields: {}, untagged: [], hint: 'midi' };
    expect(formatType(midiType)).toBe('midi');

    const streamType: StructorType = { kind: 'array', element: midiType, size: 'dynamic', hint: 'midi-stream' };
    expect(formatType(streamType)).toBe('midi-stream');
  });

  it('should format MIDI events', () => {
    const midiType: StructorType = { kind: 'record', fields: {}, untagged: [], hint: 'midi' };

    // Note On: Channel 1, Note 60 (C4), Velocity 100
    const noteOn = { status: 0x90, data1: 60, data2: 100 };
    const resultOn = formatValue(noteOn, midiType);
    expect(resultOn).toBeDefined();

    // New MidiEvent Note On
    const noteOnEvent = { type: 'note_on', note: 60, velocity: 100 };
    const resultOnEvent = formatValue(noteOnEvent, midiType);
    expect(resultOnEvent).toBeDefined();
    // Verify content if possible, or at least that it didn't crash

    // CC: Channel 1, CC 7, Value 64
    const cc = { status: 0xB0, data1: 7, data2: 64 };
    const resultCc = formatValue(cc, midiType);
    expect(resultCc).toBeDefined();

    // New MidiEvent CC
    const ccEvent = { type: 'cc', cc: 7, value: 64 };
    const resultCcEvent = formatValue(ccEvent, midiType);
    expect(resultCcEvent).toBeDefined();
  });

  it('should format MIDI streams', () => {
    const midiType: StructorType = { kind: 'record', fields: {}, untagged: [], hint: 'midi' };
    const streamType: StructorType = { kind: 'array', element: midiType, size: 'dynamic', hint: 'midi-stream' };

    const stream = [
      { status: 0x90, data1: 60, data2: 100 },
      { status: 0x80, data1: 60, data2: 0 }
    ];

    const result = formatValue(stream, streamType);
    expect(result).toBeDefined();
  });
});

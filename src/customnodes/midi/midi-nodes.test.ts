import { describe, it, expect } from 'vitest';
import { midiMergeNode, midiSelectNode } from './nodes';
import { MidiEvent } from '../../io/midi/types';
import { broadcast } from '../../structor/broadcast';

describe('Generic MIDI Nodes', () => {

  // Helper to deep access fields if wrapped
  const unwrap = (obj: any) => {
    if (obj && obj.fields) return obj.fields;
    return obj;
  }

  describe('midi.merge', () => {
    it('should merge multiple generic streams', () => {
      const stream1: MidiEvent[] = [
        { type: 'note_on', note: 60, velocity: 1, channel: 1, time: 0, deviceId: 'test' }
      ];
      const stream2: MidiEvent[] = [
        { type: 'note_off', note: 60, velocity: 0, channel: 1, time: 0.1, deviceId: 'test' }
      ];

      const inputs = {
        fields: {
          stream: [stream1, stream2]
        }
      };

      const result = midiMergeNode.execute(inputs as any, {}, { broadcast } as any) as any;

      expect(result.fields.stream).toHaveLength(2);
      // Elements inside stream array might also be wrapped StructorRecords?
      // Check first element
      const first = result.fields.stream[0];
      // If wrapped, it has fields. If not, it has type.
      const firstUnwrapped = first.fields ? first.fields : first;

      expect(firstUnwrapped.note).toBe(60);
      expect(firstUnwrapped.type).toBe('note_on');
    });

    it('should handle empty inputs', () => {
      const result = midiMergeNode.execute({ fields: { stream: [] } } as any, {}, { broadcast } as any) as any;
      expect(result.fields.stream).toEqual([]);
    });
  });

  describe('midi.select', () => {
    const noteOn = (note: number): MidiEvent => ({
      type: 'note_on',
      note,
      velocity: 1,
      channel: 1,
      time: 0,
      deviceId: 'test'
    });

    it('should route notes based on root offset', () => {
      const config = { count: 4, root: 60, skip: 1 };
      const stream = [
        noteOn(60),
        noteOn(61),
        noteOn(63),
        noteOn(64),
        noteOn(59)
      ];

      const result = midiSelectNode.execute(
        { fields: { stream } } as any, config, { broadcast } as any
      ) as any;

      // Access nested fields
      const getNote = (port: string, index: number) => {
        const events = result.fields[port];
        if (!events || !events[index]) return undefined;
        return events[index].fields ? events[index].fields.note : events[index].note;
      };

      expect(result.fields['0']).toHaveLength(1);
      expect(getNote('0', 0)).toBe(60);

      expect(result.fields['1']).toHaveLength(1);
      expect(getNote('1', 0)).toBe(61);

      expect(result.fields['3']).toHaveLength(1);
      expect(getNote('3', 0)).toBe(63);

      expect(result.fields['rem']).toHaveLength(2);
    });

    it('should handle skip parameter (semitones)', () => {
      const config = { count: 4, root: 60, skip: 2 };
      const stream = [
        noteOn(60),
        noteOn(62),
        noteOn(61)
      ];

      const result = midiSelectNode.execute(
        { fields: { stream } } as any, config, { broadcast } as any
      ) as any;

      const getNote = (port: string, index: number) => {
        const events = result.fields[port];
        if (!events || !events[index]) return undefined;
        return events[index].fields ? events[index].fields.note : events[index].note;
      };

      expect(result.fields['0']).toHaveLength(1); // 60
      expect(getNote('0', 0)).toBe(60);

      expect(result.fields['1']).toHaveLength(1); // 62
      expect(getNote('1', 0)).toBe(62);

      expect(result.fields['rem']).toHaveLength(1); // 61
    });

    it('should handle skip parameter (octaves)', () => {
      const config = { count: 3, root: 36, skip: 12 };
      const stream = [
        noteOn(36),
        noteOn(48),
        noteOn(60),
        noteOn(37) // C#2 -> rem
      ];

      const result = midiSelectNode.execute(
        { fields: { stream } } as any, config, { broadcast } as any
      ) as any;

      const getNote = (port: string, index: number) => {
        const events = result.fields[port];
        if (!events || !events[index]) return undefined;
        return events[index].fields ? events[index].fields.note : events[index].note;
      };

      expect(result.fields['0']).toHaveLength(1);
      expect(getNote('0', 0)).toBe(36);

      expect(result.fields['1']).toHaveLength(1);
      expect(getNote('1', 0)).toBe(48);

      expect(result.fields['2']).toHaveLength(1);
      expect(getNote('2', 0)).toBe(60);

      expect(result.fields['rem']).toHaveLength(1);
      expect(getNote('rem', 0)).toBe(37);
    });
  });
});

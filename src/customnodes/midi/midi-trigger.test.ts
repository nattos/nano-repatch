import { describe, it, expect } from 'vitest';
import { midiOnChangeNode, midiOnRangeNode } from './nodes';
import { MidiEvent } from '../../io/midi/types';

// Helper to wrap inputs into Structor format expected by Node Wrapper
const wrapInputs = (inputs: Record<string, any>) => {
  const fields: Record<string, any> = {};
  for (const [key, val] of Object.entries(inputs)) {
    if (typeof val === 'number') {
      fields[key] = { kind: 'atomic', type: 'number', value: val };
    } else if (typeof val === 'string') {
      fields[key] = { kind: 'atomic', type: 'string', value: val };
    } else {
      // Fallback/Any
      fields[key] = { kind: 'atomic', type: 'any', value: val };
    }
  }
  return { kind: 'record', fields };
};

describe('MIDI Trigger Nodes', () => {

  const createMockContext = () => ({
    nodeState: new Map(),
    nodeId: 'test-node',
    midi: { events: [] },
    clock: { beat: 0, dt: 0.1 }
  } as any);

  describe('midi.onchange', () => {
    it('should trigger on string change', () => {
      const context = createMockContext();
      const config = { rootNote: 60 };

      // First run: Initialize
      midiOnChangeNode.execute(wrapInputs({ value: 'A' }), config, context);
      const state = context.nodeState.get('test-node');
      expect(state.lastValue).toBe('A');

      // Second run: Change value
      const res = midiOnChangeNode.execute(wrapInputs({ value: 'B' }), config, context);
      const stream = (res.fields?.stream || []) as any[];

      expect(stream).toHaveLength(2);
      expect(stream[0].fields).toMatchObject({ type: 'note_on', note: 60 });
      expect(stream[1].fields).toMatchObject({ type: 'note_off', note: 60 });
      expect(state.lastValue).toBe('B');
    });

    it('should trigger on numeric change > epsilon', () => {
      const context = createMockContext();
      const config = { rootNote: 60 };

      midiOnChangeNode.execute(wrapInputs({ value: 0.5 }), config, context);
      const state = context.nodeState.get('test-node');

      // Small Change > 1e-5
      const res = midiOnChangeNode.execute(wrapInputs({ value: 0.50002 }), config, context);
      const stream = (res.fields?.stream || []) as any[];

      expect(stream).toHaveLength(2);
      expect(state.lastValue).toBeCloseTo(0.50002);
    });

    it('should NOT trigger on numeric change < epsilon', () => {
      const context = createMockContext();
      const config = { rootNote: 60 };

      midiOnChangeNode.execute(wrapInputs({ value: 0.5 }), config, context);
      const state = context.nodeState.get('test-node');

      // Tiny Change < 1e-5
      const res = midiOnChangeNode.execute(wrapInputs({ value: 0.5000001 }), config, context);
      const stream = (res.fields?.stream || []) as any[];

      expect(stream).toHaveLength(0);
      expect(state.lastValue).toBe(0.5);
    });
  });

  describe('midi.onrange', () => {
    it('should trigger when entering single zone', () => {
      const context = createMockContext();
      const config = { rootNote: 60, zoneCount: 1, noteSkip: 1 };

      // Outside
      midiOnRangeNode.execute(wrapInputs({ value: -1, start: 0, end: 1 }), config, context);
      const state = context.nodeState.get('test-node');
      expect(state.activeZoneIndex).toBeNull();

      // Enter
      const res = midiOnRangeNode.execute(wrapInputs({ value: 0.5, start: 0, end: 1 }), config, context);
      const stream = (res.fields?.stream || []) as any[];

      expect(stream).toHaveLength(1);
      expect(stream[0].fields).toMatchObject({ type: 'note_on', note: 60 });
      expect(state.activeZoneIndex).toBe(0);
    });

    it('should trigger note off when exiting', () => {
      const context = createMockContext();
      const config = { rootNote: 60, zoneCount: 1, noteSkip: 1 };

      // Setup active state manually
      const state = { activeZoneIndex: 0 };
      context.nodeState.set('test-node', state);

      const res = midiOnRangeNode.execute(wrapInputs({ value: 1.5, start: 0, end: 1 }), config, context);
      const stream = (res.fields?.stream || []) as any[];

      expect(stream).toHaveLength(1);
      expect(stream[0].fields).toMatchObject({ type: 'note_off', note: 60 });
      expect(state.activeZoneIndex).toBeNull();
    });

    it('should handle multi-zone transition (equal weights)', () => {
      const context = createMockContext();
      const config = { rootNote: 60, zoneCount: 2, noteSkip: 2 };

      const inputs = {
        value: 0.25,
        start: 0,
        end: 1,
        w1: 1,
        w2: 1
      };

      // Enter Zone 0
      let res = midiOnRangeNode.execute(wrapInputs(inputs), config, context);
      const stream0 = (res.fields?.stream || []) as any[];
      expect(stream0[0].fields).toMatchObject({ type: 'note_on', note: 60 });

      // Move to Zone 1
      inputs.value = 0.75;
      res = midiOnRangeNode.execute(wrapInputs(inputs), config, context);
      const state = context.nodeState.get('test-node');

      const stream1 = (res.fields?.stream || []) as any[];
      expect(stream1).toHaveLength(2);
      expect(stream1[0].fields).toMatchObject({ type: 'note_off', note: 60 });
      expect(stream1[1].fields).toMatchObject({ type: 'note_on', note: 62 });
      expect(state.activeZoneIndex).toBe(1);
    });

    it('should handle weighted zones', () => {
      const context = createMockContext();
      const config = { rootNote: 60, zoneCount: 2, noteSkip: 1 };

      const inputs = {
        value: 0.0,
        start: 0,
        end: 1,
        w1: 1,
        w2: 2
      };

      // Enter Zone 0
      midiOnRangeNode.execute(wrapInputs({ ...inputs, value: 0.1 }), config, context);
      const state = context.nodeState.get('test-node');
      expect(state.activeZoneIndex).toBe(0); // Note 60

      // Transition Point roughly 0.333
      // 0.4 should be Zone 1
      const res = midiOnRangeNode.execute(wrapInputs({ ...inputs, value: 0.4 }), config, context);

      const stream = (res.fields?.stream || []) as any[];

      // Debug: check length if faulty
      // console.log('Weighted Stream Length:', stream.length);

      expect(stream).toHaveLength(2);
      expect(stream[1].fields).toMatchObject({ type: 'note_on', note: 61 });
      expect(state.activeZoneIndex).toBe(1);
    });
  });
});

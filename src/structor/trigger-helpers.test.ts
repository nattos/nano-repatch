import { describe, it, expect } from 'vitest';
import { detectTriggerMode, shouldTrigger, TriggerMode } from './trigger-helpers';
import { midiStreamType, AnyType } from './std-types';

describe('trigger-helpers', () => {
  describe('detectTriggerMode', () => {
    it('detects midi from array of records', () => {
      expect(detectTriggerMode(midiStreamType)).toBe('midi');
      // Mock array of record structure
      const mockMidi = { kind: 'array', element: { kind: 'record' } } as any;
      expect(detectTriggerMode(mockMidi)).toBe('midi');
    });

    it('defaults to primitive for others', () => {
      expect(detectTriggerMode(undefined)).toBe('primitive');
      expect(detectTriggerMode({ kind: 'atomic', type: 'number' } as any)).toBe('primitive');
      expect(detectTriggerMode({ kind: 'array', element: { kind: 'atomic', type: 'number' } } as any)).toBe('primitive');
    });
  });

  describe('shouldTrigger', () => {
    it('handles primitive mode (scalar)', () => {
      expect(shouldTrigger(1, 'primitive')).toBe(true);
      expect(shouldTrigger('true', 'primitive')).toBe(true);
      expect(shouldTrigger(0, 'primitive')).toBe(false);
      expect(shouldTrigger(false, 'primitive')).toBe(false);
      expect(shouldTrigger(null, 'primitive')).toBe(false);
    });

    it('handles primitive mode (array)', () => {
      expect(shouldTrigger([0, 1], 'primitive')).toBe(true);
      expect(shouldTrigger([0, false], 'primitive')).toBe(false);
      expect(shouldTrigger([], 'primitive')).toBe(false);
    });

    it('handles midi mode', () => {
      const noteOn = { type: 'note_on', velocity: 100 };
      const noteOff = { type: 'note_off', velocity: 0 };
      const noteOnZero = { type: 'note_on', velocity: 0 };

      expect(shouldTrigger([noteOn], 'midi')).toBe(true);
      expect(shouldTrigger([noteOff], 'midi')).toBe(false);
      expect(shouldTrigger([noteOnZero], 'midi')).toBe(false); // Note On with vel 0 is Note Off
      expect(shouldTrigger([], 'midi')).toBe(false);
      expect(shouldTrigger(null, 'midi')).toBe(false);
      expect(shouldTrigger([noteOff, noteOn], 'midi')).toBe(true);
    });
  });
});

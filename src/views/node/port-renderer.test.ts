import { describe, it, expect, vi } from 'vitest';
import { shouldHideLabel, hasIoSlider } from './port-renderer';
import { PortHint } from '../../structor/repository';

// Mock graph-node-utils
vi.mock('../../utils/node-width-utils', () => ({
  shouldShowInputEditor: (input: PortHint, isConnected: boolean) => {
    // Simple mock logic: show editor if not connected (unless suppressed - handled by caller usually?)
    // Real logic checks type kind 'atomic' etc.
    // Let's assume for this test inputs are atomic if configured
    return !isConnected && (input.type as any).kind === 'atomic';
  }
}));

const atomicType = { kind: 'atomic', type: 'number' } as any;
const objectType = { kind: 'object' } as any;

describe('PortRenderer', () => {
  describe('hasIoSlider', () => {
    it('returns true for io.input with single numeric input', () => {
      const inputs = [{ name: 'val', type: atomicType }];
      expect(hasIoSlider('io.input', inputs)).toBe(true);
    });

    it('returns false for io.input with non-numeric input', () => {
      const inputs = [{ name: 'val', type: { kind: 'atomic', type: 'string' } as any }];
      expect(hasIoSlider('io.input', inputs)).toBe(false);
    });

    it('returns false for other node types', () => {
      const inputs = [{ name: 'val', type: atomicType }];
      expect(hasIoSlider('math.add', inputs)).toBe(false);
    });
  });

  describe('shouldHideLabel', () => {
    const inputs: PortHint[] = [{ name: 'in1', type: atomicType }, { name: 'in2', type: objectType }];
    const outputs: PortHint[] = [{ name: 'out1', type: atomicType }];
    const connectedPorts = new Set<string>();

    it('hides input label if editor is shown (input disconnected)', () => {
      // in1 is atomic, disconnected -> editor shown -> label hidden
      expect(shouldHideLabel('in1', 'in', inputs, outputs, connectedPorts)).toBe(true);
    });

    it('shows input label if editor is HIDDEN (input connected)', () => {
      connectedPorts.add('in1');
      // in1 connected -> editor hidden -> label shown
      expect(shouldHideLabel('in1', 'in', inputs, outputs, connectedPorts)).toBe(false);
      connectedPorts.delete('in1');
    });

    it('shows input label if not atomic (no editor)', () => {
      // in2 is object -> no editor -> label shown
      expect(shouldHideLabel('in2', 'in', inputs, outputs, connectedPorts)).toBe(false);
    });

    it('hides output label if corresponding input has editor', () => {
      // out1 (index 0) corresponds to in1 (index 0).
      // in1 is atomic, disconnected -> editor shown.
      // So out1 label should be hidden to align.
      expect(shouldHideLabel('out1', 'out', inputs, outputs, connectedPorts)).toBe(true);
    });

    it('shows output label if corresponding input is connected', () => {
      connectedPorts.add('in1');
      expect(shouldHideLabel('out1', 'out', inputs, outputs, connectedPorts)).toBe(false);
    });
  });
});

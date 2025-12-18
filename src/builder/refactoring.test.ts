import { describe, it, expect, beforeEach } from 'vitest';
import { AppController } from './state';

describe('AppController Refactoring', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController();
  });

  describe('calculateConstrainedMove', () => {
    it('should allow normal movement within bounds', () => {
      const node = controller.createNode('test', 10, 10);
      const { dx, dy } = controller.calculateConstrainedMove([node.id], 5, 5);
      expect(dx).toBe(5);
      expect(dy).toBe(5);
    });

    it('should clamp movement to left boundary (x=0)', () => {
      const node = controller.createNode('test', 2, 10);
      // Try to move left by 5 (would be -3)
      const { dx } = controller.calculateConstrainedMove([node.id], -5, 0);
      // Should stop at x=0. Current x=2. dx should be -2.
      expect(dx).toBe(-2);
    });

    it('should clamp movement to right boundary (x=50)', () => {
      const node = controller.createNode('test', 48, 10);
      // Try to move right by 5 (would be 53)
      const { dx } = controller.calculateConstrainedMove([node.id], 5, 0);
      // Should stop at x=50. Current x=48. dx should be 2.
      expect(dx).toBe(2);
    });

    it('should lock X axis for pinned input nodes', () => {
      const node = controller.createNode('io.input', 0, 10); // Input node at x=0
      const { dx, dy } = controller.calculateConstrainedMove([node.id], 5, 5);
      expect(dx).toBe(0); // X locked
      expect(dy).toBe(5); // Y allowed
    });

    it('should lock X axis for pinned output nodes', () => {
      const node = controller.createNode('io.output', 51, 10); // Output node at x=51
      const { dx, dy } = controller.calculateConstrainedMove([node.id], -5, 5);
      expect(dx).toBe(0); // X locked
      expect(dy).toBe(5); // Y allowed
    });

    it('should lock X axis if ANY selected node is pinned', () => {
      const inputNode = controller.createNode('io.input', 0, 10);
      const normalNode = controller.createNode('test', 10, 10);

      const { dx, dy } = controller.calculateConstrainedMove([inputNode.id, normalNode.id], 5, 5);
      expect(dx).toBe(0); // X locked for both
      expect(dy).toBe(5); // Y allowed
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { autorun } from 'mobx';
import { AppController } from './state';

describe('AppController - Long Edit', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController();
  });

  it('should handle a basic long edit flow (begin -> apply -> accept)', () => {
    const node = controller.createNode('data.literal', 0, 0, { values: { val: 0 } });

    const longEdit = controller.beginLongEdit({
      apply: (c) => {
        c.setNodeConfig(node.id, { values: { val: 10 } });
      }
    });

    // Observable state should reflect the change
    expect(controller.observableState.graph.inner.nodes[node.id].config.values.val).toBe(10);
    // Current state (committed) should NOT reflect the change yet
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(0);
    // Undo stack should be empty (no commit yet)
    expect(controller.canUndo).toBe(true); // Wait, createNode is undoable.
    // Let's check the undo stack length. createNode is 1.
    // But long edit shouldn't add to undo stack yet.

    // Actually, createNode added 1.
    // So undo stack length should be 1.

    longEdit.accept();

    // Now committed
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(10);
    // Undo stack should have 2 entries (createNode + longEdit)
    // Wait, canUndo is boolean. We can't check length directly easily unless we access private.
    // But we can undo and see.

    controller.undo(); // Undo long edit
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(0);

    controller.undo(); // Undo createNode
    expect(controller.getState().graph.inner.nodes[node.id]).toBeUndefined();
  });

  it('should handle cancellation of a long edit', () => {
    const node = controller.createNode('data.literal', 0, 0, { values: { val: 0 } });

    const longEdit = controller.beginLongEdit({
      apply: (c) => {
        c.setNodeConfig(node.id, { values: { val: 10 } });
      }
    });

    expect(controller.observableState.graph.inner.nodes[node.id].config.values.val).toBe(10);

    longEdit.cancel();

    // Reverted in observable state
    expect(controller.observableState.graph.inner.nodes[node.id].config.values.val).toBe(0);
    // Committed state is still 0
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(0);

    // Undo only undoes createNode
    controller.undo();
    expect(controller.getState().graph.inner.nodes[node.id]).toBeUndefined();
  });

  it('should update long edit with new values (applyAgain)', () => {
    const node = controller.createNode('data.literal', 0, 0, { values: { val: 0 } });

    const longEdit = controller.beginLongEdit({
      apply: (c) => {
        c.setNodeConfig(node.id, { values: { val: 10 } });
      }
    });

    expect(controller.observableState.graph.inner.nodes[node.id].config.values.val).toBe(10);

    // Update the edit
    longEdit.applyAgain((c) => {
      c.setNodeConfig(node.id, { values: { val: 20 } });
    });

    expect(controller.observableState.graph.inner.nodes[node.id].config.values.val).toBe(20);

    longEdit.accept();
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(20);

    controller.undo();
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(0);
  });

  it('should interleave short edits correctly', () => {
    const nodeA = controller.createNode('A', 0, 0, { values: { val: 0 } });
    const nodeB = controller.createNode('B', 10, 0, { values: { val: 0 } });

    const longEdit = controller.beginLongEdit({
      apply: (c) => {
        c.setNodeConfig(nodeA.id, { values: { val: 10 } }); // Long edit touches A
      }
    });

    expect(controller.observableState.graph.inner.nodes[nodeA.id].config.values.val).toBe(10);

    // Short edit touches B
    controller.setNodeConfig(nodeB.id, { values: { val: 5 } });

    // Both should be visible in observable state
    expect(controller.observableState.graph.inner.nodes[nodeB.id].config.values.val).toBe(5);
    expect(controller.observableState.graph.inner.nodes[nodeA.id].config.values.val).toBe(10);

    // Committed state should have B=5 but A=0
    expect(controller.getState().graph.inner.nodes[nodeB.id].config.values.val).toBe(5);
    expect(controller.getState().graph.inner.nodes[nodeA.id].config.values.val).toBe(0);

    longEdit.accept();

    // Both committed
    expect(controller.getState().graph.inner.nodes[nodeB.id].config.values.val).toBe(5);
    expect(controller.getState().graph.inner.nodes[nodeA.id].config.values.val).toBe(10);
  });

  it('should handle undo of short edit during long edit', () => {
    const nodeA = controller.createNode('A', 0, 0, { values: { val: 0 } });
    const nodeB = controller.createNode('B', 10, 0, { values: { val: 0 } });

    const longEdit = controller.beginLongEdit({
      apply: (c) => {
        c.setNodeConfig(nodeA.id, { values: { val: 10 } });
      }
    });

    controller.setNodeConfig(nodeB.id, { values: { val: 5 } });

    expect(controller.observableState.graph.inner.nodes[nodeB.id].config.values.val).toBe(5);
    expect(controller.observableState.graph.inner.nodes[nodeA.id].config.values.val).toBe(10);

    // Undo the short edit (B -> 0)
    controller.undo();

    // B should be back to 0
    expect(controller.observableState.graph.inner.nodes[nodeB.id].config.values.val).toBe(0);
    // A should still be 10 (long edit re-applied)
    expect(controller.observableState.graph.inner.nodes[nodeA.id].config.values.val).toBe(10);

    longEdit.accept();
    expect(controller.getState().graph.inner.nodes[nodeA.id].config.values.val).toBe(10);
    expect(controller.getState().graph.inner.nodes[nodeB.id].config.values.val).toBe(0);
  });

  it('should handle conflicting edits (long edit overwrites short edit in observable)', () => {
    // If long edit and short edit touch the same value, long edit "wins" in observable because it's re-applied on top.
    const node = controller.createNode('A', 0, 0, { values: { val: 0 } });

    const longEdit = controller.beginLongEdit({
      apply: (c) => {
        c.setNodeConfig(node.id, { values: { val: 100 } });
      }
    });

    // Short edit sets it to 50
    controller.setNodeConfig(node.id, { values: { val: 50 } });

    // Observable should show 100 (long edit re-applied on top of 50)
    expect(controller.observableState.graph.inner.nodes[node.id].config.values.val).toBe(100);

    // Committed state should be 50
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(50);

    longEdit.accept();
    // Final state 100
    expect(controller.getState().graph.inner.nodes[node.id].config.values.val).toBe(100);
  });
});

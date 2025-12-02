import { describe, it, expect, beforeEach } from 'vitest';
import { AppController } from './state';
import { defaultNodeRepository } from '../structor/repository';

describe('Graph Persistence', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController();
  });

  it('should preserve node values after save and load', () => {
    // 1. Create a node
    const node = controller.createNode('math.add', 0, 0);

    // 2. Set a value
    controller.setNodeConfig(node.id, { values: { a: 0.5 } });

    // Verify value is set
    expect(controller.getState().graph.inner.nodes[node.id].config.values['a']).toBe(0.5);

    // 3. Save (simulate serialization)
    const savedState = JSON.parse(JSON.stringify(controller.getState().graph.inner));

    // 4. Load
    controller.loadGraph(savedState);

    // 5. Verify value is preserved
    // Note: IDs might change if we regenerated them, but loadGraph preserves IDs from the saved state
    const loadedNode = Object.values(controller.getState().graph.inner.nodes)[0];

    expect(loadedNode).toBeDefined();
    expect(loadedNode.config.typeId).toBe('math.add');
    expect(loadedNode.config.values).toBeDefined();
    expect(loadedNode.config.values['a']).toBe(0.5);
  });

  it('should preserve values for data.float node', () => {
    const node = controller.createNode('data.float', 0, 0);
    controller.setNodeConfig(node.id, { values: { value: 123.45 } });

    const savedState = JSON.parse(JSON.stringify(controller.getState().graph.inner));
    controller.loadGraph(savedState);

    const loadedNode = Object.values(controller.getState().graph.inner.nodes)[0];
    expect(loadedNode.config.values['value']).toBe(123.45);
  });

  it('should preserve values for math.clamp node', () => {
    const node = controller.createNode('math.clamp', 0, 0);
    controller.setNodeConfig(node.id, { values: { min: 0.2, max: 0.8 } });

    const savedState = JSON.parse(JSON.stringify(controller.getState().graph.inner));
    controller.loadGraph(savedState);

    const loadedNode = Object.values(controller.getState().graph.inner.nodes)[0];
    expect(loadedNode.config.values['min']).toBe(0.2);
    expect(loadedNode.config.values['max']).toBe(0.8);
  });

  it('should handle legacy nodes with top-level values', () => {
    // Simulate a node created with top-level value (bypassing createNode's structure)
    const node = {
      id: 'legacy-node',
      x: 0,
      y: 0,
      config: {
        typeId: 'data.float',
        value: 99.9, // Top-level value
        values: {} // Empty values
      }
    };

    // Manually inject into state
    controller.loadGraph({ nodes: { [node.id]: node }, connections: {} });

    const loadedNode = Object.values(controller.getState().graph.inner.nodes)[0];
    // The controller doesn't migrate it, but the UI should handle it.
    // Since we can't test the UI rendering here, we just verify the state is as expected.
    expect(loadedNode.config.value).toBe(99.9);
    expect(loadedNode.config.values['value']).toBeUndefined();
  });
});

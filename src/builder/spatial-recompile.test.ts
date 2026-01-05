
import { describe, it, expect, beforeEach } from 'vitest';
import { AppController } from './state';
import { defaultNodeRepository as nodeRepository } from '../structor/repository';
import { primitive_ifthen } from '../structor/nodes/core_ifthen';
import { registerNode } from '../structor/node-helpers';

// Register ifthen for the test
registerNode(primitive_ifthen as any);

describe('Smart Spatial Recompilation', () => {
  let controller: AppController;
  let recompileCount = 0;

  beforeEach(() => {
    controller = new AppController();
    recompileCount = 0;
    controller.onCompiledGraphDirty(() => {
      recompileCount++;
    });
  });

  it('should trigger recompile when a node enters a region', () => {
    // 1. Create Region Node (3x3)
    const region = controller.createNode('core.ifthen', 0, 0, { width: 3, height: 3 });

    // 2. Create potential child outside (10, 10)
    const child = controller.createNode('core.literal', 10, 10);

    // Reset count (create triggers recompile)
    recompileCount = 0;

    // 3. Move child into region (1, 1)
    controller.moveNodes([child.id], -9, -9); // 10 -> 1

    expect(recompileCount).toBe(1);
  });

  it('should trigger recompile when a node exits a region', () => {
    const region = controller.createNode('core.ifthen', 0, 0, { width: 3, height: 3 });
    const child = controller.createNode('core.literal', 1, 1);

    recompileCount = 0;

    // Move child out (10, 10)
    controller.moveNodes([child.id], 9, 9); // 1 -> 10

    expect(recompileCount).toBe(1);
  });

  it('should NOT trigger recompile when moving within a region', () => {
    const region = controller.createNode('core.ifthen', 0, 0, { width: 3, height: 3 });
    const child = controller.createNode('core.literal', 1, 1);

    recompileCount = 0;

    // Move within region (1,1 -> 2,2)
    controller.moveNodes([child.id], 1, 1);

    expect(recompileCount).toBe(0);
  });

  it('should NOT trigger recompile when moving outside a region (staying outside)', () => {
    const region = controller.createNode('core.ifthen', 0, 0, { width: 3, height: 3 });
    const child = controller.createNode('core.literal', 10, 10);

    recompileCount = 0;

    // Move outside (10,10 -> 11,11)
    controller.moveNodes([child.id], 1, 1);

    expect(recompileCount).toBe(0);
  });

  it('should trigger recompile when the region moves and sweeps a node', () => {
    // Region at 0,0
    const region = controller.createNode('core.ifthen', 0, 0, { width: 3, height: 3 });
    // Child at 10,10
    const child = controller.createNode('core.literal', 10, 10);

    recompileCount = 0;

    // Move Region to encapsulate child (10, 10)
    // Region needs to move to roughly 10,10.
    controller.moveNodes([region.id], 10, 10);

    expect(recompileCount).toBe(1);
  });
});

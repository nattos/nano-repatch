
import { describe, it, expect, vi } from 'vitest';
import { AppController } from './state';
import { defaultNodeRepository } from '../structor/repository';

describe('AppController Optimization', () => {
  it('should not dispatch mutation if setNodeConfig is called with identical values', () => {
    const controller = new AppController();
    const node = controller.createNode('math.add', 0, 0);

    // Spy on dispatch
    const dispatchSpy = vi.spyOn(controller, 'dispatch');

    // Call setNodeConfig with SAME typeId
    controller.setNodeConfig(node.id, { typeId: 'math.add' });

    expect(dispatchSpy).not.toHaveBeenCalled();

    // Call setNodeConfig with DIFFERENT typeId
    controller.setNodeConfig(node.id, { typeId: 'math.multiply' });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const mutation = dispatchSpy.mock.calls[0][0][0]; // First Arg, First Element (Array)
    expect(mutation.type).toBe('node.setConfig');
    expect(mutation.to.typeId).toBe('math.multiply');
  });

  it('should dispatch mutation if other config validation changes', () => {
    const controller = new AppController();
    const node = controller.createNode('math.add', 0, 0);
    const dispatchSpy = vi.spyOn(controller, 'dispatch');

    controller.setNodeConfig(node.id, { name: 'New Name' });

    expect(dispatchSpy).toHaveBeenCalled();
    const mutation = dispatchSpy.mock.calls[0][0][0];
    expect(mutation.to.name).toBe('New Name');
    expect(mutation.to.typeId).toBeUndefined();
  });
});

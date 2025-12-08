
import { describe, it, expect } from 'vitest';
import { compileAndRun } from './primitives-integration.test';

describe('All Operators Integration', () => {
  it('should sum all inputs: math.all.add([1, 2, 3]) = 6', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: [1, 2, 3] } },
        'op': { typeId: 'math.all.add' }
      },
      [
        { from: 'val', port: 'value', to: 'op', portIn: 'values' }
      ],
      'op', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(6);
  });

  it('should subtract all inputs: math.all.subtract([10, 2, 3]) = 5', () => {
    // 10 - 2 - 3 = 5
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: [10, 2, 3] } },
        'op': { typeId: 'math.all.subtract' }
      },
      [
        { from: 'val', port: 'value', to: 'op', portIn: 'values' }
      ],
      'op', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(5);
  });

  it('should multiply all inputs: math.all.multiply([2, 3, 4]) = 24', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: [2, 3, 4] } },
        'op': { typeId: 'math.all.multiply' }
      },
      [
        { from: 'val', port: 'value', to: 'op', portIn: 'values' }
      ],
      'op', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(24);
  });

  it('should divide all inputs: math.all.divide([100, 2, 5]) = 10', () => {
    // 100 / 2 / 5 = 10
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: [100, 2, 5] } },
        'op': { typeId: 'math.all.divide' }
      },
      [
        { from: 'val', port: 'value', to: 'op', portIn: 'values' }
      ],
      'op', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(10);
  });

  it('should check if all are true: logic.all.and([1, 1, 1]) = 1', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: [1, 1, 1] } },
        'op': { typeId: 'logic.all.and' }
      },
      [
        { from: 'val', port: 'value', to: 'op', portIn: 'values' }
      ],
      'op', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(1);
  });

  it('should check if all are true: logic.all.and([1, 0, 1]) = 0', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'val': { typeId: 'data.literal', config: { value: [1, 0, 1] } },
        'op': { typeId: 'logic.all.and' }
      },
      [
        { from: 'val', port: 'value', to: 'op', portIn: 'values' }
      ],
      'op', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(0);
  });
});

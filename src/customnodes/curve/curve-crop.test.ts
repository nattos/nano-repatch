import { describe, it, expect } from 'vitest';
import { curve_crop } from './nodes';
import { NodeRepository } from '../../structor/repository';
import { compileAndRun } from '../../test/integration-utils';

describe('curve.crop Mode Integration', () => {
  const registerCurveNodes = (repository: NodeRepository) => {
    repository.register({
      id: 'curve.crop',
      version: '1.0.0',
      displayName: 'Curve Crop',
      definition: curve_crop,
    } as any);
  };

  const runCurveTest = (mode: string, val: number, start: number, endOrLength: number) => {
    // We use virtual inputs (values) instead of Mock Source nodes for simplicity.
    const configValues: any = { value: val, start: start };
    if (mode === 'start-length') {
      configValues.length = endOrLength;
    } else {
      configValues.end = endOrLength;
    }

    const { executor, getOutput } = compileAndRun(
      {
        'crop': { typeId: 'curve.crop', config: { mode, values: configValues } }
      },
      [],
      'crop', 'result',
      registerCurveNodes
    );

    executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } });

    const output = executor.getNodeOutput('crop');
    const ui = executor.getUiOutputs().get('crop');

    return { output: output!, ui: ui! };
  };

  it('should work in start-end mode (default)', () => {
    // Range 0.2 to 0.8
    const res = runCurveTest('start-end', 0.5, 0.2, 0.8);
    expect(res.output.fields.result).toBeCloseTo(0.5);
    expect(res.ui.end).toBeCloseTo(0.8);
  });

  it('should work in start-length mode', () => {
    // Start 0.2, Length 0.6 -> End 0.8
    // Val 0.5 -> mapped to [0.2, 0.8] -> 0.5
    const res = runCurveTest('start-length', 0.5, 0.2, 0.6);
    expect(res.output.fields.result).toBeCloseTo(0.5);
    expect(res.ui.start).toBeCloseTo(0.2);
    expect(res.ui.end).toBeCloseTo(0.8); // Worker calculates end
  });

  it('should calculate end correctly in start-length mode', () => {
    // Start 0.1, Length 0.2 -> End 0.3
    const res = runCurveTest('start-length', 0.0, 0.1, 0.2);
    expect(res.ui.end).toBeCloseTo(0.3);
  });
});

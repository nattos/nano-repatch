import { compileAndRun } from '../test/integration-utils';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { ALL_PRIMITIVES } from './primitives';
import { compileGraph } from '../builder/compiler';
import { AppState, GridNode, Connection } from '../builder/state';
import { numberType } from './std-types';

describe('Virtual Inputs Integration', () => {
  const repository = new NodeRepository();

  // Register all primitives
  ALL_PRIMITIVES.forEach(def => {
    repository.register({
      id: def.id,
      version: '1.0.0',
      displayName: def.id,
      definition: def,
      inputs: (def as any).inputs ? Object.entries((def as any).inputs).map(([name, type]: [string, any]) => ({
        name,
        type: type,
        defaultValue: type.defaultValue // Pass through defaultValue
      })) : [],
      outputs: Object.entries((def as any).outputs || {}).map(([name, type]) => ({ name, type: type as any })),
      compileConfig: (uiConfig) => {
        // Pass through the UI config as the node config
        return uiConfig;
      }
    });
  });

  // Mock Output Node
  repository.register({
    id: 'io.output',
    version: '1.0.0',
    displayName: 'Output',
    definition: {
      id: 'io.output',
      kind: 'primitive',
      configType: { kind: 'record', fields: {}, },
      computeOutputTypes: () => ({ kind: 'record', fields: { value: numberType }, }),
      execute: (inputs) => {
        return { fields: { value: inputs.fields.value }, };
      },
    },
    inputs: [{ name: 'value', type: numberType }],
    outputs: [{ name: 'value', type: numberType }],
    compileConfig: (c) => ({ fields: {}, })
  });

  it('should use virtual inputs for math.add when disconnected', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'add': {
          typeId: 'math.add',
          config: {
            // Simulate virtual inputs set by sliders
            values: { a: 10, b: 20 }
          }
        }
      },
      [],
      'add', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(30);
  });

  it('should use virtual inputs for math.lerp', () => {
    const { executor, getOutput } = compileAndRun(
      {
        'lerp': {
          typeId: 'math.lerp',
          config: {
            values: { a: 0, b: 100, t: 0.5 }
          }
        }
      },
      [],
      'lerp', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    expect(getOutput()).toBe(50);
  });

  it('should use defaultValue from PortHint if config.values is missing', () => {
    // math.clamp has defaults: min=0, max=1
    const { executor, getOutput } = compileAndRun(
      {
        'clamp': {
          typeId: 'math.clamp',
          config: {
            values: { value: 0.5 } // min and max missing
          }
        }
      },
      [],
      'clamp', 'result'
    );

    executor.update({ clock: { beat: 0, dt: 0 } });
    // If defaults work, min=0, max=1. 0.5 clamped to [0, 1] is 0.5.
    // If defaults fail (undefined), Math.min(0.5, undefined) is NaN.
    expect(getOutput()).toBe(0.5);
  });
});

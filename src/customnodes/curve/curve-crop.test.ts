import { describe, it, expect } from 'vitest';
import { curve_crop } from './nodes';
import { NodeRepository } from '../../structor/repository';
import { GraphExecutor } from '../../structor/executor';
import { compileGraph } from '../../builder/compiler';
import { NumberType } from '../../structor/type-helpers';
import { AppState } from '../../builder/state';

describe('curve.crop Mode Integration', () => {
  const repository = new NodeRepository();

  repository.register({
    id: 'curve.crop',
    version: '1.0.0',
    displayName: 'Curve Crop',
    definition: curve_crop,
    // We need to provide the dynamic behavior.
    // Since repository.register expects static definition mostly, but definition itself has computeForwardPorts
    // execute and computeForwardPorts provided by curve_crop definition object should work.
  } as any);

  repository.register({
    id: 'mock.source',
    version: '1.0.0',
    displayName: 'Mock',
    definition: {
      id: 'mock.source',
      kind: 'primitive',
      execute: (inputs: any, config: any) => ({ outputs: { fields: { val: config.fields.val } } }),
      computeOutputTypes: () => ({ kind: 'record', fields: { val: NumberType } }),
    },
    inputs: [],
    outputs: [{ name: 'val', type: NumberType }],
    compileConfig: (uiConfig: any) => ({ fields: { val: uiConfig.values?.val ?? uiConfig.val ?? 0 } })
  } as any);

  const compileAndRun = (mode: string, val: number, start: number, endOrLength: number) => {
    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'src_val': { id: 'src_val', x: 0, y: 0, config: { typeId: 'mock.source', values: { val } } },
            'src_start': { id: 'src_start', x: 0, y: 0, config: { typeId: 'mock.source', values: { val: start } } },
            'src_param': { id: 'src_param', x: 0, y: 0, config: { typeId: 'mock.source', values: { val: endOrLength } } },
            // Set mode in config values
            'crop': { id: 'crop', x: 1, y: 0, config: { typeId: 'curve.crop', mode } as any }
          },
          connections: {
            'c1': { id: 'c1', fromNodeId: 'src_val', fromPort: 'val', toNodeId: 'crop', toPort: 'value' },
            'c2': { id: 'c2', fromNodeId: 'src_start', fromPort: 'val', toNodeId: 'crop', toPort: 'start' },
            // Port name depends on mode, but compiled graph resolves valid ports.
            // Wait, connection to 'end' or 'length'?
            // For this test helper, we need to adapt the connection target port.
            'c3': { id: 'c3', fromNodeId: 'src_param', fromPort: 'val', toNodeId: 'crop', toPort: mode === 'start-length' ? 'length' : 'end' }
          }
        },
        auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
      },
      // @ts-ignore
      settings: {}
    };

    const { graph } = compileGraph(appState, new Map(), repository);
    const executor = new GraphExecutor(graph, repository);
    executor.update({ clock: { beat: 0, dt: 0.1, time: 0 } } as any);

    const output = executor.getNodeOutput('crop');
    const ui = executor.getUiOutputs().get('crop');

    return { output: output!, ui: ui! };
  };

  it('should work in start-end mode (default)', () => {
    // Range 0.2 to 0.8
    const res = compileAndRun('start-end', 0.5, 0.2, 0.8);
    expect(res.output.fields.result).toBeCloseTo(0.5);
    expect(res.ui.end).toBeCloseTo(0.8);
  });

  it('should work in start-length mode', () => {
    // Start 0.2, Length 0.6 -> End 0.8
    // Val 0.5 -> mapped to [0.2, 0.8] -> 0.5
    const res = compileAndRun('start-length', 0.5, 0.2, 0.6);
    expect(res.output.fields.result).toBeCloseTo(0.5);
    expect(res.ui.start).toBeCloseTo(0.2);
    expect(res.ui.end).toBeCloseTo(0.8); // Worker calculates end
  });

  it('should calculate end correctly in start-length mode', () => {
    // Start 0.1, Length 0.2 -> End 0.3
    const res = compileAndRun('start-length', 0.0, 0.1, 0.2);
    expect(res.ui.end).toBeCloseTo(0.3);
  });
});

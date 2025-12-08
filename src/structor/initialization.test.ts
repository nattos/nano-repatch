import { GraphExecutor } from './executor';
import { defaultNodeRepository } from './repository';
import { compileGraph } from '../builder/compiler';
import { AppState } from '../builder/state';

describe('Node Initialization and Updates', () => {
  it('should initialize data.float with default value 0', () => {
    // 1. Create AppState with a single float node (no config values)
    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'node-1': {
              id: 'node-1',
              x: 0,
              y: 0,
              config: { typeId: 'data.float', values: {} }
            }
          },
          connections: {}
        },
        auxiliary: {
          outgoingConnections: new Map(),
          incomingConnections: new Map()
        }
      }
    };

    // 2. Compile
    const graphDef = compileGraph(appState, new Map(), defaultNodeRepository);

    // 3. Execute
    const executor = new GraphExecutor(graphDef, defaultNodeRepository);
    executor.update({ clock: { beat: 0, dt: 0 } });

    // 4. Verify Output
    const output = executor.getNodeOutput('node-1');
    expect(output).toBeDefined();
    expect(output?.fields['value']).toBe(0);
  });

  it('should update data.float value dynamically', () => {
    // 1. Setup (same as above)
    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'node-1': {
              id: 'node-1',
              x: 0,
              y: 0,
              config: { typeId: 'data.float', values: {} }
            }
          },
          connections: {}
        },
        auxiliary: {
          outgoingConnections: new Map(),
          incomingConnections: new Map()
        }
      }
    };
    const graphDef = compileGraph(appState, new Map(), defaultNodeRepository);
    const executor = new GraphExecutor(graphDef, defaultNodeRepository);
    executor.update({ clock: { beat: 0, dt: 0 } });

    // 2. Simulate UPDATE_INPUT (Worker logic: merge values)
    const currentConfig = executor.getNodeConfig('node-1') || { fields: {},  };
    const currentValues = (currentConfig as any).values || {};
    const newConfig = {
      ...(currentConfig as any),
      values: { ...currentValues, value: 1.23 }
    };
    executor.setNodeConfig('node-1', newConfig);

    // 3. Execute again
    executor.update({ clock: { beat: 0, dt: 0 } });

    // 4. Verify Output
    const output = executor.getNodeOutput('node-1');
    expect(output?.fields['value']).toBe(1.23);
  });

  it('should initialize math.add with default inputs 0', () => {
    // 1. Create AppState with a single add node
    const appState: AppState = {
      graph: {
        inner: {
          nodes: {
            'node-add': {
              id: 'node-add',
              x: 0,
              y: 0,
              config: { typeId: 'math.add', values: {} }
            }
          },
          connections: {}
        },
        auxiliary: {
          outgoingConnections: new Map(),
          incomingConnections: new Map()
        }
      }
    };

    // 2. Compile & Execute
    const graphDef = compileGraph(appState, new Map(), defaultNodeRepository);
    const executor = new GraphExecutor(graphDef, defaultNodeRepository);
    executor.update({ clock: { beat: 0, dt: 0 } });

    // 3. Verify Output
    const output = executor.getNodeOutput('node-add');
    expect(output).toBeDefined();
    expect(output?.fields['result']).toBe(0); // 0 + 0 = 0
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppController, LocalController } from '../builder/state';
import { RuntimeManager } from './manager';
import { compileGraph } from '../builder/compiler';
import { GraphExecutor } from '../structor/executor';

// --- Mocks ---
vi.mock('../builder/compiler');
vi.mock('../structor/executor');

// --- Tests ---
describe('RuntimeManager', () => {
  let appController: AppController;
  let localController: LocalController;
  let runtimeManager: RuntimeManager;

  const mockCompileGraph = vi.mocked(compileGraph);
  const MockedGraphExecutor = vi.mocked(GraphExecutor);

  beforeEach(() => {
    appController = new AppController({
      nodes: { n1: { id: 'n1', x: 0, y: 0, config: { typeId: 'literal', value: 1 } } },
      connections: {},
    });
    localController = new LocalController();

    const graphDef = {
        id: 'compiled-graph',
        kind: 'graph',
        type: { kind: 'graph', inputs: { kind: 'record', fields: {}, untagged: [] }, outputs: { kind: 'record', fields: {}, untagged: [] } },
        nodes: { n1: { definitionId: 'literal', defaultConfig: { value: 1 } } },
        connections: [],
        inputs: {},
        outputs: {},
    };
    mockCompileGraph.mockReturnValue(graphDef);
    
    // Every time `new GraphExecutor()` is called, return a mock instance
    MockedGraphExecutor.mockImplementation(() => ({
        graph: graphDef,
        update: vi.fn(),
        setNodeConfig: vi.fn(),
        getOutputs: vi.fn(() => new Map()),
    }));

    runtimeManager = new RuntimeManager(appController, localController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create a new executor on initial load', async () => {
    // Wait for the initial, debounced compilation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(mockCompileGraph).toHaveBeenCalledTimes(1);
    expect(MockedGraphExecutor).toHaveBeenCalledTimes(1);
    const executorInstance = MockedGraphExecutor.mock.results[0].value;
    expect(executorInstance.update).toHaveBeenCalledTimes(1);
  });

  it('should create a new executor on structural change', async () => {
    // Wait for initial compilation
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(MockedGraphExecutor).toHaveBeenCalledTimes(1);

    // Structural change: add a node
    appController.createNode('add', 10, 10);

    // Wait for reaction
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should re-compile and create a new executor
    expect(mockCompileGraph).toHaveBeenCalledTimes(2);
    expect(MockedGraphExecutor).toHaveBeenCalledTimes(2);
    
    const firstInstance = MockedGraphExecutor.mock.results[0].value;
    const secondInstance = MockedGraphExecutor.mock.results[1].value;
    expect(firstInstance.update).toHaveBeenCalledTimes(1);
    expect(secondInstance.update).toHaveBeenCalledTimes(1);
  });

  it('should call setNodeConfig on config change', async () => {
    // Wait for initial compilation
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(MockedGraphExecutor).toHaveBeenCalledTimes(1);

    // Config change
    appController.setNodeConfig('n1', { value: 5 });

    // Wait for reaction
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should NOT create a new executor
    expect(MockedGraphExecutor).toHaveBeenCalledTimes(1);
    
    const executorInstance = MockedGraphExecutor.mock.results[0].value;

    // The reaction updates ALL configs, so we check for our specific node
    expect(executorInstance.setNodeConfig).toHaveBeenCalledWith('n1', { value: 5 });
    
    // Should call update again
    expect(executorInstance.update).toHaveBeenCalledTimes(2);
  });
});

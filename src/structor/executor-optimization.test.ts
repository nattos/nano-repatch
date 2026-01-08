import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { GraphDefinition, PrimitiveNodeDefinition, AtomicType, StructorRecord, ExecutionContext, Structor } from './structor';

const numberType: AtomicType = { kind: 'atomic', type: 'number' };

describe('GraphExecutor Optimization', () => {
  // Mock Node Definitions
  const mockExecute = vi.fn((input: StructorRecord, config: Structor) => {
    return { fields: { result: (config as number || 0) + (input.fields['in'] as number || 0) } };
  });

  const mockNodeDef: PrimitiveNodeDefinition = {
    id: 'mock.node', kind: 'primitive',
    computeOutputTypes: () => ({ kind: 'record', fields: { result: numberType } }),
    execute: mockExecute,
  };

  const repo = new NodeRepository();
  repo.register({ id: 'mock.node', version: '1.0.0', displayName: 'Mock Node', definition: mockNodeDef });

  // Simple A -> B Graph
  const graph: GraphDefinition = {
    id: 'optGraph', kind: 'graph',
    type: { kind: 'graph', inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: {} } },
    nodes: {
      'A': { definitionId: 'mock.node', defaultConfig: 10 },
      'B': { definitionId: 'mock.node', defaultConfig: 5 }
    },
    connections: [
      { fromNode: 'A', fromPort: 'result', toNode: 'B', toPort: 'in' }
    ],
    inputs: {},
    outputs: {},
    executionOrder: ['A', 'B']
  };

  it('should track executed nodes correctly', () => {
    mockExecute.mockClear();
    const executor = new GraphExecutor(graph, repo);

    // 1. First run: Everything runs (initially dirty)
    executor.update({});

    const executed1 = executor.getExecutedNodes();
    expect(executed1.has('A')).toBe(true);
    expect(executed1.has('B')).toBe(true);
    expect(executed1.size).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);

    // 2. Second run: Nothing changed, nothing runs
    mockExecute.mockClear();
    executor.update({});

    const executed2 = executor.getExecutedNodes();
    expect(executed2.size).toBe(0);
    expect(mockExecute).toHaveBeenCalledTimes(0);

    // 3. Mark downstream node B dirty
    mockExecute.mockClear();
    executor.markDirty('B');
    executor.update({});

    const executed3 = executor.getExecutedNodes();
    expect(executed3.has('A')).toBe(false); // A didn't run
    expect(executed3.has('B')).toBe(true);  // B ran
    expect(executed3.size).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);

    // 4. Mark upstream node A dirty
    mockExecute.mockClear();
    executor.markDirty('A');
    // This triggers downstream dirty marking for B
    executor.update({});

    const executed4 = executor.getExecutedNodes();
    expect(executed4.has('A')).toBe(true);
    expect(executed4.has('B')).toBe(true);
    expect(executed4.size).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('should track new dirty nodes even if not in original dirty set', () => {
    mockExecute.mockClear();
    const executor = new GraphExecutor(graph, repo);
    executor.update({}); // Flush initial

    // Update config for A, which marks A dirty
    executor.setNodeConfig('A', 20);
    executor.update({});

    const executed = executor.getExecutedNodes();
    expect(executed.has('A')).toBe(true);
    expect(executed.has('B')).toBe(true); // Downstream
  });
});

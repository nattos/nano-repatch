import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { GraphDefinition, PrimitiveNodeDefinition, AtomicType, StructorRecord, ExecutionContext, Structor } from './structor';

const numberType: AtomicType = { kind: 'atomic', type: 'number' };

describe('GraphExecutor', () => {
    const addExecute = vi.fn((input: StructorRecord, config: Structor, context: ExecutionContext) => {
        const values = [...Object.values(input.fields), ...input.untagged] as number[];
        const sum = values.reduce((a, b) => a + b, 0);
        return { fields: {}, untagged: [sum] };
    });

    const mock_primitive_add: PrimitiveNodeDefinition = {
        id: 'add', kind: 'primitive',
        computeOutputTypes: (i, c, ctx) => ({ kind: 'record', fields: {}, untagged: [numberType] }),
        execute: addExecute,
    };

    const literalExecute = vi.fn((input: StructorRecord, config: Structor, context: ExecutionContext) => {
        return { fields: {}, untagged: [config] };
    });

    const mock_primitive_literal: PrimitiveNodeDefinition = {
        id: 'literal', kind: 'primitive', configType: numberType,
        computeOutputTypes: (i, c, ctx) => ({ kind: 'record', fields: {}, untagged: [numberType] }),
        execute: literalExecute,
    };

    const testRepo = new NodeRepository();
    testRepo.register({ id: 'add', version: '1.0.0', displayName: 'Add', definition: mock_primitive_add });
    testRepo.register({ id: 'literal', version: '1.0.0', displayName: 'Literal', definition: mock_primitive_literal });

    const testGraph: GraphDefinition = {
        id: 'testGraph', kind: 'graph',
        type: {
            kind: 'graph',
            inputs: { kind: 'record', fields: { 'a': numberType }, untagged: [] },
            outputs: { kind: 'record', fields: { 'c': numberType }, untagged: [] },
        },
        nodes: {
            'adder': { definitionId: 'add' },
            'ten': { definitionId: 'literal', defaultConfig: 10 },
        },
        inputs: { 'a': { nodeId: 'adder', port: 0 } },
        connections: [{ fromNode: 'ten', fromPort: 0, toNode: 'adder', toPort: 1 }],
        outputs: { 'c': { nodeId: 'adder', port: 0 } },
    };

    it('should initialize with default config and perform a full update', () => {
        addExecute.mockClear();
        literalExecute.mockClear();
        const executor = new GraphExecutor(testGraph, testRepo);

        executor.setInput('a', 5);
        executor.update();

        const output = executor.getGraphOutput('c');
        expect(output).toBe(15); // 5 (input) + 10 (defaultConfig)
        expect(addExecute).toHaveBeenCalledTimes(1);
        expect(literalExecute).toHaveBeenCalledTimes(1);
        expect(literalExecute).toHaveBeenCalledWith(expect.anything(), 10, expect.anything());
    });

    it('should update when a node config is changed', () => {
        addExecute.mockClear();
        literalExecute.mockClear();
        const executor = new GraphExecutor(testGraph, testRepo);

        // First update
        executor.setInput('a', 5);
        executor.update();
        expect(executor.getGraphOutput('c')).toBe(15);
        expect(addExecute).toHaveBeenCalledTimes(1);
        expect(literalExecute).toHaveBeenCalledTimes(1);

        // Change config and update again
        executor.setNodeConfig('ten', 100);
        executor.update();
        expect(executor.getGraphOutput('c')).toBe(105); // 5 + 100
        expect(addExecute).toHaveBeenCalledTimes(2); // Adder is downstream, should re-run
        expect(literalExecute).toHaveBeenCalledTimes(2); // Literal itself re-ran
        expect(literalExecute).toHaveBeenCalledWith(expect.anything(), 100, expect.anything());
    });
});
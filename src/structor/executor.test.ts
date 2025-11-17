
import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository } from './repository';
import { GraphDefinition, PrimitiveNodeDefinition, AtomicType, StructorRecord, ExecutionContext } from './structor';

const numberType: AtomicType = { kind: 'atomic', type: 'number' };

describe('GraphExecutor', () => {
    // Mock 'add' primitive that we can spy on
    const addExecute = vi.fn((input: StructorRecord, context: ExecutionContext) => {
        const values = [...Object.values(input.fields), ...input.untagged] as number[];
        const sum = values.reduce((a, b) => a + b, 0);
        return { fields: {}, untagged: [sum] };
    });

    const mock_primitive_add: PrimitiveNodeDefinition = {
        id: 'add',
        kind: 'primitive',
        computeOutputTypes: (inputType, context) => ({ kind: 'record', fields: {}, untagged: [numberType] }),
        execute: addExecute,
    };

    // Mock 'literal' primitive
    const make_mock_literal = (value: number): PrimitiveNodeDefinition => ({
        id: `literal_${value}`,
        kind: 'primitive',
        computeOutputTypes: (inputType, context) => ({ kind: 'record', fields: {}, untagged: [numberType] }),
        execute: (input, context) => ({ fields: {}, untagged: [value] }),
    });

    const testRepo = new NodeRepository();
    testRepo.register({ id: 'add', version: '1.0.0', displayName: 'Add', definition: mock_primitive_add });
    testRepo.register({ id: 'literal_10', version: '1.0.0', displayName: '10', definition: make_mock_literal(10) });

    // A simple graph: input 'a' -> adder -> output 'c'
    //                      literal_10 ->
    const testGraph: GraphDefinition = {
        id: 'testGraph',
        kind: 'graph',
        type: {
            kind: 'graph',
            inputs: { kind: 'record', fields: { 'a': numberType }, untagged: [] },
            outputs: { kind: 'record', fields: { 'c': numberType }, untagged: [] },
        },
        nodes: {
            'adder': { definitionId: 'add' },
            'ten': { definitionId: 'literal_10' },
        },
        inputs: {
            'a': { nodeId: 'adder', port: 0 },
        },
        connections: [
            { fromNode: 'ten', fromPort: 0, toNode: 'adder', toPort: 1 },
        ],
        outputs: {
            'c': { nodeId: 'adder', port: 0 },
        },
    };

    it('should initialize and perform a full update', () => {
        const executor = new GraphExecutor(testGraph, testRepo);

        executor.setInput('a', 5);
        executor.update();

        const output = executor.getGraphOutput('c');
        expect(output).toBe(15); // 5 (input) + 10 (literal)
        expect(addExecute).toHaveBeenCalledTimes(1);
    });

    it('should only update dirty nodes', () => {
        addExecute.mockClear();
        const executor = new GraphExecutor(testGraph, testRepo);

        // First update
        executor.setInput('a', 5);
        executor.update();
        expect(executor.getGraphOutput('c')).toBe(15);
        expect(addExecute).toHaveBeenCalledTimes(1);

        // Second update with no changes
        executor.update();
        expect(addExecute).toHaveBeenCalledTimes(1); // Should not have been called again

        // Change input and update again
        executor.setInput('a', 20);
        executor.update();
        expect(executor.getGraphOutput('c')).toBe(30); // 20 + 10
        expect(addExecute).toHaveBeenCalledTimes(2); // Should have been called again
    });

    it('should correctly identify downstream dirty nodes', () => {
        const passThroughExec = vi.fn((input: StructorRecord, context: ExecutionContext) => ({
            fields: {}, untagged: [input.untagged[0]]
        }));
        const mock_passthrough: PrimitiveNodeDefinition = {
            id: 'passthrough', kind: 'primitive',
            computeOutputTypes: (inputType, context) => ({ kind: 'record', fields: {}, untagged: [numberType] }),
            execute: passThroughExec,
        };
        
        const repo = new NodeRepository();
        repo.register({ id: 'passthrough', version: '1.0.0', displayName: 'Passthrough', definition: mock_passthrough });

        const chainGraph: GraphDefinition = {
            id: 'chainGraph', kind: 'graph',
            type: {
                kind: 'graph',
                inputs: { kind: 'record', fields: { 'in': numberType }, untagged: [] },
                outputs: { kind: 'record', fields: { 'out': numberType }, untagged: [] },
            },
            nodes: { 'A': { definitionId: 'passthrough' }, 'B': { definitionId: 'passthrough' }, 'C': { definitionId: 'passthrough' } },
            inputs: { 'in': { nodeId: 'A', port: 0 } },
            connections: [
                { fromNode: 'A', fromPort: 0, toNode: 'B', toPort: 0 },
                { fromNode: 'B', fromPort: 0, toNode: 'C', toPort: 0 },
            ],
            outputs: { 'out': { nodeId: 'C', port: 0 } },
        };

        const executor = new GraphExecutor(chainGraph, repo);
        
        // Initial update
        executor.setInput('in', 1);
        executor.update();
        expect(passThroughExec).toHaveBeenCalledTimes(3); // A, B, and C

        // No changes
        executor.update();
        expect(passThroughExec).toHaveBeenCalledTimes(3);

        // Change input, should re-execute all
        passThroughExec.mockClear();
        executor.setInput('in', 2);
        executor.update();
        expect(passThroughExec).toHaveBeenCalledTimes(3);
    });
});

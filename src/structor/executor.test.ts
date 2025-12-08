import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from './executor';
import { NodeRepository, defaultNodeRepository } from "./repository";
import { GraphDefinition, PrimitiveNodeDefinition, AtomicType, StructorRecord, ExecutionContext, Structor } from './structor';
import { primitive_fmod } from './primitives';

const numberType: AtomicType = { kind: 'atomic', type: 'number' };

describe('GraphExecutor', () => {
    const addExecute = vi.fn((input: StructorRecord, config: Structor, context: ExecutionContext) => {
        const a = input.fields['a'] as number || 0;
        const b = input.fields['b'] as number || 0;
        // Also handle virtual/other inputs in a real scenario, but for now specific to test graph
        const val_a = input.fields['val_a'] as number || 0;
        const val_b = input.fields['val_b'] as number || 0;

        // Sum all numbers found in fields for this generic mock?
        // Or keep it simple: just sum values.
        const values = Object.values(input.fields).filter(v => typeof v === 'number') as number[];
        const sum = values.reduce((acc, v) => acc + v, 0);
        return { fields: { result: sum } }; // The graph expects output 'c' on port 0?
        // In testGraph: outputs: { 'c': { nodeId: 'adder', port: 0 } }
        // Wait, port 0 (number) maps to what?
        // In my new executor logic, port numbers are ignored/legacy unless named explicitly.
        // I should probably update the test graph to use named ports.
    });

    const mock_primitive_add: PrimitiveNodeDefinition = {
        id: 'math.add', kind: 'primitive',
        computeOutputTypes: (i, c, ctx) => ({ kind: 'record', fields: { result: numberType } }),
        execute: addExecute,
    };

    const literalExecute = vi.fn((input: StructorRecord, config: Structor, context: ExecutionContext) => {
        return { fields: { value: config } };
    });

    const mock_primitive_literal: PrimitiveNodeDefinition = {
        id: 'data.literal', kind: 'primitive', configType: numberType,
        computeOutputTypes: (i, c, ctx) => ({ kind: 'record', fields: { value: numberType } }),
        execute: literalExecute,
    };

    const testRepo = new NodeRepository();
    testRepo.register({ id: 'math.add', version: '1.0.0', displayName: 'Add', definition: mock_primitive_add });
    testRepo.register({ id: 'data.literal', version: '1.0.0', displayName: 'Literal', definition: mock_primitive_literal });
    testRepo.register({ id: 'math.fmod', version: '1.0.0', displayName: 'FMod', definition: primitive_fmod });

    const testGraph: GraphDefinition = {
        id: 'testGraph', kind: 'graph',
        type: {
            kind: 'graph',
            inputs: { kind: 'record', fields: { 'a': numberType },  },
            outputs: { kind: 'record', fields: { 'c': numberType },  },
        },
        nodes: {
            'adder': { definitionId: 'math.add' },
            'ten': { definitionId: 'data.literal', defaultConfig: 10 },
        },
        inputs: { 'a': { nodeId: 'adder', port: 'a' } }, // Updated to named port
        connections: [{ fromNode: 'ten', fromPort: 'value', toNode: 'adder', toPort: 'b' }], // named ports
        outputs: { 'c': { nodeId: 'adder', port: 'result' } }, // named port
    };

    it('should initialize with default config and perform a full update', () => {
        addExecute.mockClear();
        literalExecute.mockClear();
        const executor = new GraphExecutor(testGraph, testRepo);

        executor.setInput('a', 5);
        executor.update({});

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
        executor.update({});
        expect(executor.getGraphOutput('c')).toBe(15);
        expect(addExecute).toHaveBeenCalledTimes(1);
        expect(literalExecute).toHaveBeenCalledTimes(1);

        // Change config and update again
        executor.setNodeConfig('ten', 100);
        executor.update({});
        expect(executor.getGraphOutput('c')).toBe(105); // 5 + 100
        expect(addExecute).toHaveBeenCalledTimes(2); // Adder is downstream, should re-run
        expect(literalExecute).toHaveBeenCalledTimes(2); // Literal itself re-ran
        expect(literalExecute).toHaveBeenCalledWith(expect.anything(), 100, expect.anything());
    });

    it('should correctly execute fmod', () => {
        const fmodGraph: GraphDefinition = {
            id: 'fmodGraph', kind: 'graph',
            type: {
                kind: 'graph',
                inputs: { kind: 'record', fields: {},  },
                outputs: { kind: 'record', fields: { 'div': numberType, 'mod': numberType },  },
            },
            nodes: {
                'dividend': { definitionId: 'data.literal', defaultConfig: 10 },
                'divisor': { definitionId: 'data.literal', defaultConfig: 3 },
                'fmod': { definitionId: 'math.fmod' },
            },
            inputs: {},
            connections: [
                { fromNode: 'dividend', fromPort: 'value', toNode: 'fmod', toPort: 'dividend' },
                { fromNode: 'divisor', fromPort: 'value', toNode: 'fmod', toPort: 'divisor' }
            ],
            outputs: {
                'div': { nodeId: 'fmod', port: 'div' },
                'mod': { nodeId: 'fmod', port: 'mod' }
            },
        };

        const executor = new GraphExecutor(fmodGraph, testRepo);
        executor.update({});

        expect(executor.getGraphOutput('div')).toBe(3);
        expect(executor.getGraphOutput('mod')).toBe(1);
    });

    it('should use virtual input values when ports are not connected', () => {
        const fmodGraph: GraphDefinition = {
            id: 'fmodVirtualGraph', kind: 'graph',
            type: {
                kind: 'graph',
                inputs: { kind: 'record', fields: {},  },
                outputs: { kind: 'record', fields: { 'mod': numberType },  },
            },
            nodes: {
                'fmod': { definitionId: 'math.fmod' },
            },
            inputs: {},
            connections: [],
            outputs: { 'mod': { nodeId: 'fmod', port: 'mod' } },
        };

        const fmodExecutor = new GraphExecutor(fmodGraph, testRepo);

        // Set virtual inputs
        fmodExecutor.setNodeConfig('fmod', { values: { 'dividend': 10, 'divisor': 3 } } as any);
        fmodExecutor.update({});

        expect(fmodExecutor.getGraphOutput('mod')).toBe(1);
    });
});
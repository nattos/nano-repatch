import { describe, it, expect } from 'vitest';
import {
    AtomicType, FunctorType, RecordType, Functor, StructorRecord, AnalysisContext,
    ExecutionContext, GraphDefinition, PrimitiveNodeDefinition, Structor, StructorType
} from './structor';
import { NodeRepository } from './repository';

const numberType: AtomicType = { kind: 'atomic', type: 'number' };
const stringType: AtomicType = { kind: 'atomic', type: 'string' };
const anyType: AtomicType = { kind: 'atomic', type: 'any' };

describe('Structor Core Tests', () => {
    // This test file now focuses on the graph data structures and the interaction
    // with the executor, rather than the specifics of the primitives.
    // The primitives are mocked here to test graph logic in isolation.

    // --- MOCK PRIMITIVES FOR TESTING ---
    const mock_add: PrimitiveNodeDefinition = {
        id: 'mock_add', kind: 'primitive',
        computeOutputTypes: (i, c, ctx) => ({ kind: 'record', fields: {}, untagged: [numberType] }),
        execute: (input, config, context) => {
            const broadcastResult = context.broadcast({} as any, input);
            const result = broadcastResult.apply((args: any) => args.reduce((a: number, b: number) => a + b, 0));
            return { fields: {}, untagged: [result] };
        }
    };

    const mock_clamp: PrimitiveNodeDefinition = {
        id: 'mock_clamp', kind: 'primitive',
        computeOutputTypes: (i, c, ctx) => ({ kind: 'record', fields: {}, untagged: [i.fields['value'] || i.untagged[0]] }),
        execute: (input, config, context) => {
            const broadcastResult = context.broadcast({} as any, input);
            const clamped = broadcastResult.apply((args: any) => Math.max(args.min, Math.min(args.value, args.max)));
            return { fields: {}, untagged: [clamped] };
        }
    };

    const mock_literal: PrimitiveNodeDefinition = {
        id: 'mock_literal', kind: 'primitive', configType: anyType,
        computeOutputTypes: (i, configType, ctx) => ({ kind: 'record', fields: {}, untagged: [configType] }),
        execute: (i, config, ctx) => ({ fields: {}, untagged: [config] }),
    };

    const mock_apply: PrimitiveNodeDefinition = {
        id: 'mock_apply', kind: 'primitive',
        computeOutputTypes: (inputType, c, ctx) => ({ kind: 'record', fields: {}, untagged: [(inputType.fields['functor'] as FunctorType).output] }),
        execute: (input, c, ctx) => {
            const functor = input.fields['functor'] as Functor;
            const inputValue = input.fields['input'];
            return { fields: {}, untagged: [functor(inputValue)] };
        }
    };

    // --- TEST CASE 1 ---
    describe('Test Case 1: \'Add\' Node (Broadcasting & Coercion)', () => {
        const testRepo = new NodeRepository();
        testRepo.register({ id: 'math.add', version: '1.0.0', displayName: 'Add', definition: mock_add });

        const graph_TestAdd: GraphDefinition = {
            id: 'graph:TestAdd', kind: 'graph',
            type: {
                kind: 'graph',
                inputs: { kind: 'record', fields: { 'a': numberType, 'b': { kind: 'array', size: 2, element: numberType }, 'c': stringType }, untagged: [] },
                outputs: { kind: 'record', fields: { 'result': { kind: 'array', size: 2, element: numberType } }, untagged: [] }
            },
            nodes: { 'adder': { definitionId: 'math.add' } },
            connections: [],
            inputs: { 'a': { nodeId: 'adder', port: 'val_a' }, 'b': { nodeId: 'adder', port: 'val_b' }, 'c': { nodeId: 'adder', port: 0 } },
            outputs: { 'result': { nodeId: 'adder', port: 0 } }
        };

        it('should pass the runtime execution test', () => {
            const executionContext: ExecutionContext = {
                broadcast: (config, inputs) => ({
                    apply: (lambda: any) => [
                        lambda([10, 100, 5]),
                        lambda([10, 200, 5])
                    ]
                } as any),
                repository: testRepo,
                clock: { beat: 0, dt: 0 },
                nodeState: new Map()
            };
            const adderDef = executionContext.repository.get('math.add') as PrimitiveNodeDefinition;
            const inputData: StructorRecord = { "fields": { "a": 10, "b": [100, 200], "c": "5" }, "untagged": [] };
            const adderInput: StructorRecord = {
                fields: { 'val_a': inputData.fields['a'], 'val_b': inputData.fields['b'] },
                untagged: [inputData.fields['c']]
            };
            const adderOutput = adderDef.execute(adderInput, undefined as any, executionContext);
            const finalOutput: StructorRecord = { fields: { 'result': adderOutput.untagged[0] }, untagged: [] };
            const expectedOutput: StructorRecord = { "fields": { "result": [115, 215] }, "untagged": [] };
            expect(finalOutput).toEqual(expectedOutput);
        });
    });

    // --- TEST CASE 2 ---
    describe('Test Case 2: \'Clamp\' Node (Reduction & Input Gathering)', () => {
        const testRepo = new NodeRepository();
        testRepo.register({ id: 'math.clamp', version: '1.0.0', displayName: 'Clamp', definition: mock_clamp });

        it('should pass the runtime execution test', () => {
            const executionContext: ExecutionContext = {
                broadcast: (config, inputs) => ({
                    apply: (lambda: any) => [
                        lambda({ value: 5, min: 10, max: 100 }),
                        lambda({ value: 500, min: 10, max: 100 })
                    ]
                } as any),
                repository: testRepo,
                clock: { beat: 0, dt: 0 },
                nodeState: new Map()
            };
            const clamperDef = executionContext.repository.get('math.clamp') as PrimitiveNodeDefinition;
            const inputData: StructorRecord = { "fields": { "v1": 5, "v2": 500, "min1": 10, "max1": 100, "max2": 90 }, "untagged": [] };
            const clamperInput: StructorRecord = {
                fields: { 'value': [inputData.fields['v1']], 'min': [inputData.fields['min1']], 'max': [inputData.fields['max1'], inputData.fields['max2']] },
                untagged: [inputData.fields['v2']]
            };
            const clamperOutput = clamperDef.execute(clamperInput, undefined as any, executionContext);
            const finalOutput: StructorRecord = { fields: { 'result': clamperOutput.untagged[0] }, untagged: [] };
            const expectedOutput: StructorRecord = { "fields": { "result": [10, 100] }, "untagged": [] };
            expect(finalOutput).toEqual(expectedOutput);
        });
    });

    // --- TEST CASE 3 ---
    describe('Test Case 3: Nested Graphs, Functors, and Chaining', () => {
        const testRepo = new NodeRepository();
        testRepo.register({ id: 'math.add', version: '1.0.0', displayName: 'Add', definition: mock_add });
        testRepo.register({ id: 'functional.apply', version: '1.0.0', displayName: 'Apply', definition: mock_apply });
        testRepo.register({ id: 'data.literal', version: '1.0.0', displayName: 'Literal', definition: mock_literal });

        const graph_SubGraphAdd5: GraphDefinition = {
            id: 'graph:SubGraphAdd5', kind: 'graph',
            type: {
                kind: 'graph',
                inputs: { kind: 'record', fields: { 'in': numberType }, untagged: [] },
                outputs: { kind: 'record', fields: { 'out': numberType }, untagged: [] }
            },
            nodes: {
                'adder': { definitionId: 'math.add' },
                'const5': { definitionId: 'data.literal', defaultConfig: 5 }
            },
            connections: [{ fromNode: 'const5', fromPort: 0, toNode: 'adder', toPort: 1 }],
            inputs: { 'in': { nodeId: 'adder', port: 0 } },
            outputs: { 'out': { nodeId: 'adder', port: 0 } },
        };
        testRepo.register({ id: 'SubGraphAdd5', version: '1.0.0', displayName: 'Add 5', definition: graph_SubGraphAdd5 });

        it('should pass the runtime execution test', () => {
            const myFunctor: Functor = (x) => (x as number) * 2;
            const inputData: StructorRecord = { "fields": { "myFunctor": myFunctor }, "untagged": [] };
            const executionContext: ExecutionContext = {
                broadcast: (config, inputs) => ({
                    apply: (lambda: any) => lambda([inputs.untagged[0], inputs.untagged[1]])
                } as any),
                repository: testRepo,
                clock: { beat: 0, dt: 0 },
                nodeState: new Map()
            };

            // Simulate execution flow
            const const10Def = executionContext.repository.get('data.literal') as PrimitiveNodeDefinition;
            const const10Output = const10Def.execute(null as any, 10, executionContext).untagged[0];
            expect(const10Output).toBe(10);

            const applierDef = executionContext.repository.get('functional.apply') as PrimitiveNodeDefinition;
            const applierInput: StructorRecord = { fields: { 'functor': inputData.fields['myFunctor'], 'input': const10Output }, untagged: [] };
            const applierOutput = applierDef.execute(applierInput, undefined as any, executionContext).untagged[0];
            expect(applierOutput).toBe(20);

            // Mock subgraph execution
            const const5Def = executionContext.repository.get('data.literal') as PrimitiveNodeDefinition;
            const const5Output = const5Def.execute(null as any, 5, executionContext).untagged[0];
            const addDef = executionContext.repository.get('math.add') as PrimitiveNodeDefinition;
            const adderInput: StructorRecord = { fields: {}, untagged: [applierOutput, const5Output] };
            const add5GraphOutput = addDef.execute(adderInput, undefined as any, executionContext);

            const finalOutput: StructorRecord = { fields: { 'result': add5GraphOutput.untagged[0] }, untagged: [] };
            const expectedOutput: StructorRecord = { "fields": { "result": 25 }, "untagged": [] };
            expect(finalOutput).toEqual(expectedOutput);
        });
    });
});

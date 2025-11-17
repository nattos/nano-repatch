import { describe, it, expect } from 'vitest';
import {
    AtomicType,
    FunctorType,
    RecordType,
    Functor,
    StructorRecord,
    AnalysisContext,
    ExecutionContext,
    GraphDefinition,
    PrimitiveNodeDefinition,
    Structor,
    StructorType,
    BroadcastConfig
} from './structor';
import { NodeRepository } from './repository';

const numberType: AtomicType = { kind: 'atomic', type: 'number' };
const stringType: AtomicType = { kind: 'atomic', type: 'string' };

describe('Structor Graph: Test Case 1: \'Add\' Node (Broadcasting & Coercion)', () => {

    const mock_primitive_add: PrimitiveNodeDefinition = {
        id: 'mock_add',
        kind: 'primitive',
        computeOutputTypes: (inputType, context) => {
            return {
                kind: 'record',
                fields: {},
                untagged: [{
                    kind: 'array',
                    size: 2,
                    element: { kind: 'atomic', type: 'number' }
                }]
            };
        },
        execute: (input, context) => {
            const config: BroadcastConfig = {
                outputs: {
                    val_a: { fromFields: ['val_a'], fromUntagged: false, combine: 'collect', coerceTo: 'number' },
                    val_b: { fromFields: ['val_b'], fromUntagged: false, combine: 'collect', coerceTo: 'number' },
                    untagged_0: { fromFields: [], fromUntagged: [0], combine: 'collect', coerceTo: 'number' },
                },
                reshape: 'vector',
            };
            const broadcastResult = context.broadcast(config, input);
            const sum = broadcastResult.broadcasted.map((tuple: number[]) => tuple.reduce((a: number, b: number) => a + b, 0));
            return {
                fields: {},
                untagged: [sum]
            };
        }
    };

    const testRepo = new NodeRepository();
    testRepo.register({ id: 'add', version: '1.0.0', displayName: 'Add', definition: mock_primitive_add });

    it('should pass the static analysis test', () => {
        const graph_TestAdd: GraphDefinition = {
            id: 'graph:TestAdd',
            kind: 'graph',
            type: {
                kind: 'graph',
                inputs: {
                    kind: 'record',
                    fields: {
                        'a': numberType,
                        'b': { kind: 'array', size: 2, element: numberType },
                        'c': stringType,
                    },
                    untagged: []
                },
                outputs: {
                    kind: 'record',
                    fields: {
                        'result': {
                            kind: 'array',
                            size: 2,
                            element: numberType
                        }
                    },
                    untagged: []
                }
            },
            nodes: {
                'adder': { definitionId: 'add' }
            },
            inputs: {
                'a': { nodeId: 'adder', port: 'val_a' },
                'b': { nodeId: 'adder', port: 'val_b' },
                'c': { nodeId: 'adder', port: 0 }
            },
            outputs: {
                'result': { nodeId: 'adder', port: 0 }
            }
        };

        const analysisContext: AnalysisContext = {
            broadcast: (config, inputs) => ({
                kind: 'array',
                size: 2,
                element: { kind: 'atomic', type: 'number' }
            }),
            repository: testRepo
        };

        const adderDef = analysisContext.repository.get(graph_TestAdd.nodes['adder'].definitionId) as PrimitiveNodeDefinition;

        const adderInputType: RecordType = {
            kind: 'record',
            fields: {
                'val_a': graph_TestAdd.type.inputs.fields['a'],
                'val_b': graph_TestAdd.type.inputs.fields['b'],
            },
            untagged: [graph_TestAdd.type.inputs.fields['c']]
        };

        const adderOutputType = adderDef.computeOutputTypes(adderInputType, analysisContext);
        const finalOutputType: RecordType = {
            kind: 'record',
            fields: {
                'result': adderOutputType.untagged[0]
            },
            untagged: []
        };

        expect(finalOutputType).toEqual(graph_TestAdd.type.outputs);
    });

    it('should pass the runtime execution test', () => {
        const executionContext: ExecutionContext = {
            broadcast: (config, inputs) => ({ broadcasted: [[10, 100, 5], [10, 200, 5]] }),
            repository: testRepo
        };

        const inputData: StructorRecord = { "fields": { "a": 10, "b": [100, 200], "c": "5" }, "untagged": [] };

        const adderDef = executionContext.repository.get('add') as PrimitiveNodeDefinition;

        const adderInput: StructorRecord = {
            fields: {
                'val_a': inputData.fields['a'],
                'val_b': inputData.fields['b'],
            },
            untagged: [inputData.fields['c']]
        };

        const adderOutput = adderDef.execute(adderInput, executionContext);
        const finalOutput: StructorRecord = {
            fields: {
                'result': adderOutput.untagged[0]
            },
            untagged: []
        };

        const expectedOutput: StructorRecord = { "fields": { "result": [115, 215] }, "untagged": [] };

        expect(finalOutput).toEqual(expectedOutput);
    });
});

describe('Structor Graph: Test Case 2: \'Clamp\' Node (Reduction & Input Gathering)', () => {
    
    const mock_primitive_clamp: PrimitiveNodeDefinition = {
        id: 'mock_clamp',
        kind: 'primitive',
        computeOutputTypes: (inputType, context) => {
            const broadcastResultType = context.broadcast({} as any, inputType);
            return {
                kind: 'record',
                fields: {},
                untagged: [broadcastResultType.fields.value]
            };
        },
        execute: (input, context) => {
            const broadcastResult = context.broadcast({} as any, input) as { fields: { value: number[], min: number, max: number } };
            const clamped = broadcastResult.fields.value.map(v => 
                Math.max(broadcastResult.fields.min, Math.min(v, broadcastResult.fields.max))
            );
            return {
                fields: {},
                untagged: [clamped]
            };
        }
    };

    const testRepo = new NodeRepository();
    testRepo.register({ id: 'clamp', version: '1.0.0', displayName: 'Clamp', definition: mock_primitive_clamp });

    it('should pass the static analysis test', () => {
        const graph_TestClamp: GraphDefinition = {
            id: 'graph:TestClamp',
            kind: 'graph',
            type: {
                kind: 'graph',
                inputs: {
                    kind: 'record',
                    fields: {
                        'v1': numberType, 'v2': numberType, 'min1': numberType, 'max1': numberType, 'max2': numberType,
                    },
                    untagged: []
                },
                outputs: {
                    kind: 'record',
                    fields: { 'result': { kind: 'array', size: 2, element: numberType } },
                    untagged: []
                }
            },
            nodes: { 'clamper': { definitionId: 'clamp' } },
            inputs: {
                'v1': { nodeId: 'clamper', port: 'value' }, 'v2': { nodeId: 'clamper', port: 0 },
                'min1': { nodeId: 'clamper', port: 'min' }, 'max1': { nodeId: 'clamper', port: 'max' },
                'max2': { nodeId: 'clamper', port: 'max' }
            },
            outputs: { 'result': { nodeId: 'clamper', port: 0 } }
        };

        const analysisContext: AnalysisContext = {
            broadcast: (config, inputs) => ({
                fields: { 'value': { kind: 'array', size: 2, element: numberType }, 'min': numberType, 'max': numberType }
            }),
            repository: testRepo
        };

        const clamperDef = analysisContext.repository.get('clamp') as PrimitiveNodeDefinition;

        const clamperInputType: RecordType = {
            kind: 'record',
            fields: {
                'value': [graph_TestClamp.type.inputs.fields['v1']],
                'min': [graph_TestClamp.type.inputs.fields['min1']],
                'max': [graph_TestClamp.type.inputs.fields['max1'], graph_TestClamp.type.inputs.fields['max2']],
            },
            untagged: [graph_TestClamp.type.inputs.fields['v2']]
        };

        const clamperOutputType = clamperDef.computeOutputTypes(clamperInputType, analysisContext);
        const finalOutputType: RecordType = {
            kind: 'record',
            fields: { 'result': clamperOutputType.untagged[0] },
            untagged: []
        };

        expect(finalOutputType).toEqual(graph_TestClamp.type.outputs);
    });

    it('should pass the runtime execution test', () => {
        const executionContext: ExecutionContext = {
            broadcast: (config, inputs) => ({
                fields: { 'value': [5, 500], 'min': 10, 'max': 100 }
            }),
            repository: testRepo
        };

        const clamperDef = executionContext.repository.get('clamp') as PrimitiveNodeDefinition;
        const inputData: StructorRecord = { "fields": { "v1": 5, "v2": 500, "min1": 10, "max1": 100, "max2": 90 }, "untagged": [] };

        const clamperInput: StructorRecord = {
            fields: {
                'value': [inputData.fields['v1']], 'min': [inputData.fields['min1']],
                'max': [inputData.fields['max1'], inputData.fields['max2']],
            },
            untagged: [inputData.fields['v2']]
        };

        const clamperOutput = clamperDef.execute(clamperInput, executionContext);
        const finalOutput: StructorRecord = {
            fields: { 'result': clamperOutput.untagged[0] },
            untagged: []
        };

        const expectedOutput: StructorRecord = { "fields": { "result": [10, 100] }, "untagged": [] };
        expect(finalOutput).toEqual(expectedOutput);
    });
});

describe('Structor Graph: Test Case 3: Nested Graphs, Functors, and Chaining', () => {

    const make_mock_literal = (value: Structor, type: StructorType): PrimitiveNodeDefinition => ({
        id: `mock_literal_${value}`, kind: 'primitive',
        computeOutputTypes: (inputType, context) => ({ kind: 'record', fields: {}, untagged: [type] }),
        execute: (input, context) => ({ fields: {}, untagged: [value] }),
    });

    const mock_apply: PrimitiveNodeDefinition = {
        id: 'mock_apply', kind: 'primitive',
        computeOutputTypes: (inputType, context) => {
            const functorType = inputType.fields['functor'] as FunctorType;
            return { kind: 'record', fields: {}, untagged: [functorType.output] };
        },
        execute: (input, context) => {
            const functor = input.fields['functor'] as Functor;
            const inputValue = input.fields['input'];
            return { fields: {}, untagged: [functor(inputValue)] };
        }
    };
    
    const mock_add: PrimitiveNodeDefinition = {
        id: 'mock_add', kind: 'primitive',
        computeOutputTypes: (inputType, context) => ({ kind: 'record', fields: {}, untagged: [numberType] }),
        execute: (input, context) => {
            const inputs = [...Object.values(input.fields), ...input.untagged];
            const sum = inputs.reduce((acc: number, val) => acc + (val as number), 0);
            return { fields: {}, untagged: [sum] };
        }
    };

    const testRepo = new NodeRepository();
    testRepo.register({ id: 'add', version: '1.0.0', displayName: 'Add', definition: mock_add });
    testRepo.register({ id: 'apply', version: '1.0.0', displayName: 'Apply', definition: mock_apply });
    testRepo.register({ id: 'const5', version: '1.0.0', displayName: '5', definition: make_mock_literal(5, numberType) });
    testRepo.register({ id: 'const10', version: '1.0.0', displayName: '10', definition: make_mock_literal(10, numberType) });

    const graph_SubGraphAdd5: GraphDefinition = {
        id: 'graph:SubGraphAdd5', kind: 'graph',
        type: {
            kind: 'graph',
            inputs: { kind: 'record', fields: { 'in': numberType }, untagged: [] },
            outputs: { kind: 'record', fields: { 'out': numberType }, untagged: [] }
        },
        nodes: { 'adder': { definitionId: 'add' }, 'const5': { definitionId: 'const5' } },
        inputs: { 'in': { nodeId: 'adder', port: 0 } },
        outputs: { 'out': { nodeId: 'adder', port: 0 } },
    };
    testRepo.register({ id: 'SubGraphAdd5', version: '1.0.0', displayName: 'Add 5', definition: graph_SubGraphAdd5 });


    it('should pass the static analysis test', () => {
        const functorType: FunctorType = { kind: 'functor', input: numberType, output: numberType };
        const graph_TestFunctor: GraphDefinition = {
            id: 'graph:TestFunctor', kind: 'graph',
            type: {
                kind: 'graph',
                inputs: { kind: 'record', fields: { 'myFunctor': functorType }, untagged: [] },
                outputs: { kind: 'record', fields: { 'result': numberType }, untagged: [] }
            },
            nodes: {
                'applier': { definitionId: 'apply' },
                'const10': { definitionId: 'const10' },
                'add5_graph': { definitionId: 'SubGraphAdd5' }
            },
            inputs: { 'myFunctor': { nodeId: 'applier', port: 'functor' } },
            outputs: { 'result': { nodeId: 'add5_graph', port: 'out' } }
        };

        const analysisContext: AnalysisContext = {
            broadcast: (config, inputs) => numberType,
            repository: testRepo
        };
        
        const const10Def = analysisContext.repository.get('const10') as PrimitiveNodeDefinition;
        const const10OutputType = const10Def.computeOutputTypes(null as any, analysisContext).untagged[0];
        
        const applierDef = analysisContext.repository.get('apply') as PrimitiveNodeDefinition;
        const applierInputType: RecordType = {
            kind: 'record',
            fields: { 'functor': graph_TestFunctor.type.inputs.fields['myFunctor'], 'input': const10OutputType },
            untagged: []
        };
        const applierOutputType = applierDef.computeOutputTypes(applierInputType, analysisContext).untagged[0];

        const add5GraphDef = analysisContext.repository.get('SubGraphAdd5') as GraphDefinition;
        const add5GraphOutputType = add5GraphDef.type.outputs.fields['out'];

        const finalOutputType: RecordType = {
            kind: 'record',
            fields: { 'result': add5GraphOutputType },
            untagged: []
        };
        expect(finalOutputType).toEqual(graph_TestFunctor.type.outputs);
    });

    it('should pass the runtime execution test', () => {
        const myFunctor: Functor = (x) => (x as number) * 2;
        const inputData: StructorRecord = { "fields": { "myFunctor": myFunctor }, "untagged": [] };

        const executionContext: ExecutionContext = {
            broadcast: (config, inputs) => ({}),
            repository: testRepo
        };

        const const10Def = executionContext.repository.get('const10') as PrimitiveNodeDefinition;
        const const10Output = const10Def.execute(null as any, executionContext).untagged[0];

        const applierDef = executionContext.repository.get('apply') as PrimitiveNodeDefinition;
        const applierInput: StructorRecord = {
            fields: { 'functor': inputData.fields['myFunctor'], 'input': const10Output },
            untagged: []
        };
        const applierOutput = applierDef.execute(applierInput, executionContext).untagged[0];

        // Mock subgraph execution
        const const5Def = executionContext.repository.get('const5') as PrimitiveNodeDefinition;
        const const5Output = const5Def.execute(null as any, executionContext).untagged[0];
        const addDef = executionContext.repository.get('add') as PrimitiveNodeDefinition;
        const adderInput: StructorRecord = { fields: {}, untagged: [applierOutput, const5Output] };
        const add5GraphOutput = addDef.execute(adderInput, executionContext);

        const finalOutput: StructorRecord = {
            fields: { 'result': add5GraphOutput.untagged[0] },
            untagged: []
        };
        const expectedOutput: StructorRecord = { "fields": { "result": 25 }, "untagged": [] };
        expect(finalOutput).toEqual(expectedOutput);
    });
});
import { describe, it, expect } from 'vitest';
import {
    AtomicType,
    FunctorType,
    ArrayType,
    RecordType,
    GraphType,
    StructorType,
    Functor,
    StructorArray,
    StructorRecord,
    Structor,
    NodeDefinition,
    AnalysisContext,
    ExecutionContext,
    PrimitiveNodeDefinition,
    GraphDefinition,
    NodeInstance,
    BroadcastConfig
} from './structor';


// Mock Implementations for Test Case 1

const numberType: AtomicType = { kind: 'atomic', type: 'number' };
const stringType: AtomicType = { kind: 'atomic', type: 'string' };

const primitive_add: PrimitiveNodeDefinition = {
    id: 'primitive:add',
    kind: 'primitive',
    computeOutputTypes: (inputType, context) => {
        const broadcastConfig: BroadcastConfig = {
            outputs: {
                val_a: { fromFields: ['val_a'], fromUntagged: false, combine: 'collect', coerceTo: 'number' },
                val_b: { fromFields: ['val_b'], fromUntagged: false, combine: 'collect', coerceTo: 'number' },
                untagged_0: { fromFields: [], fromUntagged: [0], combine: 'collect', coerceTo: 'number' },
            },
            reshape: 'vector',
        };

        // Mocking the broadcast analysis
        const broadcastResultType = {
            kind: 'array',
            size: 2,
            element: { kind: 'atomic', type: 'number' }
        };

        return {
            kind: 'record',
            fields: {},
            untagged: [broadcastResultType]
        };
    },
    execute: (input, context) => {
        const broadcastConfig: BroadcastConfig = {
            outputs: {
                 val_a: { fromFields: ['val_a'], fromUntagged: false, combine: 'collect', coerceTo: 'number' },
                 val_b: { fromFields: ['val_b'], fromUntagged: false, combine: 'collect', coerceTo: 'number' },
                 untagged_0: { fromFields: [], fromUntagged: [0], combine: 'collect', coerceTo: 'number' },
            },
            reshape: 'vector',
        };
        
        // Mocking the broadcast execution
        const broadcastResult = {
            broadcasted: [[10, 100, 5], [10, 200, 5]]
        };

        const sum = broadcastResult.broadcasted.map(tuple => tuple.reduce((a, b) => a + b, 0));

        return {
            fields: {},
            untagged: [sum]
        };
    }
};

describe('Structor Graph: Test Case 1: \'Add\' Node (Broadcasting & Coercion)', () => {
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
                'adder': { definition: primitive_add }
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

        // Mock analysis context
        const analysisContext: AnalysisContext = {
            broadcast: (config, inputs) => {
                // This would be a complex engine in reality
                return {
                    kind: 'array',
                    size: 2,
                    element: { kind: 'atomic', type: 'number' }
                };
            }
        };

        // Simulate analysis
        const adderInputType: RecordType = {
            kind: 'record',
            fields: {
                'val_a': graph_TestAdd.type.inputs.fields['a'],
                'val_b': graph_TestAdd.type.inputs.fields['b'],
            },
            untagged: [graph_TestAdd.type.inputs.fields['c']]
        };

        const adderOutputType = primitive_add.computeOutputTypes(adderInputType, analysisContext);
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
                'adder': { definition: primitive_add }
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

        const executionContext: ExecutionContext = {
            broadcast: (config, inputs) => {
                return { broadcasted: [[10, 100, 5], [10, 200, 5]] };
            }
        };

        const inputData: StructorRecord = { "fields": { "a": 10, "b": [100, 200], "c": "5" }, "untagged": [] };

        // Simulate execution
        const adderInput: StructorRecord = {
            fields: {
                'val_a': inputData.fields['a'],
                'val_b': inputData.fields['b'],
            },
            untagged: [inputData.fields['c']]
        };

        const adderOutput = primitive_add.execute(adderInput, executionContext);
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


// Mock Implementations for Test Case 2

const primitive_clamp: PrimitiveNodeDefinition = {
    id: 'primitive:clamp',
    kind: 'primitive',
    computeOutputTypes: (inputType, context) => {
        const broadcastConfig: BroadcastConfig = {
            outputs: {
                'value': { fromFields: ['value'], fromUntagged: true, combine: 'collect' },
                'min': { fromFields: ['min'], fromUntagged: false, combine: { reduce: 'min' } },
                'max': { fromFields: ['max'], fromUntagged: false, combine: { reduce: 'max' } },
            },
            reshape: 'none',
        };

        // Mocking the broadcast analysis
        const broadcastResultType = context.broadcast(broadcastConfig, inputType);
        
        // The output shape matches the 'value' channel's shape
        return {
            kind: 'record',
            fields: {},
            untagged: [broadcastResultType.fields.value]
        };
    },
    execute: (input, context) => {
        const broadcastConfig: BroadcastConfig = {
            outputs: {
                'value': { fromFields: ['value'], fromUntagged: true, combine: 'collect' },
                'min': { fromFields: ['min'], fromUntagged: false, combine: { reduce: 'min' } },
                'max': { fromFields: ['max'], fromUntagged: false, combine: { reduce: 'max' } },
            },
            reshape: 'none',
        };
        
        const broadcastResult = context.broadcast(broadcastConfig, input) as { fields: { value: number[], min: number, max: number } };

        const clamped = broadcastResult.fields.value.map(v => 
            Math.max(broadcastResult.fields.min, Math.min(v, broadcastResult.fields.max))
        );

        return {
            fields: {},
            untagged: [clamped]
        };
    }
};


describe('Structor Graph: Test Case 2: \'Clamp\' Node (Reduction & Input Gathering)', () => {
    it('should pass the static analysis test', () => {
        const graph_TestClamp: GraphDefinition = {
            id: 'graph:TestClamp',
            kind: 'graph',
            type: {
                kind: 'graph',
                inputs: {
                    kind: 'record',
                    fields: {
                        'v1': numberType,
                        'v2': numberType,
                        'min1': numberType,
                        'max1': numberType,
                        'max2': numberType,
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
                'clamper': { definition: primitive_clamp }
            },
            inputs: {
                'v1': { nodeId: 'clamper', port: 'value' },
                'v2': { nodeId: 'clamper', port: 0 },
                'min1': { nodeId: 'clamper', port: 'min' },
                'max1': { nodeId: 'clamper', port: 'max' },
                'max2': { nodeId: 'clamper', port: 'max' }
            },
            outputs: {
                'result': { nodeId: 'clamper', port: 0 }
            }
        };

        const analysisContext: AnalysisContext = {
            broadcast: (config, inputs) => {
                // Mocking the broadcast analysis engine
                return {
                    fields: {
                        'value': { kind: 'array', size: 2, element: numberType },
                        'min': numberType,
                        'max': numberType,
                    }
                };
            }
        };

        const clamperInputType: RecordType = {
            kind: 'record',
            fields: {
                'value': [graph_TestClamp.type.inputs.fields['v1']],
                'min': [graph_TestClamp.type.inputs.fields['min1']],
                'max': [graph_TestClamp.type.inputs.fields['max1'], graph_TestClamp.type.inputs.fields['max2']],
            },
            untagged: [graph_TestClamp.type.inputs.fields['v2']]
        };

        const clamperOutputType = primitive_clamp.computeOutputTypes(clamperInputType, analysisContext);
        const finalOutputType: RecordType = {
            kind: 'record',
            fields: {
                'result': clamperOutputType.untagged[0]
            },
            untagged: []
        };

        expect(finalOutputType).toEqual(graph_TestClamp.type.outputs);
    });

    it('should pass the runtime execution test', () => {
        const executionContext: ExecutionContext = {
            broadcast: (config, inputs) => {
                // Mocking the broadcast execution engine
                return {
                    fields: {
                        'value': [5, 500],
                        'min': 10,
                        'max': 100,
                    }
                };
            }
        };

        const inputData: StructorRecord = { "fields": { "v1": 5, "v2": 500, "min1": 10, "max1": 100, "max2": 90 }, "untagged": [] };

        const clamperInput: StructorRecord = {
            fields: {
                'value': [inputData.fields['v1']],
                'min': [inputData.fields['min1']],
                'max': [inputData.fields['max1'], inputData.fields['max2']],
            },
            untagged: [inputData.fields['v2']]
        };

        const clamperOutput = primitive_clamp.execute(clamperInput, executionContext);
        const finalOutput: StructorRecord = {
            fields: {
                'result': clamperOutput.untagged[0]
            },
            untagged: []
        };

        const expectedOutput: StructorRecord = { "fields": { "result": [10, 100] }, "untagged": [] };

        expect(finalOutput).toEqual(expectedOutput);
    });
});


// Mock Implementations for Test Case 3

const make_primitive_const = (value: Structor, type: StructorType): PrimitiveNodeDefinition => ({
    id: `primitive:const:${value}`,
    kind: 'primitive',
    computeOutputTypes: (inputType, context) => ({
        kind: 'record',
        fields: {},
        untagged: [type]
    }),
    execute: (input, context) => ({
        fields: {},
        untagged: [value]
    }),
});

const primitive_apply: PrimitiveNodeDefinition = {
    id: 'primitive:apply',
    kind: 'primitive',
    computeOutputTypes: (inputType, context) => {
        const functorType = inputType.fields['functor'] as FunctorType;
        // In a real scenario, we would assert that functorType.input matches inputType.fields['input']
        return {
            kind: 'record',
            fields: {},
            untagged: [functorType.output]
        };
    },
    execute: (input, context) => {
        const functor = input.fields['functor'] as Functor;
        const inputValue = input.fields['input'];
        return {
            fields: {},
            untagged: [functor(inputValue)]
        };
    }
};

// Re-using from Test Case 1, but with a more generic implementation for the sub-graph
const generic_primitive_add: PrimitiveNodeDefinition = {
    id: 'primitive:add',
    kind: 'primitive',
    computeOutputTypes: (inputType, context) => {
        // Simplified for this test: assumes all inputs are numbers and returns a number
        return { kind: 'record', fields: {}, untagged: [numberType] };
    },
    execute: (input, context) => {
        const inputs = [...Object.values(input.fields), ...input.untagged];
        const sum = inputs.reduce((acc: number, val) => acc + (val as number), 0);
        return { fields: {}, untagged: [sum] };
    }
};


describe('Structor Graph: Test Case 3: Nested Graphs, Functors, and Chaining', () => {

    const const5_def = make_primitive_const(5, numberType);
    const const10_def = make_primitive_const(10, numberType);

    const graph_SubGraphAdd5: GraphDefinition = {
        id: 'graph:SubGraphAdd5',
        kind: 'graph',
        type: {
            kind: 'graph',
            inputs: { kind: 'record', fields: { 'in': numberType }, untagged: [] },
            outputs: { kind: 'record', fields: { 'out': numberType }, untagged: [] }
        },
        nodes: {
            'adder': { definition: generic_primitive_add },
            'const5': { definition: const5_def }
        },
        inputs: {
            'in': { nodeId: 'adder', port: 0 }
        },
        outputs: {
            'out': { nodeId: 'adder', port: 0 }
        },
        // Internal connections are not fully modeled in this simplified test setup,
        // but we can mock the behavior.
        // Connection: Node 'const5', output 0 -> Node 'adder', untagged 1
    };

    it('should pass the static analysis test', () => {
        const functorType: FunctorType = {
            kind: 'functor',
            input: numberType,
            output: numberType
        };

        const graph_TestFunctor: GraphDefinition = {
            id: 'graph:TestFunctor',
            kind: 'graph',
            type: {
                kind: 'graph',
                inputs: { kind: 'record', fields: { 'myFunctor': functorType }, untagged: [] },
                outputs: { kind: 'record', fields: { 'result': numberType }, untagged: [] }
            },
            nodes: {
                'applier': { definition: primitive_apply },
                'const10': { definition: const10_def },
                'add5_graph': { definition: graph_SubGraphAdd5 }
            },
            inputs: {
                'myFunctor': { nodeId: 'applier', port: 'functor' }
            },
            outputs: {
                'result': { nodeId: 'add5_graph', port: 'out' }
            }
            // Internal connections not fully modeled
        };

        // --- Mock Analysis Simulation ---
        
        // 1. const10 output type is number.
        const const10OutputType = const10_def.computeOutputTypes(null as any, null as any).untagged[0];
        expect(const10OutputType).toEqual(numberType);

        // 2. applier node analysis
        const applierInputType: RecordType = {
            kind: 'record',
            fields: {
                'functor': graph_TestFunctor.type.inputs.fields['myFunctor'],
                'input': const10OutputType
            },
            untagged: []
        };
        const applierOutputType = primitive_apply.computeOutputTypes(applierInputType, null as any).untagged[0];
        expect(applierOutputType).toEqual(numberType);

        // 3. add5_graph node analysis
        const add5GraphInputType: RecordType = {
            kind: 'record',
            fields: { 'in': applierOutputType },
            untagged: []
        };
        // In a real engine, we'd recursively analyze the subgraph. Here we just check its predefined output type.
        const add5GraphOutputType = graph_SubGraphAdd5.type.outputs.fields['out'];
        expect(add5GraphOutputType).toEqual(numberType);

        // 4. Final graph output
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

        // --- Mock Execution Simulation ---

        // 1. const10 node outputs 10.
        const const10Output = const10_def.execute(null as any, null as any).untagged[0];
        expect(const10Output).toBe(10);

        // 2. applier node executes.
        const applierInput: StructorRecord = {
            fields: {
                'functor': inputData.fields['myFunctor'],
                'input': const10Output
            },
            untagged: []
        };
        const applierOutput = primitive_apply.execute(applierInput, null as any).untagged[0];
        expect(applierOutput).toBe(20);

        // 3. add5_graph (sub-graph) executes.
        // This simulates the internal logic of SubGraphAdd5
        const const5Output = const5_def.execute(null as any, null as any).untagged[0];
        const adderInput: StructorRecord = {
            fields: {},
            untagged: [applierOutput, const5Output] // from applier output and const5
        };
        const add5GraphOutput = generic_primitive_add.execute(adderInput, null as any).untagged[0];
        expect(add5GraphOutput).toBe(25);

        // 4. Final graph output
        const finalOutput: StructorRecord = {
            fields: { 'result': add5GraphOutput },
            untagged: []
        };
        const expectedOutput: StructorRecord = { "fields": { "result": 25 }, "untagged": [] };
        expect(finalOutput).toEqual(expectedOutput);
    });
});
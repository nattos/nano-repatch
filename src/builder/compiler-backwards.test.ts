
import { expect } from '@open-wc/testing';
import { describe, it, beforeEach } from 'vitest';
import { compileGraph } from './compiler';
import { AppState, GraphState } from './state';
import { NodeRepository, NodeType } from '../structor/repository';
import { definePrimitiveNode, defineType } from '../structor/type-helpers';
import { anyType, numberType } from '../structor/std-types';
import { AnalysisContext, NodeCategory, PrimitiveNodeDefinition, StructorType } from '../structor/structor';

// --- Mocks ---

const float3Type = defineType({
    kind: 'record',
    fields: { x: numberType, y: numberType, z: numberType },
    hint: 'float3'
});

const packNodeDef: PrimitiveNodeDefinition = {
    id: 'test.pack',
    kind: 'primitive',
    metadata: { category: NodeCategory.Core },
    configType: { kind: 'record', fields: { targetType: { kind: 'atomic', type: 'string' } } },

    // BACKWARD PASS: Infer input requirements from output requirements
    computeBackwardPorts: (outputReqs, config) => {
        const targetType = (config as any)?.targetType || 'infer';

        let inferredType: 'float2' | 'float3' | 'float4' | null = null;

        if (targetType === 'infer') {
            // Look at output requirements
            // Downstream expects something from our 'result' port
            const resultReq = outputReqs.fields['result'];

            if (resultReq) {
                // Check if the required type looks like a float3 (has x, y, z)
                if (resultReq.kind === 'record') {
                    if (resultReq.fields['x'] && resultReq.fields['y'] && resultReq.fields['z']) {
                        inferredType = 'float3';
                    } else if (resultReq.fields['x'] && resultReq.fields['y']) {
                        inferredType = 'float2';
                    }
                }
                // Or if it IS the float3 type (by reference or hint)
                // For this test, we look at structure
            }
        } else {
            inferredType = targetType as any;
        }

        const inputReqs: any = { kind: 'record', fields: {} };
        if (inferredType === 'float3') {
            inputReqs.fields = { x: numberType, y: numberType, z: numberType };
        } else if (inferredType === 'float2') {
            inputReqs.fields = { x: numberType, y: numberType };
        }

        return {
            inputRequirements: inputReqs,
            backwardMetadata: { inferredType }
        };
    },

    // FORWARD PASS: Generate final inputs/outputs
    computeForwardPorts: (inputs, config, context, meta) => {
        const type = meta?.inferredType || 'float2'; // Default to float2 if nothing known

        const outputFields: any = {};
        if (type === 'float3') {
            outputFields['result'] = float3Type;
        } else {
            outputFields['result'] = { kind: 'record', fields: { x: numberType, y: numberType }, hint: 'float2' };
        }

        // Inputs are what we decided we needed
        const inputFields: any = {};
        if (type === 'float3') {
            inputFields['x'] = numberType;
            inputFields['y'] = numberType;
            inputFields['z'] = numberType;
        } else {
            inputFields['x'] = numberType;
            inputFields['y'] = numberType;
        }

        return {
            inputs: { kind: 'record', fields: inputFields },
            outputs: { kind: 'record', fields: outputFields }
        };
    },

    // Legacy fallback (should not be called if new methods exist)
    computeOutputTypes: () => ({ kind: 'record', fields: {} }),

    execute: () => ({})
};

const sinkNodeDef: PrimitiveNodeDefinition = {
    id: 'test.sink',
    kind: 'primitive',
    metadata: { category: NodeCategory.Debug },
    inputs: {
        val: float3Type // Explicitly requires float3
    },
    computeOutputTypes: () => ({ kind: 'record', fields: {} }),
    execute: () => ({})
};

describe('Compiler Two-Phase Pass', () => {
    let repo: NodeRepository;

    beforeEach(() => {
        repo = new NodeRepository();
        repo.register({ id: 'test.pack', version: '1.0.0', displayName: 'Pack', definition: packNodeDef });
        repo.register({ id: 'test.sink', version: '1.0.0', displayName: 'Sink', definition: sinkNodeDef });
    });

    it('Propagates requirements backwards (Pack infers Float3 from Sink)', async () => {
        const appState: AppState = {
            graph: {
                inner: {
                    nodes: {
                        'n1': { id: 'n1', x: 0, y: 0, config: { typeId: 'test.pack', values: {} } },
                        'n2': { id: 'n2', x: 0, y: 0, config: { typeId: 'test.sink', values: {} } }
                    },
                    connections: {
                        'c1': { id: 'c1', fromNodeId: 'n1', fromPort: 'result', toNodeId: 'n2', toPort: 'val' }
                    }
                },
                auxiliary: { incomingConnections: new Map(), outgoingConnections: new Map() }
            }
        };

        const { graph: result, inferredTypes } = compileGraph(appState, new Map(), repo);

        const packTypes = inferredTypes['n1'];
        expect(packTypes).to.exist;

        // Check Inputs: Should have inferred x, y, z because Sink requires float3
        const inputs = packTypes.inputs as any;
        expect(inputs.fields['x']).to.exist;
        expect(inputs.fields['y']).to.exist;
        expect(inputs.fields['z']).to.exist;

        // Check Outputs
        const outputs = packTypes.outputs as any;
        expect(outputs.fields['result']).to.exist; // And it should be compatible with float3
    });
});

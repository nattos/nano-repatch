
import { expect } from '@open-wc/testing';
import { compileGraph } from './compiler';
import { AppState, GraphState } from './state';
import { NodeRepository, NodeType } from '../structor/repository';
import { definePrimitiveNode, defineType } from '../structor/type-helpers';
import { anyType, numberType } from '../structor/std-types';
import { AnalysisContext, NodeCategory, PrimitiveNodeDefinition, StructorType } from '../structor/structor';

// --- Mocks ---

const vec3Type = defineType({
    kind: 'record',
    fields: { x: numberType, y: numberType, z: numberType },
    hint: 'vec3'
});

const packNodeDef: PrimitiveNodeDefinition = {
    id: 'test.pack',
    kind: 'primitive',
    metadata: { category: NodeCategory.Core },
    configType: { kind: 'record', fields: { targetType: { kind: 'atomic', type: 'string' } } },

    // BACKWARD PASS: Infer input requirements from output requirements
    computeBackwardPorts: (outputReqs, config) => {
        const targetType = (config as any)?.targetType || 'infer';

        let inferredType: 'vec2' | 'vec3' | 'vec4' | null = null;

        if (targetType === 'infer') {
             // Look at output requirements
             // Downstream expects something from our 'result' port
             const resultReq = outputReqs.fields['result'];

             if (resultReq) {
                 // Check if the required type looks like a vec3 (has x, y, z)
                 if (resultReq.kind === 'record') {
                      if (resultReq.fields['x'] && resultReq.fields['y'] && resultReq.fields['z']) {
                           inferredType = 'vec3';
                      } else if (resultReq.fields['x'] && resultReq.fields['y']) {
                           inferredType = 'vec2';
                      }
                 }
                 // Or if it IS the vec3 type (by reference or hint)
                 // For this test, we look at structure
             }
        } else {
             inferredType = targetType as any;
        }

        const inputReqs: any = { kind: 'record', fields: {} };
        if (inferredType === 'vec3') {
            inputReqs.fields = { x: numberType, y: numberType, z: numberType };
        } else if (inferredType === 'vec2') {
             inputReqs.fields = { x: numberType, y: numberType };
        }

        return {
            inputRequirements: inputReqs,
            backwardMetadata: { inferredType }
        };
    },

    // FORWARD PASS: Generate final inputs/outputs
    computeForwardPorts: (inputs, config, context, meta) => {
        const type = meta?.inferredType || 'vec2'; // Default to vec2 if nothing known

        const outputFields: any = {};
        if (type === 'vec3') {
             outputFields['result'] = vec3Type;
        } else {
             outputFields['result'] = { kind: 'record', fields: { x: numberType, y: numberType }, hint: 'vec2' };
        }

        // Inputs are what we decided we needed
        const inputFields: any = {};
        if (type === 'vec3') {
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
        val: vec3Type // Explicitly requires vec3
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

    it('Propagates requirements backwards (Pack infers Vec3 from Sink)', async () => {
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

        const result = compileGraph(appState, new Map(), repo);

        const packTypes = result.inferredTypes['n1'];
        expect(packTypes).to.exist;

        // Check Inputs: Should have inferred x, y, z because Sink requires vec3
        const inputs = packTypes.inputs as any;
        expect(inputs.fields['x']).to.exist;
        expect(inputs.fields['y']).to.exist;
        expect(inputs.fields['z']).to.exist;

        // Check Outputs
        const outputs = packTypes.outputs as any;
        expect(outputs.fields['result']).to.exist; // And it should be compatible with vec3
    });
});

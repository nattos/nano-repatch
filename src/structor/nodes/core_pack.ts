import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory } from '../structor';
import { anyType, numberType } from '../std-types';

export const primitive_pack = definePrimitiveNode({
  id: 'core.pack',
  metadata: { category: NodeCategory.Core, keywords: ['pack', 'record', 'struct', 'vector'], description: 'Packs inputs into a record or vector.' },
  config: {
    targetType: { kind: 'atomic', type: 'string', defaultValue: 'infer' }
  },
  inputs: {}, // Dynamic
  outputs: { result: anyType }, // Dynamic

  // UI Configuration (manually attached for now to avoid circular deps)
  // @ts-ignore
  ui: {
    inspector: {
      fields: [
        {
          type: 'tab-bar',
          label: 'Target Type',
          path: 'targetType',
          options: [
            { label: 'Infer', value: 'infer' },
            { label: 'Vec2', value: 'float2' },
            { label: 'Vec3', value: 'float3' },
            { label: 'Vec4', value: 'float4' }
          ]
        }
      ]
    }
  },

  computeBackwardPorts: (outputReqs, config, context) => {
    const targetType = (config as any)?.targetType || 'infer';
    let inferredType: 'float2' | 'float3' | 'float4' | null = null;

    if (targetType === 'infer') {
      // Look at output requirements on 'result' port
      const resultReq = outputReqs.fields['result'];

      if (resultReq && resultReq.kind === 'record') {
        if (resultReq.fields['x'] && resultReq.fields['y'] && resultReq.fields['z'] && resultReq.fields['w']) {
          inferredType = 'float4';
        } else if (resultReq.fields['x'] && resultReq.fields['y'] && resultReq.fields['z']) {
          inferredType = 'float3';
        } else if (resultReq.fields['x'] && resultReq.fields['y']) {
          inferredType = 'float2';
        }
      }
    } else {
      inferredType = targetType as any;
    }

    const inputReqs: any = { kind: 'record', fields: {} };
    if (inferredType === 'float4') {
      inputReqs.fields = { x: numberType, y: numberType, z: numberType, w: numberType };
    } else if (inferredType === 'float3') {
      inputReqs.fields = { x: numberType, y: numberType, z: numberType };
    } else if (inferredType === 'float2') {
      inputReqs.fields = { x: numberType, y: numberType };
    }

    return {
      inputRequirements: inputReqs,
      backwardMetadata: { inferredType }
    };
  },

  computeForwardPorts: (inputs, config, context, meta) => {

    // Defensive read: check both root and fields
    const rawConfig = config as any;
    const targetType = rawConfig?.targetType || rawConfig?.fields?.targetType || 'infer';

    // If explicit config is set, usage that. Otherwise use inferred.
    let type = targetType !== 'infer' ? targetType : (meta?.inferredType || 'float2');

    // Finalize inputs based on type
    const inputFields: any = {};
    const outputFields: any = {};

    // If type is not one of the vectors (e.g. unknown inference), fallback to float2?
    // Or if we have inputs connected?
    // Let's default to float2 if nothing known.
    if (!['float2', 'float3', 'float4'].includes(type)) type = 'float2';



    if (type === 'float4') {
      inputFields.x = numberType;
      inputFields.y = numberType;
      inputFields.z = numberType;
      inputFields.w = numberType;
      outputFields.result = {
        kind: 'array',
        size: 4,
        element: numberType,
        hint: 'vec4'
      };
    } else if (type === 'float3') {
      inputFields.x = numberType;
      inputFields.y = numberType;
      inputFields.z = numberType;
      outputFields.result = {
        kind: 'array',
        size: 3,
        element: numberType,
        hint: 'vec3'
      };
    } else { // float2
      inputFields.x = numberType;
      inputFields.y = numberType;
      outputFields.result = {
        kind: 'array',
        size: 2,
        element: numberType,
        hint: 'vec2'
      };
    }

    return {
      inputs: { kind: 'record', fields: inputFields },
      outputs: { kind: 'record', fields: outputFields }
    };
  },

  shouldRecompileOnConfigChange: (newConfig, oldConfig) => {
    return newConfig?.targetType !== oldConfig?.targetType;
  },

  execute: (inputs, config) => {
    // pack receives raw inputs because it has dynamic ports and no autoBroadcast
    // inputs is { fields: { x: val, y: val ... } }
    const fields = (inputs as any)?.fields || {};
    let type = (config?.targetType) || 'infer';

    if (type === 'infer') {
      if (fields.w !== undefined) type = 'float4';
      else if (fields.z !== undefined) type = 'float3';
      else if (fields.y !== undefined && fields.x !== undefined) type = 'float2';
      else type = 'record';
    }

    if (type === 'float4') {
      return { result: [fields.x ?? 0, fields.y ?? 0, fields.z ?? 0, fields.w ?? 0] };
    } else if (type === 'float3') {
      return { result: [fields.x ?? 0, fields.y ?? 0, fields.z ?? 0] };
    } else if (type === 'float2') {
      return { result: [fields.x ?? 0, fields.y ?? 0] };
    } else {
      // Generic Record Packing
      // Must return a StructorRecord structure (without kind, per test expectation)
      return { result: { fields: fields } };
    }
  }
});
registerNode({
  version: "1.0.0",
  ...primitive_pack,
  displayName: 'Pack',
  extendedOutputs: {
    result: { type: anyType, description: 'Record' }
  }
});

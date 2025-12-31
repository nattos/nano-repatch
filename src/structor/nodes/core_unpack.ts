import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, StructorType, StructorRecord } from '../structor';
import { anyType } from '../std-types';

export const primitive_unpack = definePrimitiveNode({
  id: 'core.unpack',
  metadata: { category: NodeCategory.Core, keywords: ['unpack', 'destructure', 'split'], description: 'Unpacks a record or fixed-length vector into outputs.' },
  config: {},
  inputs: { record: anyType },
  // Outputs: Dynamic based on input record type
  computeForwardPorts: (inputType, config, context) => {
    // console.log('UNPACK computeForwardPorts (350):', JSON.stringify(inputType, null, 2));
    const input = inputType.fields['record'];

    // Default outputs empty
    let outputFields: Record<string, StructorType> = {};

    if (input) {
      if (input.kind === 'record') {
        outputFields = input.fields;
      } else if (input.kind === 'array' && typeof input.size === 'number' && input.size <= 16) {
        const size = input.size;

        if (size === 2) {
          outputFields['x'] = input.element;
          outputFields['y'] = input.element;
        } else if (size === 3) {
          outputFields['x'] = input.element;
          outputFields['y'] = input.element;
          outputFields['z'] = input.element;
        } else if (size === 4) {
          outputFields['x'] = input.element;
          outputFields['y'] = input.element;
          outputFields['z'] = input.element;
          outputFields['w'] = input.element;
        } else {
          for (let i = 0; i < size; i++) {
            outputFields[i.toString()] = input.element;
          }
        }
      }
    }

    return {
      inputs: { kind: 'record', fields: { record: input || anyType } },
      outputs: { kind: 'record', fields: outputFields }
    };
  },
  outputs: {}, // Dynamic outputs
  dynamicOutputType: anyType,
  execute: (input) => {
    // Unwrapped input (from definePrimitiveNode wrapper) has keys matching inputs definition
    let record = input.record;
    if (!record) return {};

    // Standardize Input:
    // GraphExecutor (or any type inputs) might wrap single objects in an array.
    // If it's a single-element array containing a Record/Object, unwrap it first.
    if (Array.isArray(record) && record.length === 1 && typeof record[0] === 'object' && record[0] !== null) {
      const item = record[0];
      // Check if it's a candidate for unpacking (has keys)
      if ('x' in item || 'fields' in item || Object.keys(item).length > 0) {
        record = item;
      }
    }

    // PATH 1: Array (Vector [x, y, z...])
    if (Array.isArray(record)) {
      const size = record.length;
      const fields: Record<string, any> = {};

      if (size === 2) {
        fields['x'] = record[0];
        fields['y'] = record[1];
      } else if (size === 3) {
        fields['x'] = record[0];
        fields['y'] = record[1];
        fields['z'] = record[2];
      } else if (size === 4) {
        fields['x'] = record[0];
        fields['y'] = record[1];
        fields['z'] = record[2];
        fields['w'] = record[3];
      } else {
        for (let i = 0; i < size; i++) {
          if (i < 16) fields[i.toString()] = record[i];
        }
      }
      return fields;
    }

    // PATH 2: Record (Structor Record or Plain Object)
    if (typeof record === 'object' && record !== null) {
      if ('fields' in record) {
        // Return fields map directly for wrapping
        return record.fields;
      }
      // Plain object -> return as is for wrapping
      return record;
    }

    return {};
  }
});
registerNode({
  version: "1.0.0",
  ...primitive_unpack,
  displayName: 'Unpack',
  extendedInputs: {
    record: { type: anyType, description: 'Record to unpack' }
  }
});

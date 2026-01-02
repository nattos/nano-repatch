import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, StructorType } from '../structor';
import { anyType, numberType } from '../std-types';

// Helper for "all" nodes
const defineAllNode = (
  id: string,
  displayName: string,
  op: (a: number, b: number) => number,
  category: NodeCategory = NodeCategory.Math
) => {
  const def = definePrimitiveNode({
    id,
    metadata: { category, description: `Apply ${id.split('.').pop()} to all inputs.` },
    // Allow multi-connection to collect multiple inputs into an array
    inputs: { values: { kind: 'array', element: anyType, size: 'dynamic', allowMultiConnection: true } },
    outputs: { result: numberType }, // Output is dynamic (scalar or vector)
    computeForwardPorts: (inputTypes, config, context) => {
      const valuesInput = inputTypes.fields['values'];
      let outputType: StructorType = numberType;

      // Check if we have an array of inputs (because of reduce/collect)
      if (valuesInput && valuesInput.kind === 'array') {
        // The element of the 'values' array represents the types of the connected cables.
        const elementType = valuesInput.element;

        if (elementType.kind === 'array') {
          // Collection of Arrays (e.g. [Array<Number>])
          outputType = elementType;
        } else if (elementType.kind === 'record') {
          // Collection of Records (e.g. [{x,y,z,w}])
          // Propagate the record type!
          outputType = elementType;
        }
      }

      return {
        inputs: { kind: 'record', fields: { values: valuesInput } },
        outputs: { kind: 'record', fields: { result: outputType } }
      };
    },
    execute: (inputs) => {
      const values = inputs.values as any[];
      if (!values || values.length === 0) return { result: 0 };

      // Check if first element is array or Record Vector
      const first = values[0];
      const firstIsArray = Array.isArray(first);
      let firstIsRecordVec = false;
      let vecKeys: string[] = [];

      if (!firstIsArray && typeof first === 'object' && first !== null) {
        if (typeof first.x === 'number' && typeof first.y === 'number') {
          firstIsRecordVec = true;
          vecKeys = ['x', 'y'];
          if (typeof first.z === 'number') vecKeys.push('z');
          if (typeof first.w === 'number') vecKeys.push('w');
        }
      }

      if (firstIsArray || firstIsRecordVec || typeof first === 'number') {
        // Vector mode (Scalar is treated as 1D vector)
        const length = firstIsArray ? first.length : (firstIsRecordVec ? vecKeys.length : 1);
        const result = new Array(length);

        for (let i = 0; i < length; i++) {
          // Extract accumulator (first value)
          let val = firstIsArray ? first[i] : (firstIsRecordVec ? first[vecKeys[i]] : first);


          for (let j = 1; j < values.length; j++) {
            const rawOperand = values[j];
            let operand: number;

            // Handle mixed types by broadcasting or extracting
            if (Array.isArray(rawOperand)) {
              operand = rawOperand[i] ?? 0; // Fallback? or NaN
            } else if (typeof rawOperand === 'object' && rawOperand !== null && 'x' in rawOperand) {
              // Assuming compatible record
              // The following lines are from the user's instruction.
              // Note: `config` and `input` are not directly available in this scope
              // as they are in the `computeForwardPorts` method or a different node's `execute` method.
              // Inserting them as requested, but they will likely cause runtime errors due to undefined variables.
              // If the intent was to log something specific to this context, please provide the correct variables.
              // const fields = (config as StructorRecord)?.fields; // `config` is not defined here
              // const portName = (fields?.name as string) ?? 'value'; // `fields` is not defined here
              // console.log(`DEBUG: io.input execute portName=${portName} inputKeys=${Object.keys(input.fields)}`); // `input` is `inputs` here, and `inputs.fields` is not the correct structure.

              // Fallback? If fields is undefined, it means config was raw and uncompiled/unnormalized. fallback?
              const key = vecKeys[i];
              operand = (rawOperand as any)[key];
              if (operand === undefined) operand = 0; // Safe fallback?
            } else {
              // Scalar broadcast
              operand = rawOperand as number;
            }

            val = op(val, operand);
          }
          result[i] = val;
        }

        if (firstIsRecordVec) {
          const resRecord: any = {};
          vecKeys.forEach((k, i) => resRecord[k] = result[i]);
          return { result: resRecord };
        } else if (!firstIsArray) {
          // Scalar input -> Scalar output
          return { result: result[0] };
        }

        return { result };
      } else {
        // General fallback for mixed types starting with scalar that wasn't caught above?
        // The implementation above handles scalar first element as length 1 vector loop.
        // If we reached here, first is weird.
        return { result: 0 };
      }
    }
  });

  registerNode({
    version: "1.0.0",
    ...def,
    displayName,
    extendedInputs: {
      values: {
        type: { kind: 'array', element: numberType, size: 'dynamic' },
        description: 'Values to process.',
        suppressInputEditor: true,
        suppressLabel: true,
        allowMultiConnection: true
      }
    },
    extendedOutputs: {
      result: { type: numberType, description: 'Result' }
    }
  });

  return def;
};

export const primitive_all_add = defineAllNode('math.all.add', 'Sum All', (a, b) => a + b);

export const primitive_all_subtract = defineAllNode('math.all.subtract', 'Subtract All', (a, b) => a - b);

export const primitive_all_multiply = defineAllNode('math.all.multiply', 'Multiply All', (a, b) => a * b);

export const primitive_all_divide = defineAllNode('math.all.divide', 'Divide All', (a, b) => a / b);

export const primitive_all_pow = defineAllNode('math.all.pow', 'Power All', (a, b) => Math.pow(a, b));

export const primitive_all_min = defineAllNode('math.all.min', 'Min All', (a, b) => Math.min(a, b));

export const primitive_all_max = defineAllNode('math.all.max', 'Max All', (a, b) => Math.max(a, b));

export const primitive_all_and = defineAllNode('logic.all.and', 'AND All', (a, b) => (a && b ? 1 : 0), NodeCategory.Logic);

export const primitive_all_or = defineAllNode('logic.all.or', 'OR All', (a, b) => (a || b ? 1 : 0), NodeCategory.Logic);

export const primitive_all_xor = defineAllNode('logic.all.xor', 'XOR All', (a, b) => ((!!a !== !!b) ? 1 : 0), NodeCategory.Logic);

export const primitive_all_equals = defineAllNode('logic.all.equals', 'Equals All', (a, b) => (a === b ? 1 : 0), NodeCategory.Logic);

export const primitive_all_greater_than = defineAllNode('logic.all.greater_than', 'Greater Than All', (a, b) => (a > b ? 1 : 0), NodeCategory.Logic);

export const primitive_all_less_than = defineAllNode('logic.all.less_than', 'Less Than All', (a, b) => (a < b ? 1 : 0), NodeCategory.Logic);

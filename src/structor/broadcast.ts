import { Structor, StructorRecord, BroadcastConfig } from './structor';

export class BroadcastResult {
  constructor(
    private isScalar: boolean,
    private size: number,
    private data: Record<string, any> | Record<string, any>[]
  ) { }

  apply(lambda: (args: any) => any): any {
    if (this.isScalar) {
      return lambda(this.data);
    } else {
      return (this.data as any[]).map(args => lambda(args));
    }
  }
}

export function broadcast(config: BroadcastConfig, inputs: StructorRecord): BroadcastResult {
  // console.log('broadcast called', { config, inputs });
  if (!inputs || !inputs.fields) {
    console.error('broadcast: inputs or inputs.fields is undefined', inputs);
  }
  // 1. Collect all inputs based on config
  const collectedInputs: Record<string, any[]> = {};
  let maxVectorSize = 0;
  let hasVector = false;

  for (const [outputName, outputConfig] of Object.entries(config.outputs)) {
    const values: any[] = [];

    // Gather from named fields
    if (outputConfig.fromFields) {
      for (const fieldName of outputConfig.fromFields) {
        if (inputs.fields[fieldName] !== undefined) {
          values.push(inputs.fields[fieldName]);
        }
      }
    }



    // Combine logic
    let finalValue: any;

    if (outputConfig.combine === 'collect') {
      finalValue = values;
      for (const v of values) {
        if (Array.isArray(v)) {
          hasVector = true;
          maxVectorSize = Math.max(maxVectorSize, v.length);
        }
      }
    } else {
      // Handle reduce or default
      let reduceType = 'first';
      if (typeof outputConfig.combine === 'object' && 'reduce' in outputConfig.combine) {
        reduceType = (outputConfig.combine as any).reduce;
      }

      if (reduceType === 'first') {
        finalValue = values[0];
      } else if (reduceType === 'flatten') {
        const toFlatten = values.length > 0 && Array.isArray(values[0]) ? values[0] : values;
        if (Array.isArray(toFlatten)) {
          finalValue = toFlatten.flat(Infinity);
        } else {
          finalValue = [toFlatten];
        }
      } else {
        finalValue = values[0]; // Fallback
      }

      if (Array.isArray(finalValue)) {
        hasVector = true;
        maxVectorSize = Math.max(maxVectorSize, finalValue.length);
      }
    }

    collectedInputs[outputName] = finalValue;
  }


  // 2. Construct result
  if (!hasVector || config.reshape === 'none') {
    // Scalar case (or explicitly no reshape)
    const data: Record<string, any> = {};
    for (const [key, value] of Object.entries(collectedInputs)) {
      data[key] = value;
    }
    return new BroadcastResult(true, 1, data);
  } else {
    // Vector case
    const data: Record<string, any>[] = [];
    for (let i = 0; i < maxVectorSize; i++) {
      const item: Record<string, any> = {};
      for (const [key, value] of Object.entries(collectedInputs)) {
        // If value is an array (from collect), we need to map over it?
        // If `value` is [[1, 2], [3, 4]] (from collect).
        // We want item[key] to be [1, 3] (at i=0) and [2, 4] (at i=1).

        // Check if it's a "collected" array (list of inputs) or a "vector" array (single input that is a vector).
        // This is ambiguous! [1, 2] could be a vector of scalars, or a collected list of two scalars.
        // `broadcast` config `reshape: 'vector'` implies we treat arrays as vectors to iterate.

        // If `combine: 'collect'`, `value` IS the array we want to pass to the lambda?
        // If inputs are scalar: [1, 2]. We pass [1, 2] to lambda.
        // If inputs are vector: [[1, 2], [3, 4]]. We want to pass [1, 3] then [2, 4].

        // So we iterate over `value` (which is the list of inputs).
        // For each input `v` in `value`:
        //   If `v` is array, take `v[i]`.
        //   Else take `v`.

        // But how do we distinguish "collected list" from "single vector input"?
        // We know `combine: 'collect'` produced `value`.
        // So `value` is ALWAYS a list of inputs.
        // So we should map over it.

        // BUT, what if `combine: 'first'` produced a vector?
        // Then `value` is [1, 2]. We want `value[i]`.

        // We need to know if `value` came from 'collect' or 'first'.
        // We can check `config.outputs[key].combine`.

        const outputConfig = config.outputs[key];
        if (outputConfig.combine === 'collect') {
          // It's a list of inputs. Map each one.
          item[key] = value.map((v: any) => {
            if (Array.isArray(v)) {
              return v[i % v.length];
            } else {
              return v;
            }
          });
        } else if (Array.isArray(value)) {
          // It's a single input (which is a vector).
          item[key] = value[i % value.length];
        } else {
          // Scalar, repeat
          item[key] = value;
        }
      }
      data.push(item);
    }
    return new BroadcastResult(false, maxVectorSize, data);
  }
}

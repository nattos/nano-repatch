import { DataType, DataTypeKind, StructType, PrimitiveType, ArrayType } from './ir-types';

/**
 * Flattens a JavaScript value (Scalar, Object, Array) into a linear array of numbers (floats)
 * based on the provided DataType. Assumes std430 tight packing for f32 scalars.
 */
export function packData(val: any, type: DataType): number[] {
  const res: number[] = [];

  // Handle Primitive
  if (type.kind === DataTypeKind.Primitive) {
    if (typeof val === 'number') return [val];
    if (typeof val === 'boolean') return [val ? 1 : 0]; // WGSL bool is 1 byte but often aligned to 4?
    // WGSL spec says 'bool' in storage buffer is NOT allowed directly usually, or takes 4 bytes?
    // Actually codegen-wgsl maps boolean to 'bool'.
    // Storage buffer bool is tricky. Let's assume codegen maps Primitive 'boolean' to f32 for IO?
    // Wait, typical pattern is to explicit cast.
    // If codegen outputs `var input: Input` where Input has `bool`, that's invalid for storage buffers in some specs.
    // But let's assume f32 for now, or just emit 0/1. Float32Array will store as float.
    return [0];
  }

  // Handle Struct
  if (type.kind === DataTypeKind.Struct) {
    const s = type as StructType;
    // Fields keys must match Codegen order!
    // Codegen uses Object.keys().sort().
    const keys = Object.keys(s.fields).sort();
    for (const k of keys) {
      const fieldVal = val ? val[k] : undefined;
      // Pad if missing? Or error?
      // Test cases might pass partial inputs (optional fields).
      // If missing, push zeros based on size scan.
      res.push(...packData(fieldVal ?? 0, s.fields[k]));
    }
    return res;
  }

  // Handle Array
  if (type.kind === DataTypeKind.Array) {
    const s = type as any; // ArrayType?
    const inner = s.elementType;
    // If val is provided, iterate.
    if (Array.isArray(val)) {
      for (const item of val) {
        res.push(...packData(item, inner));
      }
    }
    // NOTE: Layout is tight packed.
    return res;
  }

  // Fallback
  return [0];
}

/**
 * Reconstructs a JavaScript Object/Array from a flat Float32Array
 * based on the provided DataType.
 */
export function unpackData(buffer: Float32Array | number[], type: DataType): any {
  // If we have an array, wrap in iterator to consume sequentially
  let stream: number[];
  if (buffer instanceof Float32Array) stream = Array.from(buffer);
  else stream = buffer;

  let ptr = 0;

  function read(t: DataType): any {
    if (t.kind === DataTypeKind.Primitive) {
      const val = stream[ptr++];
      if ((t as PrimitiveType).name === 'boolean') return val !== 0;
      return val;
    }

    if (t.kind === DataTypeKind.Struct) {
      const s = t as StructType;
      const obj: any = {};
      const keys = Object.keys(s.fields).sort();
      for (const k of keys) {
        obj[k] = read(s.fields[k]);
      }
      return obj;
    }

    if (t.kind === DataTypeKind.Array) {
      // Dynamic array unpacking is impossible without knowing length.
      // But output array length is UNKNOWN in general (unless fixed size).
      // But we can check REMAINING buffer size?
      // If strict structure: "Array<f32>" usually implies "Rest of buffer".
      // So we read until end?
      const inner = (t as any).elementType;
      const res = [];
      // This assumes the array is the LAST element or the ONLY element.
      // We'll read until stream ends?
      // Or assume fixed count if we knew it (we don't from Type).
      while (ptr < stream.length) {
        res.push(read(inner));
      }
      return res;
    }
    return 0;
  }

  return read(type);
}

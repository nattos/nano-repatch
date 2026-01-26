import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { generateWGSL } from './codegen-wgsl';
import { DataTypeKind } from './ir-types';

describe('WGSL CodeGen', () => {

  it('should generate basic compute shader', () => {
    const src = `return val * 2.0;`;
    const ir = compileToIR(src, { val: { kind: DataTypeKind.Primitive, name: 'number' } as any });
    const wgsl = generateWGSL(ir, {
      inputs: { val: { kind: DataTypeKind.Primitive, name: 'number' } as any },
      outputType: { kind: DataTypeKind.Primitive, name: 'number' } as any
    });

    console.log(wgsl);
    expect(wgsl).toContain('struct Output {');
    expect(wgsl).toContain('result: f32,');
    expect(wgsl).toContain('@compute @workgroup_size(1)');
    expect(wgsl).toContain('output.result = (input.val * 2.0);');
  });

  it('should handle loops', () => {
    const src = `
            let i = 0;
            while(i < 10) {
                i = i + 1;
            }
            return i;
         `;
    const ir = compileToIR(src, {});
    const wgsl = generateWGSL(ir, { inputs: {}, outputType: { kind: DataTypeKind.Primitive, name: 'number' } as any });
    expect(wgsl).toContain('var i : f32 = 0.0'); // defaults to f32
    expect(wgsl).toContain('while ((i < 10.0)) {');
  });

  it('should handle structs', () => {
    const src = `
            let v = { x: 1.0, y: 2.0 };
            return v.x;
         `;
    // TODO: We need to ensure Struct Ops map to WGSL struct constructors or field access?
    // codegen-wgsl.ts implementation check needed for Literal Struct construction.
    // currently "Unknown Const Object" might trigger fallback?
    const ir = compileToIR(src, {});
    const wgsl = generateWGSL(ir, { inputs: {} });
    // Expect struct def?
    // The test logic in codegen-wgsl might need updates for 'Const Struct' -> 'StructName(fields...)'
  });
});

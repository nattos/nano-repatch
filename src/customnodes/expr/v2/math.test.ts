import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { OpKind, IntrinsicNode, ConstNode } from './ir-types';

describe('Math Intrinsics & Constant Folding', () => {

  it('should fold constant math calls', () => {
    // Math.sin(0) -> 0
    // Math.max(1, 10, 5) -> 10
    // Math.pow(2, 3) -> 8
    // Math.abs(-50) -> 50
    // Sum = 68
    const CODE = `
        const s = Math.sin(0);
        const m = Math.max(1, 10, 5);
        const p = Math.pow(2, 3);
        const a = Math.abs(-50);

        s + m + p + a;
    `;

    const ir = compileToIR(CODE);
    const block = ir.root as any;
    const last = block.statements[block.statements.length - 1];

    expect(last.kind).toBe(OpKind.Const);
    expect(last.value).toBe(68);
  });

  it('should emit intrinsic nodes for runtime values', () => {
    // Future: When we have Inputs or non-constant sources
  });

  it('should handle complex math expressions', () => {
    const CODE = `
        const x = Math.abs(-1);
        const y = Math.max(x, 0);
        y;
      `;
    const ir = compileToIR(CODE);
    const block = ir.root as any;
    const last = block.statements[block.statements.length - 1];
    expect(last.value).toBe(1);
  });
});

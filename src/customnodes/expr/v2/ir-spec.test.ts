import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { OpKind, DataTypeKind, PrimitiveType, IRNode } from './ir-types';

const EX_BASIC = `
  let x = 10;
  let y = 0;
  if (x > 5) {
    y = x * 2;
  } else {
    y = x + 1;
  }
  y;
`;

describe('IR Specification (Integration)', () => {

  it('should compile basic math with constant folding (Ex 1)', () => {
    const ir = compileToIR(EX_BASIC);
    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1];

    // Constant Folding works
    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toBe(20);
  });

  it('should unroll array map/reduce (Ex 2)', () => {
    const EX_ARRAYS = `
      const data = [1, 2, 3, 4];
      const scaled = data.map(v => v * 10);
      const sum = scaled.reduce((acc, v) => acc + v, 0);
      sum;
    `;
    const ir = compileToIR(EX_ARRAYS);

    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1];

    // 10+20+30+40 = 100
    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toBe(100);
  });

  it('should handle structs and property access (Ex 3 simplified)', () => {
    const EX_STRUCTS = `
      const v1 = { x: 10, y: 20 };
      const z = v1.x + v1.y;
      z;
    `;
    const ir = compileToIR(EX_STRUCTS);

    const block = ir.root as any;
    const lastStmt = block.statements[block.statements.length - 1];

    // v1.x (10) + v1.y (20) = 30
    expect(lastStmt.kind).toBe(OpKind.Const);
    expect(lastStmt.value).toBe(30);
  });

});

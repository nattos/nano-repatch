import { describe, it, expect } from 'vitest';
import { compileToIR } from './compiler';
import { OpKind, ConstNode, BinaryNode } from './ir-types';

describe('Expr v2 Compiler', () => {
  it('should compile a numeric literal', () => {
    const ir = compileToIR('42');
    expect(ir.root.kind).toBe(OpKind.Block);
    // Usually a script is a block of statements. The last expression might be the return if we treat it as an eval.
    // For now, let's assume the compiler wraps everything in a Block.

    // Actually, simple expression statements might just produce the node ??
    // Let's settle on the IR structure: Root is always a Block/FunctionBody?
    // Let's assume compileToIR returns the BlockNode representing the script body.

    // For "42", it's an ExpressionStatement(NumericLiteral).
    // The IR might just be a ConstNode if we strip the statement container,
    // But typically we want a list of instructions.
    // Let's check the first statement.
    const block = ir.root as any;
    expect(block.kind).toBe(OpKind.Block);
    expect(block.statements.length).toBe(1);

    const stmt = block.statements[0] as ConstNode;
    expect(stmt.kind).toBe(OpKind.Const);
    expect(stmt.value).toBe(42);
  });

  it('should compile a binary expression', () => {
    const ir = compileToIR('1 + 2');
    expect(ir.root.kind).toBe(OpKind.Block);
    const stmt = (ir.root as any).statements[0] as BinaryNode;

    expect((stmt.left as ConstNode).value).toBe(1);
    expect((stmt.right as ConstNode).value).toBe(2);
  });

  it('should compile an if statement', () => {
    const code = `
      if (1) {
        2;
      } else {
        3;
      }
    `;
    const ir = compileToIR(code);
    expect(ir.root.kind).toBe(OpKind.Block);
    const ifNode = (ir.root as any).statements[0] as any; // Cast to access IfNode props dynamically or import type
    expect(ifNode.kind).toBe(OpKind.If);

    // Condition
    expect(ifNode.condition.kind).toBe(OpKind.Const);
    expect(ifNode.condition.value).toBe(1);

    // Then Block
    expect(ifNode.thenBlock.kind).toBe(OpKind.Block);
    // In our compiler, ExpressionStatement currently unwraps to the expression itself.
    // So 2; becomes ConstNode(2).
    expect(ifNode.thenBlock.statements[0].kind).toBe(OpKind.Const);
    expect((ifNode.thenBlock.statements[0] as ConstNode).value).toBe(2);

    // Else Block
    expect(ifNode.elseBlock).toBeDefined();
    expect(ifNode.elseBlock.kind).toBe(OpKind.Block);
    expect((ifNode.elseBlock.statements[0] as ConstNode).value).toBe(3);
  });

  it('should compile a return statement', () => {
    const ir = compileToIR('return 42;');
    expect(ir.root.kind).toBe(OpKind.Block);
    const stmt = (ir.root as any).statements[0] as any;
    expect(stmt.kind).toBe(OpKind.Return);
    expect(stmt.value.kind).toBe(OpKind.Const);
    expect(stmt.value.value).toBe(42);
  });
});

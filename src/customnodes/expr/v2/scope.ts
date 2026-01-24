import { IRNode, DataType, OpKind, ConstNode, PhiNode, BlockNode, ReturnNode } from './ir-types';
import * as ts from 'typescript';

// Scope Definitions
export class Scope {
  private variables = new Map<string, DataType>();
  public values = new Map<string, IRNode>();
  private functions = new Map<string, ts.FunctionDeclaration>();

  constructor(public parent: Scope | null = null, public isBranchScope: boolean = false) { }

  // Create a Branch Scope (Isolation Boundary)
  fork(): Scope {
    const child = new Scope(this, true);
    return child;
  }

  // Create a Lexical Child Scope (Nested Block)
  extend(): Scope {
    const child = new Scope(this, false);
    return child;
  }

  // Snapshot for Closures
  snapshot(): Scope {
    const copy = new Scope(null, false);
    copy.values = new Map(this.values);
    copy.variables = new Map(this.variables);
    copy.functions = new Map(this.functions);
    copy.types = new Map(this.types);
    // Types should likely be public or accessible.
    // I'll update types to be public or use accessor?
    // Actually, snapshot method is inside class, so it can access private 'types'.

    if (this.parent) {
      copy.parent = this.parent.snapshot();
    }
    return copy;
  }

  declare(name: string, type: DataType) {
    this.variables.set(name, type);
  }

  set(name: string, value: IRNode) {
    this.values.set(name, value);
  }

  declareFunction(name: string, node: ts.FunctionDeclaration) {
    if (node.body) {
      this.functions.set(name, node);
    }
  }

  // Recursive Assignment Logic
  assign(name: string, value: IRNode) {
    if (this.values.has(name)) {
      this.values.set(name, value);
      return;
    }
    if (this.parent) {
      if (this.isBranchScope) {
        this.values.set(name, value);
      } else {
        this.parent.assign(name, value);
      }
      return;
    }
    this.values.set(name, value);
  }

  resolve(name: string): DataType | undefined {
    if (this.variables.has(name)) return this.variables.get(name)!;
    if (this.parent) return this.parent.resolve(name);
    return undefined;
  }

  resolveValue(name: string): IRNode | undefined {
    if (this.values.has(name)) return this.values.get(name)!;
    if (this.parent) return this.parent.resolveValue(name);
    return undefined;
  }

  resolveFunction(name: string): ts.FunctionDeclaration | null {
    if (this.functions.has(name)) return this.functions.get(name)!;
    if (this.parent) return this.parent.resolveFunction(name);
    return null;
  }

  static merge(parent: Scope, branchA: Scope, branchB: Scope, condition: IRNode): void {
    // Logic for merging... (Must be duplicated or moved here)
    // Since this class is getting big, moving it is good.
    // Copying merge logic from compiler.ts...

    const distinctKeys = new Set([...branchA.values.keys(), ...branchB.values.keys()]);
    let nodeIdCounter = 0; // Local counter if needed? No, use external nextId?
    // Wait, 'nextId' is in compiler.ts.
    // Scope.merge creates PhiNodes. It needs nextId.
    // We can pass a closure or generator for nextId.
    // Or we define nextId in ir-types or utils?
    // Or Scope.merge doesn't generate IDs? It generates PhiNodes.

    // Refactor: Move merge logic to compiler.ts as a standalone function?
    // Or keep static method in Scope but accept idGenerator.

    // Let's defer moving `merge` and `mergeOneWay` unless necessary.
    // `Scope` class itself doesn't need them if they are static helpers using Scope public API.
    // But they modify `parent`.

    // Let's disable them here and move them to compiler.ts as separate functions to avoid dependencies?
    // `Scope` definition is enough. `merge` can be `mergeScopes(parent, a, b, cond)`.
  }
  // Type Registry
  public types = new Map<string, DataType>();

  declareType(name: string, type: DataType) {
    this.types.set(name, type);
  }

  resolveType(name: string): DataType | undefined {
    if (this.types.has(name)) return this.types.get(name);
    if (this.parent) return this.parent.resolveType(name);
    return undefined;
  }
}

export class CompilerContext {
  public scope: Scope;
  constructor() {
    this.scope = new Scope();
  }
  pushScope() {
    this.scope = this.scope.extend();
  }
  popScope() {
    if (this.scope.parent) {
      this.scope = this.scope.parent;
    }
  }
}

export function extractReturn(node: IRNode | null): IRNode | null {
  if (!node) return null;
  if (node.kind === OpKind.Return) return (node as ReturnNode).value;
  if (node.kind === OpKind.Block) {
    const block = node as BlockNode;
    if (block.statements.length > 0) return extractReturn(block.statements[block.statements.length - 1]);
  }
  return null;
}

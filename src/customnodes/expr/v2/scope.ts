import { IRNode, DataType, OpKind, ConstNode, PhiNode, BlockNode, ReturnNode, Diagnostic, DiagnosticSeverity } from './ir-types';
import * as ts from 'typescript';

// Scope Definitions
export class Scope {
  private variables = new Map<string, DataType>();
  public values = new Map<string, IRNode | undefined>();
  public aliases = new Map<string, IRNode>(); // Reference Aliases
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
    copy.aliases = new Map(this.aliases);

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
    // Invalidate alias if being reassigned
    if (this.aliases.has(name)) {
      this.aliases.delete(name);
    }

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
    if (this.values.has(name)) return this.values.get(name);
    if (this.parent) return this.parent.resolveValue(name);
    return undefined;
  }

  resolveAlias(name: string): IRNode | undefined {
    if (this.aliases.has(name)) return this.aliases.get(name);
    if (this.parent) return this.parent.resolveAlias(name);
    return undefined;
  }

  invalidateAll() {
    let current: Scope | null = this;
    while (current) {
      for (const k of current.variables.keys()) {
        this.values.set(k, undefined);
      }
      current = current.parent;
    }
  }

  resolveFunction(name: string): ts.FunctionDeclaration | null {
    if (this.functions.has(name)) return this.functions.get(name)!;
    if (this.parent) return this.parent.resolveFunction(name);
    return null;
  }

  static merge(parent: Scope, branchA: Scope, branchB: Scope, condition: IRNode): void {
    // Intentionally empty for now (logic externalized)
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
  public diagnostics: Diagnostic[] = [];
  public depth: number = 0;

  // Configurable limit
  public maxDepth: number = 500;

  // Accumulated Inputs from Var Decls
  public declaredInputs: Record<string, DataType> = {};

  constructor(public sourceFile: ts.SourceFile) {
    this.scope = new Scope();
  }

  addDiagnostic(message: string, severity: DiagnosticSeverity, node?: ts.Node | IRNode) {
    let range;
    if (node && (node as any).getStart) {
      // TS Node
      const tsNode = node as ts.Node;
      const start = this.sourceFile.getLineAndCharacterOfPosition(tsNode.getStart());
      const end = this.sourceFile.getLineAndCharacterOfPosition(tsNode.getEnd());
      range = {
        startLineNumber: start.line + 1,
        startColumn: start.character + 1,
        endLineNumber: end.line + 1,
        endColumn: end.character + 1
      };
    } else if (node && (node as any).debugInfo) {
      // IR Node (limited info)
      const line = (node as any).debugInfo.line;
      range = {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 1
      };
    }

    this.diagnostics.push({
      message,
      severity,
      source: 'compiler',
      range
    });
  }

  addError(message: string, node?: ts.Node | IRNode) {
    this.addDiagnostic(message, DiagnosticSeverity.Error, node);
  }

  addWarning(message: string, node?: ts.Node | IRNode) {
    this.addDiagnostic(message, DiagnosticSeverity.Warning, node);
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

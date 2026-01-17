import * as ts from "typescript";
import { ExecutionGraph, NodeId } from "./expr-types";

// ==========================================
// 2. The Compiler (AST -> Graph)
// ==========================================

type Handler = (node: ts.Node, ctx: CompilationContext) => NodeId;

export class CompilationContext {
  private graph: ExecutionGraph = { nodes: {}, rootId: null };
  private scope: Map<string, NodeId> = new Map();
  private nodeCounter = 0;

  constructor(private compiler: GraphCompiler) { }

  // Generates a unique ID for a new node
  createNode(op: string, inputs: NodeId[] = [], params?: any): NodeId {
    const id = `n${this.nodeCounter++}`;
    this.graph.nodes[id] = { id, op, inputs, params };
    this.graph.rootId = id; // Update root to latest operation (default behavior)
    return id;
  }

  // Resolves a variable name to a Node ID
  // If not in local scope, it assumes it is an External Input
  resolveVar(name: string): NodeId {
    if (this.scope.has(name)) {
      return this.scope.get(name)!;
    }
    // If not found locally, create an 'input' node requesting this value from outside
    return this.createNode('input', [], { key: name });
  }

  // Sets a variable in the local scope
  setVar(name: string, nodeId: NodeId) {
    this.scope.set(name, nodeId);
  }

  // Delegates to the main compiler to handle child nodes
  compileNode(node: ts.Node): NodeId {
    return this.compiler.compileNode(node, this);
  }

  getGraph(): ExecutionGraph {
    return this.graph;
  }
}

export class GraphCompiler {
  private handlers: Map<ts.SyntaxKind, Handler> = new Map();

  constructor() {
    this.registerDefaults();
  }

  registerHandler(kind: ts.SyntaxKind, handler: Handler) {
    this.handlers.set(kind, handler);
  }

  compileNode(node: ts.Node, ctx: CompilationContext): NodeId {
    const handler = this.handlers.get(node.kind);
    if (handler) {
      return handler(node, ctx);
    }
    throw new Error(`Unsupported SyntaxKind: ${ts.SyntaxKind[node.kind]}`);
  }

  compile(sourceText: string): ExecutionGraph {
    const sourceFile = ts.createSourceFile(
      "script.ts", sourceText, ts.ScriptTarget.Latest, true
    );

    const ctx = new CompilationContext(this);

    // Iterate over statements
    ts.forEachChild(sourceFile, (node) => {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) {
        ctx.compileNode(node);
      }
    });

    return ctx.getGraph();
  }

  // --- Default Handlers ---
  private registerDefaults() {
    // 1. Numeric Literals (e.g., 5, 3.14)
    this.registerHandler(ts.SyntaxKind.NumericLiteral, (node, ctx) => {
      const val = parseFloat((node as ts.NumericLiteral).text);
      return ctx.createNode('const', [], { value: val });
    });

    // 2. Identifiers (Variable lookups)
    this.registerHandler(ts.SyntaxKind.Identifier, (node, ctx) => {
      return ctx.resolveVar((node as ts.Identifier).text);
    });

    // 3. Binary Expressions (Math)
    this.registerHandler(ts.SyntaxKind.BinaryExpression, (node, ctx) => {
      const expr = node as ts.BinaryExpression;
      const left = ctx.compileNode(expr.left);
      const right = ctx.compileNode(expr.right);

      let op = 'unknown';
      switch (expr.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: op = 'add'; break;
        case ts.SyntaxKind.MinusToken: op = 'sub'; break;
        case ts.SyntaxKind.AsteriskToken: op = 'mul'; break;
        case ts.SyntaxKind.SlashToken: op = 'div'; break;
      }
      return ctx.createNode(op, [left, right]);
    });

    // 4. Variable Declaration (let x = ...)
    this.registerHandler(ts.SyntaxKind.VariableStatement, (node, ctx) => {
      const stmt = node as ts.VariableStatement;
      stmt.declarationList.declarations.forEach(decl => {
        const name = (decl.name as ts.Identifier).text;
        if (decl.initializer) {
          const valId = ctx.compileNode(decl.initializer);
          ctx.setVar(name, valId);
        }
      });
      // Variable statements don't strictly return a value node ID that represents flow,
      // but we return the last defined one for consistency.
      return ctx.resolveVar((stmt.declarationList.declarations[0].name as ts.Identifier).text);
    });

    // 5. Expression Statement (Top level wrapper)
    this.registerHandler(ts.SyntaxKind.ExpressionStatement, (node, ctx) => {
      return ctx.compileNode((node as ts.ExpressionStatement).expression);
    });

    // 6. Property Access (e.g., input.x, Math.PI)
    this.registerHandler(ts.SyntaxKind.PropertyAccessExpression, (node, ctx) => {
      const expr = node as ts.PropertyAccessExpression;
      const objId = ctx.compileNode(expr.expression);
      const propName = expr.name.text;
      return ctx.createNode('prop', [objId], { key: propName });
    });

    // 7. Object Literal (e.g., { x: 10, y: 20 })
    this.registerHandler(ts.SyntaxKind.ObjectLiteralExpression, (node, ctx) => {
      const obj = node as ts.ObjectLiteralExpression;
      const keys: string[] = [];
      const valueIds: NodeId[] = [];

      obj.properties.forEach((prop: any) => {
        if (prop.name && prop.initializer) {
          keys.push(prop.name.text);
          valueIds.push(ctx.compileNode(prop.initializer));
        }
      });

      return ctx.createNode('struct', valueIds, { keys });
    });
  }
}

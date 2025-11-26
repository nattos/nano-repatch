import * as ts from "typescript";

// ==========================================
// 1. The JSON-Serializable Graph Definition
// ==========================================

export type NodeId = string;

export interface GraphNode {
  id: NodeId;
  op: string;        // The operation code (e.g., 'const', 'add', 'get', 'prop')
  inputs: NodeId[];  // Dependencies (other node IDs)
  params?: any;      // Static parameters (e.g., literal values, property names)
}

export interface ExecutionGraph {
  nodes: Record<NodeId, GraphNode>;
  rootId: NodeId | null; // The final result node
}

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


// ==========================================
// 3. The Executor (Runs the JSON Graph)
// ==========================================

export class ExpressionExecutor {
  execute(graph: ExecutionGraph, inputs: Record<string, any>): any {
    if (!graph.rootId) return null;

    const cache = new Map<NodeId, any>();

    const resolve = (id: NodeId): any => {
      if (cache.has(id)) return cache.get(id);

      const node = graph.nodes[id];
      if (!node) throw new Error(`Missing node ${id}`);

      // Recursive resolution of dependencies
      const args = node.inputs.map(inputId => resolve(inputId));

      let result;
      switch (node.op) {
        case 'const':
          result = node.params.value;
          break;
        case 'input':
          // Looks for value in inputs dictionary, or fallback to global (like Math)
          result = inputs[node.params.key] !== undefined
            ? inputs[node.params.key]
            : (globalThis as any)[node.params.key];
          break;
        case 'add': result = args[0] + args[1]; break;
        case 'sub': result = args[0] - args[1]; break;
        case 'mul': result = args[0] * args[1]; break;
        case 'div': result = args[0] / args[1]; break;
        case 'prop':
          if (args[0] === undefined || args[0] === null) throw new Error(`Cannot access property '${node.params.key}' of undefined`);
          result = args[0][node.params.key];
          break;
        case 'struct':
          // Reassemble object { key: value }
          result = {};
          node.params.keys.forEach((key: string, idx: number) => {
            result[key] = args[idx];
          });
          break;
        default:
          throw new Error(`Unknown op: ${node.op}`);
      }

      cache.set(id, result);
      return result;
    };

    return resolve(graph.rootId);
  }
}

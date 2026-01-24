import { IRNode, DataType, OpKind, ConstNode, DataTypeKind, ReturnNode } from './ir-types';
import { Scope, CompilerContext, extractReturn } from './scope';
import * as ts from 'typescript';

export type CompileNodeFn = (node: ts.Node, ctx: CompilerContext) => IRNode | null;

// Type for a Library Function Handler
// Executed at compile-time (during unrolling) to produce an IRNode result
export type LibFuncHandler = (ctx: CompilerContext, call: ts.CallExpression, args: IRNode[], compile: CompileNodeFn) => IRNode | null;

export interface Library {
  types: Map<string, DataType>;
  globals: Map<string, IRNode>;
  methods: Map<string, LibFuncHandler>;
}

// Registry
const globalScope = new Map<string, IRNode>();
const staticMethods = new Map<string, LibFuncHandler>();
const instanceMethods = new Map<string, InstanceLibFuncHandler>();

export function registerGlobal(name: string, value: IRNode) {
  globalScope.set(name, value);
}

export function resolveGlobal(name: string): IRNode | undefined {
  return globalScope.get(name);
}

// Helper to check if a call is a known static method
export function tryCompileStaticCall(ctx: CompilerContext, call: ts.CallExpression, compile: CompileNodeFn): IRNode | null {
  if (call.expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
    const prop = call.expression as ts.PropertyAccessExpression;
    if (prop.expression.kind === ts.SyntaxKind.Identifier) {
      const objName = (prop.expression as ts.Identifier).text;
      const methodName = prop.name.text;
      const key = `${objName}.${methodName}`;
      if (staticMethods.has(key)) {
        // Compile ARGS here using the passed compile function!
        const args = call.arguments.map(a => compile(a, ctx)).filter(n => n !== null) as IRNode[];
        return staticMethods.get(key)!(ctx, call, args, compile);
      }
    }
  }
  return null;
}

// Instance Method Registry Type
export type InstanceLibFuncHandler = (ctx: CompilerContext, call: ts.CallExpression, args: IRNode[], object: IRNode, compile: CompileNodeFn) => IRNode | null;

// Helper to check if a call is a known instance method (on a ConstNode value usually)
export function tryCompileInstanceMethod(ctx: CompilerContext, call: ts.CallExpression, obj: IRNode, compile: CompileNodeFn): IRNode | null {
  if (call.expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
    const prop = call.expression as ts.PropertyAccessExpression;
    const methodName = prop.name.text;

    if (instanceMethods.has(methodName)) {
      const args = call.arguments.map(a => compile(a, ctx)).filter(n => n !== null) as IRNode[];
      return instanceMethods.get(methodName)!(ctx, call, args, obj, compile);
    }
  }
  return null;
}

/* --- Implementations --- */

const NUMBER_TYPE: DataType = { kind: DataTypeKind.Primitive, name: 'number' };
const VOID_TYPE: DataType = { kind: DataTypeKind.Primitive, name: 'void' };
const ANY_TYPE: DataType = { kind: DataTypeKind.Any };

// Array.isArray
staticMethods.set('Array.isArray', (ctx, call, args) => {
  const arg = args[0];
  if (!arg) return null;
  if (arg.kind === OpKind.Const && Array.isArray((arg as ConstNode).value)) {
    return { id: 'const_true', kind: OpKind.Const, type: NUMBER_TYPE, value: 1 } as ConstNode;
  }
  // If not const array, or const but not array?
  if (arg.kind === OpKind.Const && !Array.isArray((arg as ConstNode).value)) {
    return { id: 'const_false', kind: OpKind.Const, type: NUMBER_TYPE, value: 0 } as ConstNode;
  }
  // Runtime check? Not supported in Const folding yet.
  return { id: 'const_false_fallback', kind: OpKind.Const, type: NUMBER_TYPE, value: 0 } as ConstNode;
});

// Instance Method Registry Type
export type InstanceLibFuncHandler = (ctx: CompilerContext, call: ts.CallExpression, args: IRNode[], object: IRNode, compile: CompileNodeFn) => IRNode | null;

// Array.push
instanceMethods.set('push', (ctx, call, args, obj) => {
  if (obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
    const arrVal = (obj as ConstNode).value as any[];
    // Mutate the array
    const pushedValues: any[] = [];
    for (const elem of args) {
      if (elem.kind === OpKind.Const) pushedValues.push((elem as ConstNode).value);
      else throw new Error("Cannot push non-constant value into constant array during unrolling.");
    }
    arrVal.push(...pushedValues);
    return { id: 'push_ret', kind: OpKind.Const, type: NUMBER_TYPE, value: arrVal.length } as ConstNode;
  }
  return null;
});

// Array.map
instanceMethods.set('map', (ctx, call, args, obj) => {
  if (obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
    const arrValues = (obj as ConstNode).value as any[];
    const callback = call.arguments[0] as ts.ArrowFunction; // Original AST needed for compilation
    // Wait, we passed 'args' as IRNodes. We need the AST for the callback to compile it repeatedly.
    // args[0] is the compiled lambda (ConstNode holding func).

    // Re-extract function from args[0]
    const funcNode = args[0];
    let targetFunc: ts.FunctionLikeDeclaration | null = null;
    let closureScope: Scope | undefined = undefined;

    if (funcNode.kind === OpKind.Const) {
      const val = (funcNode as ConstNode).value;
      if (val.node) {
        targetFunc = val.node;
        closureScope = val.closure;
      }
    }

    if (!targetFunc) return null; // Can't map without compile-time function

    const paramName = (targetFunc.parameters[0].name as ts.Identifier).text;
    const results: any[] = [];
    let resultType: DataType = ANY_TYPE;

    for (const val of arrValues) {
      // Compile Body for each element
      // We need 'compileNode' access? Yes, imported.
      // We need to manage Scope.

      // 1. Prepare Scope
      const savedScope = ctx.scope;
      if (closureScope) ctx.scope = closureScope; // Switch to closure capture
      ctx.pushScope();

      // 2. Bind Param
      // Create ConstNode for the element
      const elemNode = { id: 'map_elem', kind: OpKind.Const, type: NUMBER_TYPE /*infer?*/, value: val } as ConstNode;
      ctx.scope.set(paramName, elemNode);
      ctx.scope.declare(paramName, elemNode.type);

      // 3. Compile Body
      let bodyRes: IRNode | null = null;
      if (targetFunc.body.kind !== ts.SyntaxKind.Block) {
        bodyRes = compileNode(targetFunc.body, ctx);
      } else {
        // Block body ... (simple return extraction)
        // We need `extractReturn` helper from compiler? Or duplicating logic?
        // It's better to export `extractReturn` or `compileFunctionBody`?
        // Let's assume expression body for now or simple block.
        // Duplicate block logic for now.
        const bodyBlock = targetFunc.body as ts.Block;
        for (const stmt of bodyBlock.statements) {
          const s = compileNode(stmt, ctx);
          // extractReturn logic...
          const ret = extractReturn(s);
          if (ret) { bodyRes = ret; break; }
        }
      }

      ctx.popScope();
      ctx.scope = savedScope;

      if (bodyRes && bodyRes.kind === OpKind.Const) {
        results.push((bodyRes as ConstNode).value);
        resultType = bodyRes.type;
      } else {
        throw new Error("Map callback must produce constant values in unroller");
      }
    }

    return { id: 'map_res', kind: OpKind.Const, type: { kind: DataTypeKind.Array, elementType: resultType, length: results.length }, value: results } as ConstNode;
  }
  return null;
});

// Register Global 'Array' identifier logic?
// compiler.ts handles identifiers.
// If valid identifier isn't found, we check globals.

// Init Globals
registerGlobal('Array', { id: 'global_Array', kind: OpKind.Const, type: ANY_TYPE, value: { name: 'Array' } } as ConstNode);


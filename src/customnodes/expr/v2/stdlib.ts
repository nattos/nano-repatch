import { IRNode, DataType, OpKind, ConstNode, DataTypeKind, ReturnNode, IntrinsicNode, PrimitiveType, ArrayNode } from './ir-types';
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

const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };
const VOID_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'void' };
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
instanceMethods.set('map', (ctx, call, args, obj, compile) => {
  let arrValues: any[] = [];
  if (obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
    arrValues = (obj as ConstNode).value;
  } else if (obj.kind === OpKind.Array) {
    // ArrayNode elements comprise the array
    arrValues = (obj as ArrayNode).elements;
    // Elements are IRNodes.
  } else {
    return null;
  }

  const funcNode = args[0];
  let targetFunc: ts.FunctionLikeDeclaration | null = null;
  let closureScope: Scope | undefined = undefined;

  if (funcNode.kind === OpKind.Const && (funcNode as ConstNode).value) {
    const val = (funcNode as ConstNode).value;
    if (val.node) {
      targetFunc = val.node;
      closureScope = val.closure;
    }
  }

  if (!targetFunc) return null;

  const paramName = (targetFunc.parameters[0].name as ts.Identifier).text;
  const results: any[] = [];
  const resultElements: IRNode[] = [];
  let resultType: DataType = ANY_TYPE;
  let isConstArray = true;

  for (const val of arrValues) {
    const savedScope = ctx.scope;
    if (closureScope) ctx.scope = closureScope;
    ctx.pushScope();

    // Prepare Element Node
    // If 'val' is raw value (from Const array), wrap in ConstNode.
    // If 'val' is IRNode (from ArrayNode), use it directly.
    let elemNode: IRNode;
    if (obj.kind === OpKind.Const) {
      elemNode = { id: 'map_elem', kind: OpKind.Const, type: NUMBER_TYPE, value: val } as ConstNode;
    } else {
      elemNode = val as IRNode;
    }

    ctx.scope.set(paramName, elemNode);
    ctx.scope.declare(paramName, elemNode.type);

    let bodyRes: IRNode | null = null;
    if (targetFunc.body && targetFunc.body.kind !== ts.SyntaxKind.Block) {
      bodyRes = compile(targetFunc.body, ctx);
    } // else block handling... simplified for map unrolling usually expr

    ctx.popScope();
    ctx.scope = savedScope;

    if (bodyRes) {
      resultElements.push(bodyRes);
      if (bodyRes.kind !== OpKind.Const) isConstArray = false;
      // resultType update...
    } else {
      throw new Error("Map body failed to compile");
    }
  }

  if (isConstArray) {
    // Return ConstNode array
    const values = resultElements.map(e => (e as ConstNode).value);
    return { id: 'map_res_const', kind: OpKind.Const, type: { kind: DataTypeKind.Array, elementType: ANY_TYPE }, value: values } as ConstNode;
  }
  // Return ArrayNode
  return { id: 'map_res_arr', kind: OpKind.Array, type: { kind: DataTypeKind.Array, elementType: ANY_TYPE }, elements: resultElements } as ArrayNode;
});

instanceMethods.set('reduce', (ctx, call, args, obj, compile) => {
  let arrValues: any[] = [];
  if (obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
    arrValues = (obj as ConstNode).value;
  } else if (obj.kind === OpKind.Array) {
    arrValues = (obj as ArrayNode).elements;
  } else {
    return null;
  }

  const funcNode = args[0];
  const initialValNode = args[1]; // Should be ConstNode or IRNode

  let targetFunc: ts.FunctionLikeDeclaration | null = null;
  let closureScope: Scope | undefined = undefined;

  if (funcNode.kind === OpKind.Const && (funcNode as ConstNode).value) {
    const val = (funcNode as ConstNode).value;
    if (val.node) {
      targetFunc = val.node;
      closureScope = val.closure;
    }
  }
  if (!targetFunc) return null;

  const accParamName = (targetFunc.parameters[0].name as ts.Identifier).text;
  const valParamName = (targetFunc.parameters[1].name as ts.Identifier).text;

  let acc: IRNode = initialValNode || { id: 'init_undef', kind: OpKind.Const, type: ANY_TYPE, value: undefined };

  for (const val of arrValues) {
    const savedScope = ctx.scope;
    if (closureScope) ctx.scope = closureScope;
    ctx.pushScope();

    let elemNode: IRNode;
    if (obj.kind === OpKind.Const) {
      elemNode = { id: 'reduce_elem', kind: OpKind.Const, type: NUMBER_TYPE, value: val } as ConstNode;
    } else {
      elemNode = val as IRNode;
    }

    ctx.scope.set(accParamName, acc); // acc updates each iter
    ctx.scope.declare(accParamName, acc.type);
    ctx.scope.set(valParamName, elemNode);
    ctx.scope.declare(valParamName, elemNode.type);

    let bodyRes: IRNode | null = null;
    if (targetFunc.body && targetFunc.body.kind !== ts.SyntaxKind.Block) {
      bodyRes = compile(targetFunc.body, ctx);
    }

    ctx.popScope();
    ctx.scope = savedScope;

    if (bodyRes) {
      acc = bodyRes;
    }
  }
  return acc;
});

instanceMethods.set('push', (ctx, call, args, obj, compile) => {
  // Push mutates the array.
  // We need to resolve the array reference and update its state?
  // IR Arrays (ArrayNode) are immutable nodes in graph usually?
  // But our unroller treats scopes as mutable state.
  // We need to find the ArrayNode and mutate its elements list?
  // ArrayNode.elements is mutable array?

  let arrNode: ArrayNode | null = null;
  let constArr: any[] | null = null;

  if (obj.kind === OpKind.Array) {
    arrNode = obj as ArrayNode;
  } else if (obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
    constArr = (obj as ConstNode).value;
  } else {
    return null;
  }

  const newElements: IRNode[] = [];
  for (const arg of args) {
    if (arrNode) {
      arrNode.elements.push(arg);
    }
    if (constArr) {
      if (arg.kind === OpKind.Const) {
        constArr.push((arg as ConstNode).value);
      } else {
        // Cannot push non-const to const array. Must upgrade array to ArrayNode?
        // This is complex. For now assume push usage in unrolling maintains constness or arrayness.
        // If we have Const Array, and push Var. We can't mutate ConstNode value to hold Var.
        // We should convert ConstNode -> ArrayNode?
        // But 'obj' is the node. We can't change 'obj' reference held by others.
        // But we can update what scope holds? No, 'obj' is passed by value (IRNode).
        // Actually, if 'obj' came from scope resolve, it's the node.
        // ArrayNode.elements IS mutable.
        // ConstNode.value IS mutable (JS array).

        // If constArr, but arg is Var.
        // We fail? Or we create ArrayNode from ConstNode and push?
        // But we can't update usages.
        // For now throw error or just fail.
        throw new Error("Cannot push non-constant value to Constant Array during unrolling (upgrade not implemented)");
      }
    }
  }
  // push returns new length
  const len = arrNode ? arrNode.elements.length : constArr!.length;
  return { id: 'push_res', kind: OpKind.Const, type: NUMBER_TYPE, value: len } as ConstNode;
});

// Register Global 'Array' identifier logic?
// compiler.ts handles identifiers.
// If valid identifier isn't found, we check globals.

// Math Library Support

function registerMath(name: string, func: (...args: number[]) => number) {
  staticMethods.set(`Math.${name}`, (ctx, call, args) => {
    // 1. Try Constant Folding
    const allConst = args.every(a => a.kind === OpKind.Const && a.type.kind === DataTypeKind.Primitive && a.type.name === 'number');
    if (allConst) {
      const val = func(...args.map(a => (a as ConstNode).value as number));
      return { id: `const_math_${name}`, kind: OpKind.Const, type: NUMBER_TYPE, value: val } as ConstNode;
    }

    // 2. Emit Runtime Intrinsic
    // Generate a unique ID for the intrinsic call
    // We need a way to get nextId logic, but it's internal to compiler.
    // We can use a makeshift ID or we need nextId exposed/injected?
    // Using a timestamp/random or just 'intrinsic_' + suffix is okay for IR as long as unique?
    // Actually, IR IDs should be unique.
    // Let's assume we don't strictly need sequentially perfect IDs for now, or use a local counter.
    // We can inject `ctx.nextId()` if we added it to Context, but we didn't.
    // Let's use `math_${name}_${Math.random().toString(36).substr(2, 5)}`

    return {
      id: `intr_${name}_${Math.floor(Math.random() * 10000)}`,
      kind: OpKind.Intrinsic,
      type: NUMBER_TYPE,
      library: 'Math',
      method: name,
      args
    } as IntrinsicNode;
  });
}

// Register Standard Math Functions
['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'sqrt', 'abs', 'ceil', 'floor', 'round', 'max', 'min', 'pow'].forEach(name => {
  // Cast to any because TS doesn't know dynamic Math access easily
  const fn = (Math as any)[name];
  if (fn) registerMath(name, fn);
});

// Constants
registerGlobal('Math', { id: 'global_Math', kind: OpKind.Const, type: ANY_TYPE, value: { name: 'Math' } } as ConstNode);


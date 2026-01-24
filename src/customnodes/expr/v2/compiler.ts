import * as ts from "typescript";
import {
  IRGraph, IRNode, OpKind, DataTypeKind, DataType, PrimitiveType,
  VarDeclNode, VarNode, BlockNode, IfNode, ReturnNode, BinaryNode, ConstNode, AssignNode, ArrayNode, StructNode, PropAccessNode, PhiNode
} from "./ir-types";

// ... Scope ...
class Scope {
  private variables = new Map<string, DataType>();
  public values = new Map<string, IRNode>();
  private functions = new Map<string, ts.FunctionDeclaration>();

  constructor(public parent: Scope | null = null) { }

  fork(): Scope {
    const child = new Scope(this);
    // Forking logic: standard scope inheritance is handled by prototype-like `parent` chain.
    // However, `values` map in child starts empty.
    return child;
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

  // Assign always writes to CURRENT scope (Shadowing for SSA/Versioning)
  assign(name: string, value: IRNode) {
    this.values.set(name, value);
  }

  resolve(name: string): DataType | null {
    if (this.variables.has(name)) return this.variables.get(name)!;
    if (this.parent) return this.parent.resolve(name);
    return null;
  }

  resolveValue(name: string): IRNode | null {
    if (this.values.has(name)) return this.values.get(name)!;
    if (this.parent) return this.parent.resolveValue(name);
    return null;
  }

  resolveFunction(name: string): ts.FunctionDeclaration | null {
    if (this.functions.has(name)) return this.functions.get(name)!;
    if (this.parent) return this.parent.resolveFunction(name);
    return null;
  }

  static merge(parent: Scope, branchA: Scope, branchB: Scope, condition: IRNode): void {
    const keys = new Set([...branchA.values.keys(), ...branchB.values.keys()]);

    for (const key of keys) {
      const valA = branchA.values.get(key) || parent.resolveValue(key);
      const valB = branchB.values.get(key) || parent.resolveValue(key);

      if (!valA || !valB) continue;

      if (valA !== valB) {
        if (valA.kind === OpKind.Const && valB.kind === OpKind.Const &&
          (valA as ConstNode).value === (valB as ConstNode).value) {
          parent.assign(key, valA);
          continue;
        }
        const parentVal = parent.resolveValue(key);
        if (valA === parentVal && valB === parentVal) continue;

        const phi: PhiNode = {
          id: nextId(),
          kind: OpKind.Phi,
          type: valA.type,
          condition,
          trueValue: valA,
          falseValue: valB
        };

        parent.assign(key, phi);
      }
    }
  }

  static mergeOneWay(parent: Scope, branchA: Scope, condition: IRNode): void {
    const keys = new Set([...branchA.values.keys()]);
    for (const key of keys) {
      const valA = branchA.values.get(key)!;
      const parentVal = parent.resolveValue(key);

      if (valA !== parentVal && parentVal) {
        const phi: PhiNode = {
          id: nextId(),
          kind: OpKind.Phi,
          type: valA.type,
          condition,
          trueValue: valA,
          falseValue: parentVal
        };
        parent.assign(key, phi);
      }
    }
  }
}

class CompilerContext {
  public scope: Scope;
  constructor() {
    this.scope = new Scope();
  }
  pushScope() {
    this.scope = new Scope(this.scope);
  }
  popScope() {
    if (this.scope.parent) {
      this.scope = this.scope.parent;
    }
  }
}

export function compileToIR(source: string): IRGraph {
  const sourceFile = ts.createSourceFile("script.ts", source, ts.ScriptTarget.Latest, true);
  const ctx = new CompilerContext();
  const statements: IRNode[] = [];
  ts.forEachChild(sourceFile, (node) => {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const irNode = compileNode(node, ctx);
    if (irNode) {
      statements.push(irNode);
    }
  });
  return { root: { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode };
}

let nodeIdCounter = 0;
function nextId() { return `ir${nodeIdCounter++}`; }

const VOID_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'void' };
const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };
const ARRAY_TYPE = (elementType: DataType, length?: number) => ({ kind: DataTypeKind.Array, elementType, length } as any);
const STRUCT_TYPE = (fields: Record<string, DataType>) => ({ kind: DataTypeKind.Struct, fields } as any);
const GENERIC_INST = (base: string, args: DataType[]) => ({ kind: DataTypeKind.GenericInstantiation, base, args } as any);

function extractReturn(node: IRNode | null): IRNode | null {
  if (!node) return null;
  if (node.kind === OpKind.Return) return (node as ReturnNode).value;
  if (node.kind === OpKind.Block) {
    const block = node as BlockNode;
    if (block.statements.length > 0) return extractReturn(block.statements[block.statements.length - 1]);
  }
  return null;
}

function compileNode(node: ts.Node, ctx: CompilerContext): IRNode | null {
  switch (node.kind) {
    case ts.SyntaxKind.ExpressionStatement:
      return compileNode((node as ts.ExpressionStatement).expression, ctx);

    case ts.SyntaxKind.Block: {
      const block = node as ts.Block;
      ctx.pushScope();
      const statements: IRNode[] = [];
      block.statements.forEach(stmt => {
        const compiled = compileNode(stmt, ctx);
        if (compiled) statements.push(compiled);
      });
      ctx.popScope();
      return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode;
    }

    // Convert Arrow Functions to Const Nodes (so they can be stored in Vars)
    case ts.SyntaxKind.ArrowFunction: {
      const func = node as ts.ArrowFunction;
      // Optimization: Wrap it in a FunctionDeclaration-like object or just store the AST?
      // We need to return a Value that *represents* the function.
      // Let's use a ConstNode where value IS the AST node (shimmed to look like FunctionDeclaration?)
      // Or just the ArrowFunction node itself.
      // Our 'Call' logic expects specific structure.
      // Let's coerce ArrowFunction to FunctionDeclaration interface loosely if needed, or update Resolve logic.

      return {
        id: nextId(),
        kind: OpKind.Const,
        type: { kind: DataTypeKind.Any }, // Function type TODO
        value: func
      } as ConstNode;
    }

    case ts.SyntaxKind.InterfaceDeclaration: return null;
    case ts.SyntaxKind.FunctionDeclaration: {
      const func = node as ts.FunctionDeclaration;
      if (func.name) ctx.scope.declareFunction(func.name.text, func);
      return null;
    }

    case ts.SyntaxKind.VariableStatement: {
      const stmt = node as ts.VariableStatement;
      const decls: IRNode[] = [];
      stmt.declarationList.declarations.forEach(decl => {
        const name = (decl.name as ts.Identifier).text;
        let init: IRNode | undefined;
        let type: DataType = { kind: DataTypeKind.Any };
        if (decl.initializer) {
          init = compileNode(decl.initializer, ctx) || undefined;
          if (init) {
            type = init.type;
            ctx.scope.set(name, init);
          }
        }
        ctx.scope.declare(name, type);
        decls.push({ id: nextId(), kind: OpKind.VarDecl, type: VOID_TYPE, name, init } as VarDeclNode);
      });
      if (decls.length === 1) return decls[0];
      return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: decls } as BlockNode;
    }

    case ts.SyntaxKind.Identifier: {
      const name = (node as ts.Identifier).text;
      const val = ctx.scope.resolveValue(name);
      if (val) {
        // If it's a Const (Value) or Phi (Value), return it directly?
        // Yes, for Unrolling, Identifiers resolve to their known values.
        return val;
      }
      const type = ctx.scope.resolve(name);
      if (!type) {
        if (name !== 'Array') console.warn(`Unresolved identifier: ${name}`);
        return { id: nextId(), kind: OpKind.Var, type: { kind: DataTypeKind.Any }, name } as VarNode;
      }
      return { id: nextId(), kind: OpKind.Var, type, name } as VarNode;
    }

    case ts.SyntaxKind.IfStatement: {
      const stmt = node as ts.IfStatement;
      const condition = compileNode(stmt.expression, ctx);
      if (!condition) throw new Error("If condition failed to compile");

      if (condition.kind === OpKind.Const) {
        const val = (condition as ConstNode).value;
        if (val) return compileNode(stmt.thenStatement, ctx);
        else return stmt.elseStatement ? compileNode(stmt.elseStatement, ctx) : null;
      }

      const parentScope = ctx.scope;
      const thenScope = parentScope.fork();
      ctx.scope = thenScope;
      let thenBlock = compileNode(stmt.thenStatement, ctx);
      // Simplify block wrapping
      if (thenBlock && thenBlock.kind !== OpKind.Block) thenBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [thenBlock] } as BlockNode;
      if (!thenBlock) thenBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [] } as BlockNode;

      let elseBlock: IRNode | undefined;
      if (stmt.elseStatement) {
        const elseScope = parentScope.fork();
        ctx.scope = elseScope;
        const compiledElse = compileNode(stmt.elseStatement, ctx);
        if (compiledElse) {
          elseBlock = compiledElse.kind !== OpKind.Block ? { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [compiledElse] } as BlockNode : compiledElse as BlockNode;
        } else {
          elseBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [] } as BlockNode;
        }
        Scope.merge(parentScope, thenScope, elseScope, condition);
      } else {
        Scope.mergeOneWay(parentScope, thenScope, condition);
      }
      ctx.scope = parentScope;

      return { id: nextId(), kind: OpKind.If, type: VOID_TYPE, condition, thenBlock, elseBlock } as IfNode;
    }

    // Literals...
    case ts.SyntaxKind.NumericLiteral: return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: parseFloat((node as ts.NumericLiteral).text) } as ConstNode;
    // ... Array/Object Literals ...
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = node as ts.ArrayLiteralExpression;
      const elements = arr.elements.map(e => compileNode(e, ctx)).filter(e => e !== null) as IRNode[];
      const allConst = elements.every(e => e.kind === OpKind.Const);
      if (allConst) return { id: nextId(), kind: OpKind.Const, type: ARRAY_TYPE(elements[0]?.type || NUMBER_TYPE, elements.length), value: elements.map(e => (e as ConstNode).value) } as ConstNode;
      return { id: nextId(), kind: OpKind.Array, type: ARRAY_TYPE(elements[0]?.type || NUMBER_TYPE, elements.length), elements } as ArrayNode;
    }
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = node as ts.ObjectLiteralExpression;
      const fields: Record<string, IRNode> = {};
      let allConst = true;
      const constValue: Record<string, any> = {};
      const fieldTypes: Record<string, DataType> = {};
      for (const prop of obj.properties) {
        if (prop.kind !== ts.SyntaxKind.PropertyAssignment) continue;
        const key = (prop.name as ts.Identifier).text;
        const valNode = compileNode(prop.initializer, ctx);
        if (valNode) {
          fields[key] = valNode;
          fieldTypes[key] = valNode.type;
          if (valNode.kind === OpKind.Const) constValue[key] = (valNode as ConstNode).value;
          else allConst = false;
        }
      }
      const structType = STRUCT_TYPE(fieldTypes);
      if (allConst) return { id: nextId(), kind: OpKind.Const, type: structType, value: constValue } as ConstNode;
      return { id: nextId(), kind: OpKind.Struct, type: structType, fields } as StructNode;
    }
    case ts.SyntaxKind.PropertyAccessExpression: {
      const prop = node as ts.PropertyAccessExpression;
      const object = compileNode(prop.expression, ctx);
      const propertyName = prop.name.text;
      if (!object) return null;
      if (object.kind === OpKind.Const) {
        const objVal = (object as ConstNode).value;
        if (objVal && typeof objVal === 'object' && propertyName in objVal) {
          return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: objVal[propertyName] } as ConstNode;
        }
      }
      return { id: nextId(), kind: OpKind.PropAccess, type: NUMBER_TYPE, object, property: propertyName } as PropAccessNode;
    }

    case ts.SyntaxKind.CallExpression: {
      const call = node as ts.CallExpression;

      // 1. Method/Static Calls
      if (call.expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
        const propMain = call.expression as ts.PropertyAccessExpression;
        const methodName = propMain.name.text;
        const obj = compileNode(propMain.expression, ctx);

        // Array.isArray
        if (methodName === 'isArray' && propMain.expression.kind === ts.SyntaxKind.Identifier && (propMain.expression as ts.Identifier).text === 'Array') {
          const arg = call.arguments[0] ? compileNode(call.arguments[0], ctx) : null;
          if (arg) {
            if (arg.kind === OpKind.Const && Array.isArray((arg as ConstNode).value)) return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: 1 } as ConstNode;
            if (arg.kind === OpKind.Const && !Array.isArray((arg as ConstNode).value)) return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: 0 } as ConstNode;
          }
          return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: 0 } as ConstNode;
        }
        if (!obj) return null;

        // Map/Reduce
        if (methodName === 'map' && obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
          const arrValues = (obj as ConstNode).value as any[];
          const callback = call.arguments[0]; // Arrow Function
          const func = callback as ts.ArrowFunction;
          const paramName = (func.parameters[0].name as ts.Identifier).text;
          const results: any[] = [];
          let resultType: DataType = NUMBER_TYPE;
          for (const val of arrValues) {
            ctx.pushScope();
            ctx.scope.set(paramName, { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: val } as ConstNode);
            ctx.scope.declare(paramName, NUMBER_TYPE);
            const bodyRes = compileNode(func.body, ctx);
            ctx.popScope();
            if (bodyRes && bodyRes.kind === OpKind.Const) {
              results.push((bodyRes as ConstNode).value);
              resultType = bodyRes.type;
            }
          }
          if (results.length === arrValues.length) return { id: nextId(), kind: OpKind.Const, type: ARRAY_TYPE(resultType, results.length), value: results } as ConstNode;
        }
        // ... Reduce (Simplified omitted for brevity, similar structure)

      }

      // 2. Identifier / Value Calls (Inline User Funcs)
      if (call.expression.kind === ts.SyntaxKind.Identifier) {
        const funcName = (call.expression as ts.Identifier).text;

        // Check for Value (Variable holding function or Phi)
        const val = ctx.scope.resolveValue(funcName);

        const tryInline = (targetFunc: ts.FunctionLikeDeclaration, callNode: ts.CallExpression): IRNode | null => {
          ctx.pushScope();
          // Infer Generics
          const typeParams = targetFunc.typeParameters;
          const genericMap = new Map<string, DataType>();

          // Map Args
          for (let i = 0; i < targetFunc.parameters.length; i++) {
            const param = targetFunc.parameters[i];
            const paramName = (param.name as ts.Identifier).text;
            const argNode = callNode.arguments[i] ? compileNode(callNode.arguments[i], ctx) : undefined;
            if (argNode) {
              if (param.type && param.type.kind === ts.SyntaxKind.TypeReference) {
                const typeRef = param.type as ts.TypeReferenceNode;
                const typeName = (typeRef.typeName as ts.Identifier).text;
                if (typeParams?.some(tp => tp.name.text === typeName)) genericMap.set(typeName, argNode.type);
              }
              ctx.scope.set(paramName, argNode);
              ctx.scope.declare(paramName, argNode.type);
            }
          }

          // Body
          let result: IRNode | null = null;
          if (targetFunc.body) {
            if (targetFunc.kind === ts.SyntaxKind.ArrowFunction && targetFunc.body.kind !== ts.SyntaxKind.Block) {
              // Expression Body
              result = compileNode(targetFunc.body, ctx);
            } else {
              // Block Body
              const bodyBlock = targetFunc.body as ts.Block;
              for (const stmt of bodyBlock.statements) {
                const compiledStmt = compileNode(stmt, ctx);
                const ret = extractReturn(compiledStmt);
                if (ret) { result = ret; break; }
              }
            }
          }
          ctx.popScope();

          // Generic Return Type Reflection
          if (result && targetFunc.type && targetFunc.type.kind === ts.SyntaxKind.TypeReference) {
            const returnTypeRef = targetFunc.type as ts.TypeReferenceNode;
            const returnTypeName = (returnTypeRef.typeName as ts.Identifier).text;
            if (returnTypeRef.typeArguments && returnTypeRef.typeArguments.length > 0) {
              const typeArg = returnTypeRef.typeArguments[0];
              if (typeArg.kind === ts.SyntaxKind.TypeReference && genericMap.has((typeArg as ts.TypeReferenceNode).typeName.getText())) {
                const resolvedT = genericMap.get((typeArg as ts.TypeReferenceNode).typeName.getText())!;
                const reflectedType = GENERIC_INST(returnTypeName, [resolvedT]);
                return { ...result, type: reflectedType };
              }
            }
          }
          return result;
        };

        if (val) {
          // Phi Dispatch Logic
          if (val.kind === OpKind.Phi) {
            const phi = val as PhiNode;
            // Dispatch True
            // Hack: We need to "call" the trueValue.
            // Since trueValue matches the signature of the call, we can assume it's a Function-like thing.
            // Recursve helper for Phi unwrapping
            const dispatchPhi = (node: IRNode): IRNode | null => {
              if (node.kind === OpKind.Phi) {
                const p = node as PhiNode;
                const t = dispatchPhi(p.trueValue);
                const f = dispatchPhi(p.falseValue);
                if (!t || !f) return null;
                return { id: nextId(), kind: OpKind.Phi, type: t.type, condition: p.condition, trueValue: t, falseValue: f } as PhiNode;
              }
              if (node.kind === OpKind.Const && (node as ConstNode).value && (node as ConstNode).value.kind) {
                // Assume Value is a Function AST Node (ArrowFunc or FuncDecl)
                const funcNode = (node as ConstNode).value as ts.FunctionLikeDeclaration;
                return tryInline(funcNode, call);
              }
              return null;
            };
            return dispatchPhi(phi);
          }

          // Direct Variable Call (e.g. op = (x)=>x)
          if (val.kind === OpKind.Const && (val as ConstNode).value && (val as ConstNode).value.kind) {
            const funcNode = (val as ConstNode).value as ts.FunctionLikeDeclaration;
            return tryInline(funcNode, call);
          }
        }

        // Static Function Decl lookup (fallback)
        const staticDecl = ctx.scope.resolveFunction(funcName);
        if (staticDecl) return tryInline(staticDecl, call);
      }
      return null;
    }

    case ts.SyntaxKind.BinaryExpression: {
      const expr = node as ts.BinaryExpression;
      if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (expr.left.kind !== ts.SyntaxKind.Identifier) throw new Error("Assignment target must be an identifier");
        const targetName = (expr.left as ts.Identifier).text;
        const result = compileNode(expr.right, ctx);
        if (!result) return null;
        ctx.scope.assign(targetName, result);
        return { id: nextId(), kind: OpKind.Assign, type: VOID_TYPE, target: targetName, value: result } as AssignNode;
      }
      const left = compileNode(expr.left, ctx);
      const right = compileNode(expr.right, ctx);
      if (!left || !right) return null;
      if (left.kind === OpKind.Const && right.kind === OpKind.Const) {
        const lVal = (left as ConstNode).value;
        const rVal = (right as ConstNode).value;
        let result: any = null;
        switch (expr.operatorToken.kind) {
          case ts.SyntaxKind.PlusToken: result = lVal + rVal; break;
          case ts.SyntaxKind.MinusToken: result = lVal - rVal; break;
          case ts.SyntaxKind.AsteriskToken: result = lVal * rVal; break;
          // ...
        }
        if (result !== null) return { id: nextId(), kind: OpKind.Const, type: left.type, value: result } as ConstNode;
      }
      let op: any = '?';
      switch (expr.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: op = '+'; break;
        case ts.SyntaxKind.AsteriskToken: op = '*'; break;
        // ...
      }
      return { id: nextId(), kind: OpKind.Binary, type: NUMBER_TYPE, op, left, right } as BinaryNode;
    }

    case ts.SyntaxKind.ReturnStatement: {
      const stmt = node as ts.ReturnStatement;
      let value: IRNode | null = null;
      if (stmt.expression) value = compileNode(stmt.expression, ctx);
      if (!value) value = { id: nextId(), kind: OpKind.Const, type: VOID_TYPE, value: undefined } as ConstNode;
      return { id: nextId(), kind: OpKind.Return, type: value.type, value } as ReturnNode;
    }

    default: return null;
  }
}

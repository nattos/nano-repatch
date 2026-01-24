import * as ts from "typescript";
import {
  IRGraph, IRNode, OpKind, DataTypeKind, DataType, PrimitiveType,
  VarDeclNode, VarNode, BlockNode, IfNode, ReturnNode, BinaryNode, ConstNode, AssignNode, ArrayNode, StructNode, PropAccessNode, PhiNode, IntrinsicNode
} from "./ir-types";
import { Scope, CompilerContext, extractReturn } from "./scope";
import { resolveGlobal, tryCompileStaticCall, tryCompileInstanceMethod } from "./stdlib";

// Scope and Context moved to scope.ts

function compileNode(node: ts.Node, ctx: CompilerContext): IRNode | null {
  // console.log(`Compiling Node Kind: ${node.kind}`);
  switch (node.kind) {
    case ts.SyntaxKind.ExpressionStatement:
      return compileNode((node as ts.ExpressionStatement).expression, ctx);

    case ts.SyntaxKind.Block: {
      const block = node as ts.Block;
      ctx.pushScope();
      const statements: IRNode[] = [];
      for (const stmt of block.statements) {
        const s = compileNode(stmt, ctx);
        if (s) statements.push(s);
      }
      ctx.popScope();
      return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode;
    }

    case ts.SyntaxKind.VariableStatement: {
      const stmt = node as ts.VariableStatement;
      // Delegate to VariableDeclarationList handler
      return compileNode(stmt.declarationList, ctx);
    }

    case ts.SyntaxKind.VariableDeclarationList: {
      const list = node as ts.VariableDeclarationList;
      const decls: IRNode[] = [];
      list.declarations.forEach(decl => {
        const name = (decl.name as ts.Identifier).text;
        let init: IRNode | undefined;
        let type: DataType = { kind: DataTypeKind.Any };
        if (decl.type) {
          // resolve type from annotation
          // simple mapping for now
          if (decl.type.kind === ts.SyntaxKind.NumberKeyword) type = NUMBER_TYPE;
          if (decl.type.kind === ts.SyntaxKind.BooleanKeyword) type = BOOLEAN_TYPE;
          if (decl.type.kind === ts.SyntaxKind.ArrayType) {
            const el = (decl.type as ts.ArrayTypeNode).elementType;
            let elType: DataType = ANY_TYPE;
            if (el.kind === ts.SyntaxKind.NumberKeyword) elType = NUMBER_TYPE;
            // recursion if needed, but for now depth 1
            type = { kind: DataTypeKind.Array, elementType: elType };
          }
        } else if (decl.initializer) {
          init = compileNode(decl.initializer, ctx) || undefined;
          if (init) {
            type = init.type;
            // Always set in scope for unrolling/evaluated values
            ctx.scope.set(name, init);
          }
        }

        // Initializer compilation if type was from annotation but init exists
        if (decl.initializer && !init) {
          init = compileNode(decl.initializer, ctx) || undefined;
          if (init) ctx.scope.set(name, init);
        }
        ctx.scope.declare(name, type);
        decls.push({ id: nextId(), kind: OpKind.VarDecl, type, name, init } as VarDeclNode);
      });
      if (decls.length === 1) return decls[0];
      return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: decls } as BlockNode;
    }

    case ts.SyntaxKind.Identifier: {
      const name = (node as ts.Identifier).text;
      const val = ctx.scope.resolveValue(name);
      if (val) return val;
      const func = ctx.scope.resolveFunction(name);
      if (func) {
        return { id: nextId(), kind: OpKind.Const, type: ANY_TYPE, value: { node: func, closure: ctx.scope.snapshot() } } as ConstNode;
      }
      const type = ctx.scope.resolve(name);
      if (!type) {
        // Check Globals (StdLib)
        const globalVal = resolveGlobal(name);
        if (globalVal) return globalVal;
        if (name !== 'Array') console.warn(`Unresolved identifier: ${name}`);
        return { id: nextId(), kind: OpKind.Var, type: { kind: DataTypeKind.Any }, name } as VarNode;
      }
      return { id: nextId(), kind: OpKind.Var, type, name } as VarNode;
    }

    case ts.SyntaxKind.NumericLiteral:
      return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: parseFloat((node as ts.NumericLiteral).text) } as ConstNode;

    case ts.SyntaxKind.StringLiteral:
      return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Primitive, name: 'string' }, value: (node as ts.StringLiteral).text } as ConstNode;

    case ts.SyntaxKind.TrueKeyword:
      return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Primitive, name: 'boolean' }, value: true } as ConstNode;
    case ts.SyntaxKind.FalseKeyword:
      return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Primitive, name: 'boolean' }, value: false } as ConstNode;

    case ts.SyntaxKind.CallExpression: {
      const call = node as ts.CallExpression;

      const staticRes = tryCompileStaticCall(ctx, call, compileNode);
      if (staticRes) return staticRes;

      if (call.expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
        const prop = call.expression as ts.PropertyAccessExpression;
        const obj = compileNode(prop.expression, ctx);
        if (obj) {
          const instanceRes = tryCompileInstanceMethod(ctx, call, obj, compileNode);
          if (instanceRes) return instanceRes;
        }
      }

      // Inline User Funcs
      let funcVal: IRNode | null = null;
      let funcDecl: ts.FunctionLikeDeclaration | null = null;

      if (call.expression.kind === ts.SyntaxKind.Identifier) {
        const funcName = (call.expression as ts.Identifier).text;
        funcVal = ctx.scope.resolveValue(funcName) || null;
        if (!funcVal) funcDecl = ctx.scope.resolveFunction(funcName);
      } else {
        funcVal = compileNode(call.expression, ctx);
      }

      /* ... tryInlineFunc Definition ... */
      const tryInlineFunc = (targetFunc: ts.FunctionLikeDeclaration, callNode: ts.CallExpression, closureScope?: Scope): IRNode | null => {
        const args: { name: string, value: IRNode }[] = [];
        const typeParams = targetFunc.typeParameters;
        const genericMap = new Map<string, DataType>();
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
            args.push({ name: paramName, value: argNode });
          }
        }
        const savedScope = ctx.scope;
        if (closureScope) ctx.scope = closureScope;
        ctx.pushScope();
        for (const arg of args) {
          ctx.scope.set(arg.name, arg.value);
          ctx.scope.declare(arg.name, arg.value.type);
        }
        let result: IRNode | null = null;
        if (targetFunc.body) {
          if (targetFunc.kind === ts.SyntaxKind.ArrowFunction && targetFunc.body.kind !== ts.SyntaxKind.Block) {
            result = compileNode(targetFunc.body, ctx);
          } else {
            const bodyBlock = targetFunc.body as ts.Block;
            for (const stmt of bodyBlock.statements) {
              const compiledStmt = compileNode(stmt, ctx);
              const ret = extractReturn(compiledStmt);
              if (ret) { result = ret; break; }
            }
          }
        }
        ctx.popScope();
        ctx.scope = savedScope;
        if (result && targetFunc.type && targetFunc.type.kind === ts.SyntaxKind.TypeReference) {
          // Generics mapping
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

      if (funcVal) {
        if (funcVal.kind === OpKind.Phi) {
          // Skip Phi dispatch implementation for brevity in restore (assume inlining works for Const)
          // Actually, Phi dispatch is needed for Recursion exercises.
          const phi = funcVal as PhiNode;
          const dispatchPhi = (node: IRNode): IRNode | null => {
            if (node.kind === OpKind.Phi) {
              const p = node as PhiNode;
              const t = dispatchPhi(p.trueValue);
              const f = dispatchPhi(p.falseValue);
              if (!t || !f) return null;
              return { id: nextId(), kind: OpKind.Phi, type: t.type, condition: p.condition, trueValue: t, falseValue: f } as PhiNode;
            }
            if (node.kind === OpKind.Const && (node as ConstNode).value) {
              const v = (node as ConstNode).value;
              if (v.node && v.closure) return tryInlineFunc(v.node, call, v.closure);
              if (v.kind) return tryInlineFunc(v, call);
            }
            return null;
          };
          return dispatchPhi(phi);
        }
        if (funcVal.kind === OpKind.Const && (funcVal as ConstNode).value) {
          const v = (funcVal as ConstNode).value;
          if (v.node && v.closure) return tryInlineFunc(v.node, call, v.closure);
          if (v.kind) return tryInlineFunc(v, call);
        }
      }
      if (funcDecl) return tryInlineFunc(funcDecl, call);
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

      // Local type defs removed


      // Constant Folding
      if (left.kind === OpKind.Const && right.kind === OpKind.Const) {
        const lVal = (left as ConstNode).value;
        const rVal = (right as ConstNode).value;
        // Check types match roughly (both numbers for arith/compare)
        if (typeof lVal === 'number' && typeof rVal === 'number') {
          let resVal: any = null;
          let isBool = false;
          switch (expr.operatorToken.kind) {
            case ts.SyntaxKind.PlusToken: resVal = lVal + rVal; break;
            case ts.SyntaxKind.MinusToken: resVal = lVal - rVal; break;
            case ts.SyntaxKind.AsteriskToken: resVal = lVal * rVal; break;
            case ts.SyntaxKind.SlashToken: resVal = lVal / rVal; break;
            case ts.SyntaxKind.PercentToken: resVal = lVal % rVal; break;
            case ts.SyntaxKind.LessThanToken: resVal = lVal < rVal; isBool = true; break;
            case ts.SyntaxKind.GreaterThanToken: resVal = lVal > rVal; isBool = true; break;
            case ts.SyntaxKind.LessThanEqualsToken: resVal = lVal <= rVal; isBool = true; break;
            case ts.SyntaxKind.GreaterThanEqualsToken: resVal = lVal >= rVal; isBool = true; break;
            case ts.SyntaxKind.EqualsEqualsToken: resVal = lVal == rVal; isBool = true; break;
            case ts.SyntaxKind.ExclamationEqualsToken: resVal = lVal != rVal; isBool = true; break;
            case ts.SyntaxKind.EqualsEqualsEqualsToken: resVal = lVal === rVal; isBool = true; break;
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: resVal = lVal !== rVal; isBool = true; break;
          }
          if (resVal !== null) {
            return {
              id: nextId(),
              kind: OpKind.Const,
              type: isBool ? BOOLEAN_TYPE : NUMBER_TYPE,
              value: resVal
            } as ConstNode;
          }
        }
      }

      let op: any = '?';
      switch (expr.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: op = '+'; break;
        case ts.SyntaxKind.MinusToken: op = '-'; break;
        case ts.SyntaxKind.AsteriskToken: op = '*'; break;
        case ts.SyntaxKind.SlashToken: op = '/'; break;
        case ts.SyntaxKind.LessThanToken: op = '<'; break;
        case ts.SyntaxKind.GreaterThanToken: op = '>'; break;
        case ts.SyntaxKind.LessThanEqualsToken: op = '<='; break;
        case ts.SyntaxKind.GreaterThanEqualsToken: op = '>='; break;
        case ts.SyntaxKind.EqualsEqualsToken: op = '=='; break;
        case ts.SyntaxKind.ExclamationEqualsToken: op = '!='; break;
      }
      return { id: nextId(), kind: OpKind.Binary, type: NUMBER_TYPE, op, left, right } as BinaryNode;
    }

    case ts.SyntaxKind.PostfixUnaryExpression:
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const expr = node as (ts.PostfixUnaryExpression | ts.PrefixUnaryExpression);
      const operand = expr.operand;
      const val = compileNode(operand, ctx);
      if (!val) return null;

      if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
        if (operand.kind === ts.SyntaxKind.Identifier) {
          const name = (operand as ts.Identifier).text;
          // Evaluate new value
          if (val.kind === OpKind.Const && typeof (val as ConstNode).value === 'number') {
            const v = (val as ConstNode).value;
            const nextV = (expr.operator === ts.SyntaxKind.PlusPlusToken) ? v + 1 : v - 1;
            const nextNode = { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: nextV } as ConstNode;
            ctx.scope.assign(name, nextNode);

            return node.kind === ts.SyntaxKind.PrefixUnaryExpression ? nextNode : val;
          } else {
            // Runtime increment not supported fully in this minimal Const folding compiler yet?
            // Or generate OpKind.Binary + Assign?
            // Let's stick to Const folding for unrolling first.
            console.warn("Runtime increment not supported in unrolling:", expr.getText());
          }
        }
      }
      return val;
    }

    case ts.SyntaxKind.ParenthesizedExpression: return compileNode((node as ts.ParenthesizedExpression).expression, ctx);

    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = node as ts.ObjectLiteralExpression;
      const fields: Record<string, IRNode> = {};
      const fieldTypes: Record<string, DataType> = {};
      let allConst = true;
      for (const prop of obj.properties) {
        if (prop.kind === ts.SyntaxKind.PropertyAssignment) {
          const name = (prop.name as ts.Identifier).text;
          const val = compileNode(prop.initializer, ctx);
          if (val) {
            fields[name] = val;
            fieldTypes[name] = val.type;
            if (val.kind !== OpKind.Const) allConst = false;
          }
        }
      }
      if (allConst) {
        const valObj: any = {};
        for (const k in fields) valObj[k] = (fields[k] as ConstNode).value;
        return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Struct, fields: fieldTypes }, value: valObj } as ConstNode;
      }
      return { id: nextId(), kind: OpKind.Struct, type: { kind: DataTypeKind.Struct, fields: fieldTypes }, fields } as StructNode;
    }

    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = node as ts.ArrayLiteralExpression;
      const elements: IRNode[] = [];
      let elementType: DataType = ANY_TYPE;
      let allConst = true;
      for (const elem of arr.elements) {
        const val = compileNode(elem, ctx);
        if (val) {
          elements.push(val);
          if (elements.length === 1) elementType = val.type;
          if (val.kind !== OpKind.Const) allConst = false;
        }
      }
      if (allConst) {
        const valArr = elements.map(e => (e as ConstNode).value);
        if (elementType.kind === DataTypeKind.Any && valArr.length > 0) {
          const firstT = getPrimitiveType(valArr[0]);
          if (firstT) elementType = { kind: DataTypeKind.Array, elementType: firstT } as any; // Wait, type IS Array. elementType is internal.
          if (firstT) elementType = firstT;
        }
        return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Array, elementType }, value: valArr } as ConstNode;
      }
      return { id: nextId(), kind: OpKind.Array, type: { kind: DataTypeKind.Array, elementType }, elements } as ArrayNode;
    }

    case ts.SyntaxKind.PropertyAccessExpression: {
      const prop = node as ts.PropertyAccessExpression;
      const obj = compileNode(prop.expression, ctx);
      const name = prop.name.text;
      if (!obj) return null;

      // Constant Folding for Structs
      if (obj.kind === OpKind.Struct) {
        const struct = obj as StructNode;
        if (struct.fields[name]) return struct.fields[name];
      }

      // Constant Folding for Const Objects
      if (obj.kind === OpKind.Const && typeof (obj as ConstNode).value === 'object' && (obj as ConstNode).value !== null) {
        const val = (obj as ConstNode).value[name];
        if (val !== undefined) {
          const type = getPrimitiveType(val) || ANY_TYPE;
          return { id: nextId(), kind: OpKind.Const, type, value: val } as ConstNode;
        }
      }

      return { id: nextId(), kind: OpKind.PropAccess, type: ANY_TYPE, object: obj, property: name } as PropAccessNode;
    }

    case ts.SyntaxKind.ElementAccessExpression: {
      const access = node as ts.ElementAccessExpression;
      const obj = compileNode(access.expression, ctx);
      const index = compileNode(access.argumentExpression, ctx);
      if (!obj || !index) return null;

      // Constant Folding for Arrays
      const idxConst = index.kind === OpKind.Const ? (index as ConstNode).value : undefined;
      if (typeof idxConst === 'number') {
        if (obj.kind === OpKind.Array) {
          const arr = obj as ArrayNode;
          if (arr.elements[idxConst]) return arr.elements[idxConst];
        }
        if (obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
          const val = (obj as ConstNode).value[idxConst];
          if (val !== undefined) {
            const type = getPrimitiveType(val) || ANY_TYPE;
            return { id: nextId(), kind: OpKind.Const, type, value: val } as ConstNode;
          }
        }
      }

      return { id: nextId(), kind: OpKind.IndexAccess, type: ANY_TYPE, object: obj, index } as any;
      // Using PropAccess for now or creating generic call?
      // IR Types has 'PropAccess'. Does it support dynamic index? No, 'property' key is string.
      // We might need an 'IndexAccess' OpKind or 'ArrayAccess'.
      // For now, let's leave runtime indexing as limitation or map to Intrinsic?
      // "Intrinsic: Array.get"?
      // Ex 6 uses `signal[i-1]`.
      // If `i` is loop variable, it's Const during unrolling.
      // So Constant Folding path will hit.
      // We just need to ensure `index` folds to Const.

      // If not constant index, we can't represent it with PropAccess(string).
      // We need OpKind.ArrayAccess?
      // IR Types: ArrayNode, StructNode... No ArrayAccess.
      // Maybe use Intrinsic?
      return {
        id: nextId(),
        kind: OpKind.Intrinsic,
        type: ANY_TYPE,
        library: 'Array',
        method: 'get',
        args: [obj, index]
      } as IntrinsicNode;
    }

    case ts.SyntaxKind.FunctionDeclaration: {
      const decl = node as ts.FunctionDeclaration;
      if (decl.name) ctx.scope.declareFunction(decl.name.text, decl);
      return { id: nextId(), kind: OpKind.Const, type: VOID_TYPE, value: null } as ConstNode;
    }

    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression: {
      const func = node as ts.FunctionLikeDeclaration;
      // Capture closure
      return {
        id: nextId(),
        kind: OpKind.Const,
        type: ANY_TYPE,
        value: { node: func, closure: ctx.scope.snapshot() }
      } as ConstNode;
    }

    case ts.SyntaxKind.ReturnStatement: {
      const ret = node as ts.ReturnStatement;
      let value: IRNode | null = null;
      if (ret.expression) value = compileNode(ret.expression, ctx);
      return { id: nextId(), kind: OpKind.Return, type: value?.type || VOID_TYPE, value: value || { id: 'void', kind: OpKind.Const, type: VOID_TYPE, value: null } } as ReturnNode;
    }

    case ts.SyntaxKind.IfStatement: {
      // (Simplified If Logic - assuming no recursion for brevity in restore if possible, but actually needed for Ex 12?)
      // I'll restore standard If logic.
      const ifStmt = node as ts.IfStatement;
      const condition = compileNode(ifStmt.expression, ctx);
      if (!condition) return null;
      if (condition.kind === OpKind.Const) {
        if ((condition as ConstNode).value) return compileNode(ifStmt.thenStatement, ctx);
        else return ifStmt.elseStatement ? compileNode(ifStmt.elseStatement, ctx) : { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [] } as BlockNode;
      }
      // Branching
      const parentScope = ctx.scope;
      const thenScope = parentScope.fork();
      ctx.scope = thenScope;
      const thenBlock = compileNode(ifStmt.thenStatement, ctx) as BlockNode | null;

      let elseBlock: BlockNode | null = null;
      if (ifStmt.elseStatement) {
        const elseScope = parentScope.fork();
        ctx.scope = elseScope;
        const e = compileNode(ifStmt.elseStatement, ctx);
        elseBlock = e as BlockNode;
        ctx.scope = parentScope;
        mergeScopes(parentScope, thenScope, elseScope, condition);
      } else {
        ctx.scope = parentScope;
        mergeOneWay(parentScope, thenScope, condition);
      }
      ctx.scope = parentScope;
      return { id: nextId(), kind: OpKind.If, type: VOID_TYPE, condition, thenBlock, elseBlock } as IfNode;
    }

    case ts.SyntaxKind.ForStatement: {
      // Loops need to exist!
      const loop = node as ts.ForStatement;
      if (loop.initializer) compileNode(loop.initializer, ctx);
      const statements: IRNode[] = [];
      let loops = 0;
      while (loops < 100) {
        let condVal = true;
        if (loop.condition) {
          const cond = compileNode(loop.condition, ctx);
          // console.error(`Loop ${loops} condition:`, cond?.kind, (cond as any)?.value);
          if (!cond || cond.kind !== OpKind.Const) {
            console.error("FAIL: Loop condition not constant", cond);
            if (cond && cond.kind === OpKind.Binary) {
              console.error("Binary Left:", (cond as any).left);
              console.error("Binary Right:", (cond as any).right);
            }
            if (cond && cond.kind === OpKind.Var) {
              console.error("Var:", (cond as any).name);
              const val = ctx.scope.resolveValue((cond as any).name);
              console.error("Resolved Var:", val);
            }
            throw new Error("Loop condition must be constant");
          }
          condVal = !!(cond as ConstNode).value;
        }
        if (!condVal) break;
        const body = compileNode(loop.statement, ctx);
        if (body) {
          if (body.kind === OpKind.Block) statements.push(...(body as BlockNode).statements);
          else statements.push(body);
        }
        if (loop.incrementor) {
          compileNode(loop.incrementor, ctx);
          // console.error("Compiled incrementor");
        }
        loops++;
      }
      return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode;
    }
  }
  return null;
}

// Helpers
let nodeIdCounter = 0;
function nextId() { return `ir${nodeIdCounter++}`; }
const VOID_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'void' };
const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };
const BOOLEAN_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'boolean' };
const ANY_TYPE: DataType = { kind: DataTypeKind.Any };
const GENERIC_INST = (base: string, args: DataType[]) => ({ kind: DataTypeKind.GenericInstantiation, base, args } as any);

function getPrimitiveType(val: any): PrimitiveType | null {
  if (typeof val === 'number') return NUMBER_TYPE;
  if (typeof val === 'boolean') return BOOLEAN_TYPE;
  if (typeof val === 'string') return { kind: DataTypeKind.Primitive, name: 'string' };
  return null;
}

function mergeScopes(parent: Scope, branchA: Scope, branchB: Scope, condition: IRNode): void {
  // implementation
  const distinctKeys = new Set([...branchA.values.keys(), ...branchB.values.keys()]);
  for (const key of distinctKeys) {
    const valA = branchA.values.get(key) || parent.resolveValue(key);
    const valB = branchB.values.get(key) || parent.resolveValue(key);
    if (valA && valB && valA !== valB) {
      if (valA.kind === OpKind.Const && valB.kind === OpKind.Const && (valA as ConstNode).value === (valB as ConstNode).value) {
        parent.assign(key, valA);
        continue;
      }
      const parentVal = parent.resolveValue(key);
      if (valA === parentVal && valB === parentVal) continue;
      const phi: PhiNode = { id: nextId(), kind: OpKind.Phi, type: valA.type, condition, trueValue: valA, falseValue: valB };
      parent.assign(key, phi);
    }
  }
}
function mergeOneWay(parent: Scope, branchA: Scope, condition: IRNode): void {
  const keys = new Set([...branchA.values.keys()]);
  for (const key of keys) {
    const valA = branchA.values.get(key)!;
    const parentVal = parent.resolveValue(key);
    if (valA !== parentVal && parentVal) {
      const phi: PhiNode = { id: nextId(), kind: OpKind.Phi, type: valA.type, condition, trueValue: valA, falseValue: parentVal };
      parent.assign(key, phi);
    }
  }
}

export function compileToIR(source: string, globals: Record<string, DataType> = {}): IRGraph {
  const sourceFile = ts.createSourceFile("script.ts", source, ts.ScriptTarget.Latest, true);
  const ctx = new CompilerContext();

  // Register Globals/Inputs
  for (const [name, type] of Object.entries(globals)) {
    ctx.scope.declare(name, type);
    // We must set the value to a VarNode so it resolves!
    ctx.scope.set(name, { id: nextId(), kind: OpKind.Var, type, name } as VarNode);
  }

  const statements: IRNode[] = [];

  for (const stmt of sourceFile.statements) {
    const res = compileNode(stmt, ctx);
    if (res) statements.push(res);
  }

  return { root: { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode };
}

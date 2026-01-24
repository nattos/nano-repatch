import * as ts from "typescript";
import {
  IRGraph, IRNode, OpKind, DataTypeKind, DataType, PrimitiveType,
  VarDeclNode, VarNode, BlockNode, IfNode, ReturnNode, BinaryNode, ConstNode, AssignNode, ArrayNode, StructNode, PropAccessNode
} from "./ir-types";

// ... Scope ...
class Scope {
  private variables = new Map<string, DataType>();
  private values = new Map<string, IRNode>(); // Track constant/known values
  private functions = new Map<string, ts.FunctionDeclaration>();

  constructor(public parent: Scope | null = null) { }

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

  assign(name: string, value: IRNode) {
    if (this.values.has(name)) {
      this.values.set(name, value);
      return;
    }
    if (this.parent) {
      this.parent.assign(name, value);
      return;
    }
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
  const sourceFile = ts.createSourceFile(
    "script.ts", source, ts.ScriptTarget.Latest, true
  );

  const ctx = new CompilerContext();
  const statements: IRNode[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const irNode = compileNode(node, ctx);
    if (irNode) {
      statements.push(irNode);
    }
  });

  return {
    root: {
      id: nextId(),
      kind: OpKind.Block,
      type: VOID_TYPE,
      statements
    } as BlockNode
  };
}

let nodeIdCounter = 0;
function nextId() {
  return `ir${nodeIdCounter++}`;
}

const VOID_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'void' };
const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };
const ARRAY_TYPE = (elementType: DataType, length?: number) => ({
  kind: DataTypeKind.Array, elementType, length
} as any);
const STRUCT_TYPE = (fields: Record<string, DataType>) => ({
  kind: DataTypeKind.Struct, fields
} as any);

// Helper to extract return value from a compiled node structure
function extractReturn(node: IRNode | null): IRNode | null {
  if (!node) return null;
  if (node.kind === OpKind.Return) {
    return (node as ReturnNode).value;
  }
  if (node.kind === OpKind.Block) {
    const block = node as BlockNode;
    if (block.statements.length > 0) {
      // Check last statement? Or any statement?
      // In linear block, return is usually last.
      // But we should check all for early return?
      // Simplification: Check last.
      return extractReturn(block.statements[block.statements.length - 1]);
    }
  }
  // IfNode folded cases are handled by returning the block, so covered above.
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

      return {
        id: nextId(),
        kind: OpKind.Block,
        type: VOID_TYPE,
        statements
      } as BlockNode;
    }

    case ts.SyntaxKind.InterfaceDeclaration: return null;

    case ts.SyntaxKind.FunctionDeclaration: {
      const func = node as ts.FunctionDeclaration;
      if (func.name) {
        ctx.scope.declareFunction(func.name.text, func);
      }
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

        decls.push({
          id: nextId(),
          kind: OpKind.VarDecl,
          type: VOID_TYPE,
          name,
          init
        } as VarDeclNode);
      });

      if (decls.length === 1) return decls[0];
      return {
        id: nextId(),
        kind: OpKind.Block,
        type: VOID_TYPE,
        statements: decls
      } as BlockNode;
    }

    case ts.SyntaxKind.Identifier: {
      const name = (node as ts.Identifier).text;

      const val = ctx.scope.resolveValue(name);
      if (val && val.kind === OpKind.Const) {
        return val;
      }

      const type = ctx.scope.resolve(name);
      if (!type) {
        if (name !== 'Array') {
          console.warn(`Unresolved identifier: ${name}, treating as external/any`);
        }
        return {
          id: nextId(),
          kind: OpKind.Var,
          type: { kind: DataTypeKind.Any },
          name
        } as VarNode;
      }
      return {
        id: nextId(),
        kind: OpKind.Var,
        type,
        name
      } as VarNode;
    }

    case ts.SyntaxKind.IfStatement: {
      const stmt = node as ts.IfStatement;
      const condition = compileNode(stmt.expression, ctx);
      if (!condition) throw new Error("If condition failed to compile");

      if (condition.kind === OpKind.Const) {
        const val = (condition as ConstNode).value;
        if (val) {
          return compileNode(stmt.thenStatement, ctx);
        } else {
          if (stmt.elseStatement) return compileNode(stmt.elseStatement, ctx);
          return null;
        }
      }

      let thenBlock: IRNode | null = compileNode(stmt.thenStatement, ctx);
      if (thenBlock && thenBlock.kind !== OpKind.Block) {
        thenBlock = {
          id: nextId(),
          kind: OpKind.Block,
          type: VOID_TYPE,
          statements: [thenBlock]
        } as BlockNode;
      }
      if (!thenBlock) thenBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [] } as BlockNode;

      let elseBlock: IRNode | undefined;
      if (stmt.elseStatement) {
        const compiledElse = compileNode(stmt.elseStatement, ctx);
        if (compiledElse) {
          if (compiledElse.kind !== OpKind.Block) {
            elseBlock = {
              id: nextId(),
              kind: OpKind.Block,
              type: VOID_TYPE,
              statements: [compiledElse]
            } as BlockNode;
          } else {
            elseBlock = compiledElse as BlockNode;
          }
        }
      }

      return {
        id: nextId(),
        kind: OpKind.If,
        type: VOID_TYPE,
        condition,
        thenBlock,
        elseBlock
      } as IfNode;
    }

    case ts.SyntaxKind.NumericLiteral: {
      const val = parseFloat((node as ts.NumericLiteral).text);
      return {
        id: nextId(),
        kind: OpKind.Const,
        type: NUMBER_TYPE,
        value: val
      } as ConstNode;
    }

    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = node as ts.ArrayLiteralExpression;
      const elements = arr.elements.map(e => compileNode(e, ctx)).filter(e => e !== null) as IRNode[];

      const allConst = elements.every(e => e.kind === OpKind.Const);
      if (allConst) {
        return {
          id: nextId(),
          kind: OpKind.Const,
          type: ARRAY_TYPE(elements[0]?.type || NUMBER_TYPE, elements.length),
          value: elements.map(e => (e as ConstNode).value)
        } as ConstNode;
      }

      return {
        id: nextId(),
        kind: OpKind.Array,
        type: ARRAY_TYPE(elements[0]?.type || NUMBER_TYPE, elements.length),
        elements
      } as ArrayNode;
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

          if (valNode.kind === OpKind.Const) {
            constValue[key] = (valNode as ConstNode).value;
          } else {
            allConst = false;
          }
        }
      }

      const structType = STRUCT_TYPE(fieldTypes);

      if (allConst) {
        return {
          id: nextId(),
          kind: OpKind.Const,
          type: structType,
          value: constValue
        } as ConstNode;
      }

      return {
        id: nextId(),
        kind: OpKind.Struct,
        type: structType,
        fields
      } as StructNode;
    }

    case ts.SyntaxKind.PropertyAccessExpression: {
      const prop = node as ts.PropertyAccessExpression;
      const object = compileNode(prop.expression, ctx);
      const propertyName = prop.name.text;

      if (!object) return null;

      if (object.kind === OpKind.Const) {
        const objVal = (object as ConstNode).value;
        if (objVal && typeof objVal === 'object' && propertyName in objVal) {
          const val = objVal[propertyName];
          return {
            id: nextId(),
            kind: OpKind.Const,
            type: NUMBER_TYPE,
            value: val
          } as ConstNode;
        }
      }

      return {
        id: nextId(),
        kind: OpKind.PropAccess,
        type: NUMBER_TYPE,
        object,
        property: propertyName
      } as PropAccessNode;
    }

    case ts.SyntaxKind.CallExpression: {
      const call = node as ts.CallExpression;

      // Method Calls & Static Calls
      if (call.expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
        const propMain = call.expression as ts.PropertyAccessExpression;
        const methodName = propMain.name.text;
        const obj = compileNode(propMain.expression, ctx);

        // Handle "Array.isArray(x)"
        if (methodName === 'isArray' && propMain.expression.kind === ts.SyntaxKind.Identifier && (propMain.expression as ts.Identifier).text === 'Array') {
          const arg = call.arguments[0] ? compileNode(call.arguments[0], ctx) : null;
          if (arg) {
            if (arg.kind === OpKind.Const && Array.isArray((arg as ConstNode).value)) {
              return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: 1 } as ConstNode;
            }
            if (arg.kind === OpKind.Const && !Array.isArray((arg as ConstNode).value)) {
              return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: 0 } as ConstNode;
            }
          }
          return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: 0 } as ConstNode;
        }

        if (!obj) return null;

        // --- UNROLLING .map() ---
        if (methodName === 'map' && obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
          const arrValues = (obj as ConstNode).value as any[];
          const callback = call.arguments[0];

          if (!callback || (callback.kind !== ts.SyntaxKind.ArrowFunction && callback.kind !== ts.SyntaxKind.FunctionExpression)) {
            throw new Error("Map callback must be an inline function for unrolling");
          }

          const func = callback as ts.ArrowFunction;
          const paramName = (func.parameters[0].name as ts.Identifier).text;
          const results: any[] = [];
          let resultType: DataType = NUMBER_TYPE;

          for (const val of arrValues) {
            ctx.pushScope();
            ctx.scope.set(paramName, {
              id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE /*Inference needed*/, value: val
            } as ConstNode);
            ctx.scope.declare(paramName, NUMBER_TYPE);

            let bodyRes: IRNode | null = null;
            if (func.body.kind === ts.SyntaxKind.Block) {
              // Map body should be expression ideally
            } else {
              bodyRes = compileNode(func.body, ctx);
            }

            ctx.popScope();

            if (bodyRes && bodyRes.kind === OpKind.Const) {
              results.push((bodyRes as ConstNode).value);
              resultType = bodyRes.type;
            }
          }

          if (results.length === arrValues.length) {
            return {
              id: nextId(),
              kind: OpKind.Const,
              type: ARRAY_TYPE(resultType, results.length),
              value: results
            } as ConstNode;
          }
        }

        // --- UNROLLING .reduce() ---
        if (methodName === 'reduce' && obj.kind === OpKind.Const && Array.isArray((obj as ConstNode).value)) {
          const arrValues = (obj as ConstNode).value as any[];
          const callback = call.arguments[0] as ts.ArrowFunction;
          const initialValNode = call.arguments[1] ? compileNode(call.arguments[1], ctx) : null;

          let accumulator = (initialValNode as ConstNode)?.value ?? 0;

          const accParamName = (callback.parameters[0].name as ts.Identifier).text;
          const itemParamName = (callback.parameters[1].name as ts.Identifier).text;

          for (const val of arrValues) {
            ctx.pushScope();
            ctx.scope.set(accParamName, { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: accumulator } as ConstNode);
            ctx.scope.set(itemParamName, { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: val } as ConstNode);

            const bodyRes = compileNode(callback.body, ctx);
            ctx.popScope();

            if (bodyRes && bodyRes.kind === OpKind.Const) {
              accumulator = (bodyRes as ConstNode).value;
            }
          }

          return {
            id: nextId(),
            kind: OpKind.Const,
            type: NUMBER_TYPE,
            value: accumulator
          } as ConstNode;
        }
      }

      // User Function Calls (Inline)
      if (call.expression.kind === ts.SyntaxKind.Identifier) {
        const funcName = (call.expression as ts.Identifier).text;
        const funcDecl = ctx.scope.resolveFunction(funcName);

        if (funcDecl) {
          ctx.pushScope();

          for (let i = 0; i < funcDecl.parameters.length; i++) {
            const param = funcDecl.parameters[i];
            const paramName = (param.name as ts.Identifier).text;
            const argNode = call.arguments[i] ? compileNode(call.arguments[i], ctx) : undefined;

            if (argNode) {
              ctx.scope.set(paramName, argNode);
              ctx.scope.declare(paramName, argNode.type);
            }
          }

          let result: IRNode | null = null;

          if (funcDecl.body) {
            for (const stmt of funcDecl.body.statements) {
              const compiledStmt = compileNode(stmt, ctx);
              // Attempt to extract return if we found one
              const ret = extractReturn(compiledStmt);
              if (ret) {
                result = ret;
                break;
              }
            }
          }

          ctx.popScope();
          return result;
        }
      }

      return null;
    }

    case ts.SyntaxKind.BinaryExpression: {
      const expr = node as ts.BinaryExpression;

      if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (expr.left.kind !== ts.SyntaxKind.Identifier) {
          throw new Error("Assignment target must be an identifier");
        }
        const targetName = (expr.left as ts.Identifier).text;
        const result = compileNode(expr.right, ctx);

        if (!result) return null;

        ctx.scope.assign(targetName, result);

        return {
          id: nextId(),
          kind: OpKind.Assign,
          type: VOID_TYPE,
          target: targetName,
          value: result
        } as AssignNode;
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
          case ts.SyntaxKind.SlashToken: result = lVal / rVal; break;
          case ts.SyntaxKind.GreaterThanToken: result = lVal > rVal; break;
          case ts.SyntaxKind.LessThanToken: result = lVal < rVal; break;
        }

        if (result !== null) {
          return {
            id: nextId(),
            kind: OpKind.Const,
            type: left.type,
            value: result
          } as ConstNode;
        }
      }

      let op: any = '?';
      switch (expr.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: op = '+'; break;
        case ts.SyntaxKind.MinusToken: op = '-'; break;
        case ts.SyntaxKind.AsteriskToken: op = '*'; break;
        case ts.SyntaxKind.SlashToken: op = '/'; break;
        case ts.SyntaxKind.GreaterThanToken: op = '>'; break;
      }

      return {
        id: nextId(),
        kind: OpKind.Binary,
        type: NUMBER_TYPE,
        op,
        left,
        right
      } as BinaryNode;
    }

    case ts.SyntaxKind.ReturnStatement: {
      const stmt = node as ts.ReturnStatement;
      let value: IRNode | null = null;
      if (stmt.expression) value = compileNode(stmt.expression, ctx);
      if (!value) value = { id: nextId(), kind: OpKind.Const, type: VOID_TYPE, value: undefined } as ConstNode;
      return {
        id: nextId(),
        kind: OpKind.Return,
        type: value.type,
        value
      } as ReturnNode;
    }

    default:
      return null;
  }
}

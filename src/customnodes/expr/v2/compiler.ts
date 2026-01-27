import * as ts from "typescript";
import {
  IRGraph, IRNode, OpKind, DataTypeKind, DataType, PrimitiveType,
  VarDeclNode, VarNode, BlockNode, IfNode, ReturnNode, BinaryNode, ConstNode, AssignNode, ArrayNode, StructNode, PropAccessNode, PhiNode, IntrinsicNode, StructType, WhileNode, SetPropNode, SetIndexNode, DiagnosticSeverity,
  IndexAccessNode
} from "./ir-types";
import { Scope, CompilerContext, extractReturn } from "./scope";
import { resolveGlobal, tryCompileStaticCall, tryCompileInstanceMethod } from "./stdlib";

// Scope and Context moved to scope.ts

function compileNode(node: ts.Node, ctx: CompilerContext): IRNode | null {
  ctx.depth++;
  if (ctx.depth > ctx.maxDepth) {
    if (ctx.diagnostics.length === 0 || !ctx.diagnostics[ctx.diagnostics.length - 1].message.includes('Recursion')) {
      ctx.addError(`Recursion depth exceeded (${ctx.maxDepth})`, node);
    }
    ctx.depth--;
    return null;
  }

  try {
    switch (node.kind) {
      case ts.SyntaxKind.ExpressionStatement:
        return compileNode((node as ts.ExpressionStatement).expression, ctx);

      case ts.SyntaxKind.SourceFile: {
        const sf = node as ts.SourceFile;
        const statements: IRNode[] = [];
        for (const stmt of sf.statements) {
          const s = compileNode(stmt, ctx);
          if (s) statements.push(s);
        }
        return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode;
      }

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

          const flags = ts.getCombinedNodeFlags(decl);
          const isConst = !!(flags & ts.NodeFlags.Const);

          if (decl.type) {
            type = resolveType(decl.type, ctx);
          } else if (decl.initializer) {
            init = compileNode(decl.initializer, ctx) || undefined;
            if (init) {
              type = init.type;
            }
          }

          // Initializer compilation if type was from annotation but init exists (and not processed above)
          if (decl.initializer && !init) {
            init = compileNode(decl.initializer, ctx) || undefined;
            // Only infer type from initializer if NOT explicitly annotated
            if (init && !decl.type) type = init.type;
          }

          // Aliasing Logic for 'let' (mutable) variables initialized with L-Values
          if (init && !isConst && (type.kind === DataTypeKind.Array || type.kind === DataTypeKind.Struct)) {
            // Check if init is an L-Value Expression (Reference)
            // Var, PropAccess, IndexAccess
            // Also if init is an Alias (Identifier that resolved to Alias), it is already an IRNode of that kind.
            const isLValue = init.kind === OpKind.Var ||
              init.kind === OpKind.PropAccess ||
              init.kind === OpKind.IndexAccess ||
              init.kind === OpKind.SetIndex || // Chain assignment? No.
              init.kind === OpKind.SetProp; // Chain?

            // Also special case: If init is loop variable? VarNode.

            if (isLValue) {
              // Register Alias
              ctx.scope.aliases.set(name, init);
              ctx.scope.declare(name, type); // Declare type but no VarDecl
              return; // SKIP emitting VarDecl
            }
          }

          // Top-level Uninitialized Variable -> Input Definition
          if (!init && ctx.scope.parent === null && !ctx.scope.isBranchScope) {
            // Register as Input
            ctx.declaredInputs[name] = type;
            // Register as Var in Scope (so it resolves to Input Binding/VarNode)
            ctx.scope.set(name, { id: nextId(), kind: OpKind.Var, type, name } as VarNode);
            // Do NOT emit VarDecl
            return;
          }

          // Standard Handling
          if (init) {
            if (!isConst && (type.kind === DataTypeKind.Array || type.kind === DataTypeKind.Struct)) {
              ctx.scope.set(name, { id: nextId(), kind: OpKind.Var, type, name } as VarNode);
            } else {
              ctx.scope.set(name, init);
            }
          }

          ctx.scope.declare(name, type);
          const { line } = ctx.sourceFile.getLineAndCharacterOfPosition(decl.getStart());
          decls.push({ id: nextId(), kind: OpKind.VarDecl, type, name, init, debugInfo: { line: line + 1 } } as VarDeclNode);
        });
        if (decls.length === 0) return null; // No emissions (aliased or input)
        if (decls.length === 1) return decls[0];
        return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: decls } as BlockNode;
      }

      case ts.SyntaxKind.Identifier: {
        const name = (node as ts.Identifier).text;

        // Check Alias
        const alias = ctx.scope.resolveAlias(name);
        if (alias) return { ...alias }; // Shallow copy

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
          if (name !== 'Array') {
            console.log(`Debug: Warn for ${name}`);
            ctx.addWarning(`Unresolved identifier: ${name}`, node);
          }
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
            const pType = param.type ? resolveType(param.type, ctx) : ANY_TYPE; // Inside tryInlineFunc capture ctx

            let argNode = callNode.arguments[i] ? compileNode(callNode.arguments[i], ctx) : undefined;

            if (!argNode) {
              if (param.initializer) {
                // Compile default value in current context?
                // Defaults are usually evaluated in callee scope but if simple constant ok.
                // Simplification: We compile in caller context (ctx) because we are inlining?
                // No, lexical scope of definition?
                // If it's `b = 1`, 1 is const.
                // If `b = someVar`, someVar must be resolved.
                // If closure, we should switch scope?
                // `tryInlineFunc` switches scope later.
                // We should compile default in the closure scope if possible.
                // But we are gathering args before pushing scope.
                // Let's assume defaults are simple or handle later?
                // Actually, for now, let's just use undefined for optional if no default.
                // If default exists, we try to compile it.
                // But wait, compileNode needs context.
                // Let's defer default value?
                // Or just handle `undefined` for now as requested.
                argNode = compileNode(param.initializer, ctx) || undefined;
              } else if (param.questionToken) {
                argNode = { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Primitive, name: 'undefined' }, value: undefined } as ConstNode;
              }
            }

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
              const statements: IRNode[] = [];
              for (const stmt of bodyBlock.statements) {
                const compiledStmt = compileNode(stmt, ctx);
                if (compiledStmt) statements.push(compiledStmt);
                const ret = extractReturn(compiledStmt);
                if (ret) {
                  result = ret;
                  // If we have side effects before return, we need to preserve them.
                  // But 'result' (Expression) is not a Block.
                  // Only if we return BlockNode do we preserve statements.
                  // If result is found, we assume it's the value.
                  // BUT side effects must run!
                  // Current compiler assumes pure expressions usually.
                  // For 'modify(s)', result is null.
                  break;
                }
              }
              if (!result && statements.length > 0) {
                // Void function with side effects -> Return Block
                result = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode;
              } else if (result && statements.length > 1) {
                // Side effects + Return -> Block?
                // Return BlockNode but how to represent return value?
                // C++: ({ stmt; stmt; val; }) ?
                // Or if usage is Statement context, Block is fine.
                // If usage is Expression context, we lose side effects unless we handle 'BlockExpression'.
                // For now, let's assume void functions return Block, value functions return Value.
                // If value function has side effects (stmt before return), we might lose them here
                // unless we implement Statement Expression.
                // But specifically for 'modify(s)' references (void function side effects), Block is correct.
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
            const phi = funcVal as PhiNode;
            // Recursively dispatch the call to each branch
            const dispatchPhi = (node: IRNode): IRNode | null => {
              if (node.kind === OpKind.Phi) {
                const p = node as PhiNode;
                const t = dispatchPhi(p.trueValue);
                const f = dispatchPhi(p.falseValue);
                if (!t || !f) return null;
                // Check type compatibility?
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

        ctx.addError(`Unsupported dynamic dispatch or unresolved function: ${node.getText()}`, node);
        return null;
      }

      case ts.SyntaxKind.BinaryExpression: {
        const expr = node as ts.BinaryExpression;
        if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken || expr.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
          const isCompound = expr.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken;

          // Compile Value (RHS)
          let right = compileNode(expr.right, ctx);
          if (!right) return null;

          // Helper to get read value for compound op
          const getReadValue = (lhsNode: IRNode): IRNode => {
            // We need to construct (lhsNode + right)
            // Note: lhsNode might be re-evaluated. Assuming safe for DSL usage (e.g. loops).
            return { id: nextId(), kind: OpKind.Binary, type: NUMBER_TYPE, op: '+', left: lhsNode, right } as BinaryNode; // Assuming + for now
          };

          if (expr.left.kind === ts.SyntaxKind.Identifier) {
            const targetName = (expr.left as ts.Identifier).text;
            if (isCompound) {
              // Resolve current value
              const currentVal = ctx.scope.resolveValue(targetName);
              // If not found, look up by name (VarNode)
              const lhs = currentVal || { id: nextId(), kind: OpKind.Var, type: NUMBER_TYPE, name: targetName } as VarNode;
              right = getReadValue(lhs);
            }
            ctx.scope.assign(targetName, right);
            const { line } = ctx.sourceFile.getLineAndCharacterOfPosition(expr.getStart());
            return { id: nextId(), kind: OpKind.Assign, type: VOID_TYPE, target: targetName, value: right, debugInfo: { line: line + 1 } } as AssignNode;

          } else if (expr.left.kind === ts.SyntaxKind.PropertyAccessExpression) {
            const prop = expr.left as ts.PropertyAccessExpression;
            const obj = compileNode(prop.expression, ctx);
            if (!obj) return null;
            const name = prop.name.text;

            if (isCompound) {
              // Synthesize Read: PropAccess(obj, name)
              // NOTE: obj re-evaluation risk.
              const readProp = { id: nextId(), kind: OpKind.PropAccess, type: ANY_TYPE, object: obj, property: name } as PropAccessNode;
              right = getReadValue(readProp);
            }
            if (obj.kind === OpKind.Phi) {
              ctx.addWarning('Mutation of Phi value: Reference origin is ambiguous due to control flow.', node);
            }
            return { id: nextId(), kind: OpKind.SetProp, type: VOID_TYPE, object: obj, property: name, value: right } as SetPropNode;

          } else if (expr.left.kind === ts.SyntaxKind.ElementAccessExpression) {
            const elem = expr.left as ts.ElementAccessExpression;
            const obj = compileNode(elem.expression, ctx);
            const index = compileNode(elem.argumentExpression, ctx);
            if (!obj || !index) return null;

            if (isCompound) {
              // Synthesize Read: IndexAccess(obj, index)
              // NOTE: obj/index re-evaluation risk.
              const readIndex = { id: nextId(), kind: OpKind.IndexAccess, type: ANY_TYPE, object: obj, index } as any; // Cast/Ensure interface exists??
              // IndexAccess interface exists but OpKind? Yes.
              right = getReadValue(readIndex);
            }
            if (obj.kind === OpKind.Phi) {
              ctx.addWarning('Mutation of Phi value: Reference origin is ambiguous due to control flow. Mutation will apply to audio-rate copy, not original source.', node);
            }
            return { id: nextId(), kind: OpKind.SetIndex, type: VOID_TYPE, object: obj, index, value: right } as SetIndexNode;
          } else {
            throw new Error("Assignment target must be Identifier, Property, or Element access");
          }
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
          case ts.SyntaxKind.AmpersandAmpersandToken: op = '&&'; break;
          case ts.SyntaxKind.BarBarToken: op = '||'; break;
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
              // Runtime Increment Fallback
              const op = (expr.operator === ts.SyntaxKind.PlusPlusToken) ? '+' : '-';
              const one = { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: 1 } as ConstNode;
              // val is the operand (VarNode)
              const bin = { id: nextId(), kind: OpKind.Binary, type: NUMBER_TYPE, op, left: val, right: one } as BinaryNode;

              // Assign back
              const assign = { id: nextId(), kind: OpKind.Assign, type: VOID_TYPE, target: name, value: bin, debugInfo: val.debugInfo } as AssignNode;
              // Update scope to point to result of assignment (BinaryNode) for subsequent uses
              // Actually, AssignNode -> void.
              // We should map name -> bin (the result).
              // But 'assign' node is the statement.
              // If used as expression, we need to return 'val' (old) or 'bin' (new).
              // For now return AssignNode (statement).
              ctx.scope.assign(name, bin);

              return assign;
            }
          }
        }

        // Check for standard Unary Ops
        let op = '';
        if (expr.operator === ts.SyntaxKind.MinusToken) op = '-';
        else if (expr.operator === ts.SyntaxKind.ExclamationToken) op = '!';
        else if (expr.operator === ts.SyntaxKind.TildeToken) op = '~';

        if (op) {
          // Constant Folding
          if (val.kind === OpKind.Const) {
            const v = (val as ConstNode).value;
            if (op === '-' && typeof v === 'number') return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: -v } as ConstNode;
            if (op === '!' && (typeof v === 'boolean' || typeof v === 'number')) return { id: nextId(), kind: OpKind.Const, type: BOOLEAN_TYPE, value: !v } as ConstNode;
            // Tilde usually number
            if (op === '~' && typeof v === 'number') return { id: nextId(), kind: OpKind.Const, type: NUMBER_TYPE, value: ~v } as ConstNode;
          }
          return { id: nextId(), kind: OpKind.Unary, type: val.type, op, operand: val } as any; // Cast as any if UnaryNode not imported yet locally
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
            if (firstT) elementType = firstT;
          }
          return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Array, elementType, length: valArr.length }, value: valArr } as ConstNode;
        }
        return { id: nextId(), kind: OpKind.Array, type: { kind: DataTypeKind.Array, elementType, length: elements.length }, elements } as ArrayNode;
      }

      case ts.SyntaxKind.NullKeyword: {
        return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Primitive, name: 'null' }, value: null } as ConstNode;
      }
      case ts.SyntaxKind.UndefinedKeyword: {
        return { id: nextId(), kind: OpKind.Const, type: { kind: DataTypeKind.Primitive, name: 'undefined' }, value: undefined } as ConstNode;
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

        // Resolve Type if Struct
        let type: DataType = ANY_TYPE;
        if (obj.type.kind === DataTypeKind.Struct) {
          const sType = obj.type as StructType;
          if (sType.fields[name]) type = sType.fields[name];
        }

        // Handle Array.length
        if (obj.type.kind === DataTypeKind.Array && name === 'length') {
          return {
            id: nextId(),
            kind: OpKind.Intrinsic,
            type: NUMBER_TYPE,
            library: 'Array',
            method: 'length',
            args: [obj]
          } as IntrinsicNode;
        }

        return { id: nextId(), kind: OpKind.PropAccess, type, object: obj, property: name } as PropAccessNode;
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

        // Infer Type
        let type: DataType = ANY_TYPE;
        if (obj.type.kind === DataTypeKind.Array) {
          type = (obj.type as any).elementType || ANY_TYPE;
        }

        return { id: nextId(), kind: OpKind.IndexAccess, type, object: obj, index } as IndexAccessNode;
      }

      case ts.SyntaxKind.InterfaceDeclaration: {
        const decl = node as ts.InterfaceDeclaration;
        const name = decl.name.text;
        const fields: Record<string, DataType> = {};
        decl.members.forEach(m => {
          if (ts.isPropertySignature(m) && m.name) {
            const fieldName = (m.name as ts.Identifier).text || "unknown"; // Handle non-ident?
            let fieldType = m.type ? resolveType(m.type, ctx) : ANY_TYPE;
            if (m.questionToken) {
              // Optional field -> Union(T, Undefined)
              const undefinedType: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'undefined' };
              fieldType = { kind: DataTypeKind.Union, types: [fieldType, undefinedType] };
            }
            fields[fieldName] = fieldType;
          }
        });
        const structType: StructType = { kind: DataTypeKind.Struct, name, fields };
        ctx.scope.declareType(name, structType);

        return null; // Statements processing skips null
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

      case ts.SyntaxKind.BreakStatement:
        return { id: nextId(), kind: OpKind.Break, type: VOID_TYPE } as any;

      case ts.SyntaxKind.WhileStatement: {
        const w = node as ts.WhileStatement;
        // Invalidate scopes BEFORE condition, because loop backedge affects values.
        ctx.scope.invalidateAll();

        const cond = compileNode(w.expression, ctx);
        if (!cond) return null;

        const bodyRes = compileNode(w.statement, ctx);
        let body: BlockNode;
        if (bodyRes && bodyRes.kind === OpKind.Block) body = bodyRes as BlockNode;
        else body = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: bodyRes ? [bodyRes] : [] } as BlockNode;

        // Invalidate again after loop
        ctx.scope.invalidateAll();

        return { id: nextId(), kind: OpKind.While, type: VOID_TYPE, condition: cond, body } as WhileNode;
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
        let thenRes = compileNode(ifStmt.thenStatement, ctx);
        let thenBlock: BlockNode;
        if (thenRes && thenRes.kind === OpKind.Block) thenBlock = thenRes as BlockNode;
        else thenBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: thenRes ? [thenRes] : [] } as BlockNode;

        let elseBlock: BlockNode | undefined = undefined;
        if (ifStmt.elseStatement) {
          const elseScope = parentScope.fork();
          ctx.scope = elseScope;
          const e = compileNode(ifStmt.elseStatement, ctx);
          if (e && e.kind === OpKind.Block) elseBlock = e as BlockNode;
          else elseBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: e ? [e] : [] } as BlockNode;

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
        const loop = node as ts.ForStatement;

        // Prepare Scope for Loop Variables (e.g. let i = 0)
        const parentScope = ctx.scope;
        const loopScope = parentScope.extend(); // Use extend (nested) instead of fork (branch) to allow side-effects
        ctx.scope = loopScope;

        // 1. Compile Init
        const init = loop.initializer ? compileNode(loop.initializer, ctx) : null;

        // 2. Check Condition for Constness (First Pass)
        let cond = loop.condition ? compileNode(loop.condition, ctx) : null;
        const isConst = cond && cond.kind === OpKind.Const;

        if (!isConst) {
          // --- Runtime Loop Fallback ---

          // Invalidate constants to force VarNode usage
          ctx.scope.invalidateAll();

          // Re-compile condition with invalidated scope
          const rtCond = loop.condition ? compileNode(loop.condition, ctx) : { id: nextId(), kind: OpKind.Const, type: BOOLEAN_TYPE, value: true } as ConstNode;
          const body = compileNode(loop.statement, ctx);
          const incr = loop.incrementor ? compileNode(loop.incrementor, ctx) : null;

          const whileStmts: IRNode[] = [];
          if (body) {
            if (body.kind === OpKind.Block) whileStmts.push(...(body as BlockNode).statements);
            else whileStmts.push(body);
          }
          if (incr) whileStmts.push(incr);

          const whileNode: WhileNode = {
            id: nextId(),
            kind: OpKind.While,
            type: VOID_TYPE,
            condition: rtCond!,
            body: { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: whileStmts } as BlockNode
          };

          const resultStmts: IRNode[] = [];
          if (init) resultStmts.push(init);
          resultStmts.push(whileNode);

          ctx.scope = parentScope;
          return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: resultStmts } as BlockNode;

        } else {
          // --- Unrolling Logic (Original) ---
          // Note: init already compiled inside loopScope, but unrolling logic might ignore the IR node if relying on scope state.
          // However, unrolling expects 'loops=0' start.
          // Usually initializer 'let i = 0' sets 'i' in scope to '0'.

          const statements: IRNode[] = [];

          let loops = 0;
          while (loops < 100) {
            // Re-eval condition
            const c = loop.condition ? compileNode(loop.condition, ctx) : null;
            if (c && c.kind === OpKind.Const && !(c as ConstNode).value) break;

            const body = compileNode(loop.statement, ctx);
            if (body) {
              statements.push(body);
            }
            if (loop.incrementor) {
              compileNode(loop.incrementor, ctx);
            }
            loops++;
          }
          ctx.scope = parentScope;
          return { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements } as BlockNode;
        }
      }
      default:
        // Capture unsupported syntax
        ctx.addWarning(`Unsupported syntax kind: ${ts.SyntaxKind[node.kind]}`, node);
        return null;
    }
  } finally {
    ctx.depth--;
  }
}

// Helpers
let nodeIdCounter = 0;
function nextId() { return `ir${nodeIdCounter++}`; }
// Helper to resolve TS TypeNode to DataType
function resolveType(typeNode: ts.TypeNode, ctx: CompilerContext): DataType {
  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return NUMBER_TYPE;
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return BOOLEAN_TYPE;
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return STR_TYPE;
  if (typeNode.kind === ts.SyntaxKind.VoidKeyword) return VOID_TYPE;
  if (typeNode.kind === ts.SyntaxKind.UndefinedKeyword) return { kind: DataTypeKind.Primitive, name: 'undefined' } as PrimitiveType;
  if (typeNode.kind === ts.SyntaxKind.NullKeyword) return { kind: DataTypeKind.Primitive, name: 'null' } as PrimitiveType;

  if (ts.isArrayTypeNode(typeNode)) {
    const elType = resolveType(typeNode.elementType, ctx);
    return { kind: DataTypeKind.Array, elementType: elType };
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    if (typeNode.literal.kind === ts.SyntaxKind.NullKeyword) return { kind: DataTypeKind.Primitive, name: 'null' } as PrimitiveType;
    // Other literals (true/false/numbers)
    // LiteralType in IR?
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const types = typeNode.types.map(t => resolveType(t, ctx));
    // check if just null/undefined logic?
    // flattening unions?
    return { kind: DataTypeKind.Union, types };
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    const fields: Record<string, DataType> = {};
    typeNode.members.forEach(m => {
      if (ts.isPropertySignature(m) && m.name) {
        const fieldName = (m.name as ts.Identifier).text;
        let fieldType = m.type ? resolveType(m.type, ctx) : ANY_TYPE;
        if (m.questionToken) {
          const undefinedType: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'undefined' };
          fieldType = { kind: DataTypeKind.Union, types: [fieldType, undefinedType] };
        }
        fields[fieldName] = fieldType;
      }
    });
    return { kind: DataTypeKind.Struct, fields };
  }

  // Handle TypeReference (structs, generics)
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = (typeNode.typeName as ts.Identifier).text;
    if (name === 'Array') {
      if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
        return { kind: DataTypeKind.Array, elementType: resolveType(typeNode.typeArguments[0], ctx) };
      }
    }
    // Lookup in scope
    const type = ctx.scope.resolveType(name);
    if (type) return type;
    // Fallback/Warning?
    // console.warn(`Unresolved type: ${name}`);

  }
  return ANY_TYPE;
}

const STR_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'string' }; // Need to define if not exists?
const VOID_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'void' };
const NUMBER_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'number' };
const BOOLEAN_TYPE: PrimitiveType = { kind: DataTypeKind.Primitive, name: 'boolean' };
const ANY_TYPE: DataType = { kind: DataTypeKind.Any };
const GENERIC_INST = (base: string, args: DataType[]) => ({ kind: DataTypeKind.GenericInstantiation, base, args } as any);

function getPrimitiveType(val: any): PrimitiveType | null {
  if (typeof val === 'number') return NUMBER_TYPE;
  if (typeof val === 'boolean') return BOOLEAN_TYPE;
  if (typeof val === 'string') return STR_TYPE;
  return null;
}

function mergeScopes(parent: Scope, branchA: Scope, branchB: Scope, condition: IRNode): void {
  // implementation
  const distinctKeys = new Set([...branchA.values.keys(), ...branchB.values.keys()]);
  for (const key of distinctKeys) {
    const valA = branchA.values.get(key) || parent.resolveValue(key) || parent.resolveAlias(key);
    const valB = branchB.values.get(key) || parent.resolveValue(key) || parent.resolveAlias(key);
    if (valA && valB && valA !== valB) {
      if (valA.kind === OpKind.Const && valB.kind === OpKind.Const && (valA as ConstNode).value === (valB as ConstNode).value) {
        parent.assign(key, valA);
        continue;
      }
      const parentVal = parent.resolveValue(key) || parent.resolveAlias(key);
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
    const parentVal = parent.resolveValue(key) || parent.resolveAlias(key);
    if (valA !== parentVal && parentVal) {
      const phi: PhiNode = { id: nextId(), kind: OpKind.Phi, type: valA.type, condition, trueValue: valA, falseValue: parentVal };
      parent.assign(key, phi);
    }
  }
}

export function compileToIR(src: string, globalInputs: Record<string, DataType> = {}): IRGraph {
  const sourceFile = ts.createSourceFile("expr.ts", src, ts.ScriptTarget.ES2015, true);
  const ctx = new CompilerContext(sourceFile);

  // 1. Capture TS Parser Diagnostics
  const tsDiagnostics = (sourceFile as any).parseDiagnostics || [];
  // We can try getting some info. createSourceFile is limited.
  // But syntactic errors (parsing) are available.

  for (const diag of tsDiagnostics) {
    const message = typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText; // Simplify
    // Calculate range
    let range;
    if (diag.start !== undefined && diag.length !== undefined) {
      const start = sourceFile.getLineAndCharacterOfPosition(diag.start);
      const end = sourceFile.getLineAndCharacterOfPosition(diag.start + diag.length);
      range = {
        startLineNumber: start.line + 1,
        startColumn: start.character + 1,
        endLineNumber: end.line + 1,
        endColumn: end.character + 1
      };
    }
    ctx.diagnostics.push({
      message: `TS Error: ${message}`,
      severity: DiagnosticSeverity.Error,
      source: 'ts-parser',
      range
    });
  }

  // Pre-declare Globals
  for (const [key, type] of Object.entries(globalInputs)) {
    ctx.scope.declare(key, type);
    ctx.scope.set(key, { id: nextId(), kind: OpKind.Var, type, name: key } as VarNode);
  }



  let rootBlock: BlockNode;
  try {
    const result = compileNode(sourceFile, ctx);
    if (result && result.kind === OpKind.Block) {
      rootBlock = result as BlockNode;
    } else if (result) {
      rootBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [result] } as BlockNode;
    } else {
      rootBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [] } as BlockNode;
    }
  } catch (e: any) {
    // Catch-all for compiler crashes -> Error Diagnostic
    ctx.addError(`Internal Compiler Error: ${e.message}`);
    // Return partial or empty graph
    rootBlock = { id: nextId(), kind: OpKind.Block, type: VOID_TYPE, statements: [] } as BlockNode;
  }

  // Merge Global Inputs (passed in) with Declared Inputs (from source)
  const combinedInputs = { ...globalInputs, ...ctx.declaredInputs };

  return { root: rootBlock, diagnostics: ctx.diagnostics, inputs: combinedInputs };
}

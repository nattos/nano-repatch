import * as ts from 'typescript';
import { compileToIR } from './compiler';
import { generateJS } from './codegen-js';
import { generateCPP } from './codegen-cpp';
import { generateWGSL } from './codegen-wgsl';
import { IRGraph, Diagnostic, DataType, DiagnosticSeverity, OpKind, IRNode, BlockNode, ReturnNode, IfNode, WhileNode, DataTypeKind, PrimitiveType } from './ir-types';

export interface BuildOptions {
  code: string;
  emitIR?: boolean;
  emitJS?: boolean;
  emitJSRunner?: boolean;
  emitWGSL?: boolean;
  emitCPP?: boolean;

  outputType?: DataType; // For coercion (JS) or return type (CPP)
  debug?: 'none' | 'only' | 'both'; // Debug instrumentation control
  autoInputs?: boolean; // Automatically define unresolved vars as number inputs
  containerMode?: 'expression-like' | 'function-body';  // Implicit return support

  // Pass-through options
  globalInputs?: Record<string, any>;
}

export type BuildResult<T extends BuildOptions> = {
  outIR: T['emitIR'] extends true ? { graph: IRGraph } : undefined;

  outJS: T['emitJS'] extends true ? {
    code: T['debug'] extends 'only' ? undefined : string;
    debugCode: T['debug'] extends 'only' | 'both' ? string : undefined;
  } : undefined;

  outJSRunner: T['emitJSRunner'] extends true ? {
    runner: T['debug'] extends 'only' ? undefined : (inputs: any, debug?: any) => any;
    debugRunner: T['debug'] extends 'only' | 'both' ? (inputs: any, debug?: any) => any : undefined;
  } : undefined;

  outWGSL: T['emitWGSL'] extends true ? {
    code: T['debug'] extends 'only' ? undefined : string;
    debugCode: T['debug'] extends 'only' | 'both' ? string : undefined;
  } : undefined;

  outCPP: T['emitCPP'] extends true ? {
    code: T['debug'] extends 'only' ? undefined : string;
    debugCode: T['debug'] extends 'only' | 'both' ? string : undefined;
  } : undefined;

  diagnostics: Diagnostic[];
  injectedInputs?: string[]; // Names of auto-injected inputs

  // Reflection Data (Always Available)
  inputs: Record<string, DataType>;
  output: DataType;
};

export function buildCode<T extends BuildOptions>(opts: T): BuildResult<T> {
  // Capture diagnostics
  let diagnostics: Diagnostic[] = [];
  let currentCode = opts.code;
  let injectedInputs: string[] = [];

  // 0. Pre-process code for Container Mode (Implicit Return)
  if (opts.containerMode === 'expression-like') {
    const sf = ts.createSourceFile('temp.ts', currentCode, ts.ScriptTarget.Latest, true);
    if (sf.statements.length > 0) {
      const lastStmt = sf.statements[sf.statements.length - 1];
      if (ts.isExpressionStatement(lastStmt)) {
        // Safe wrapping strategy: return (<expr>);
        const expr = lastStmt.expression;
        // Use getStart/getEnd to extract the exact expression text, avoiding semicolons
        const exprStart = expr.getStart(sf);
        const exprEnd = expr.getEnd();

        // Splice: ... prev code ... return ( <expr> ); ... potential trailing semicolon/comments ...
        // Note: We need to preserve original text for source maps/debug lines if possible,
        // but robust return wrapping involves new text.
        // We replace the statement range with the wrapped version.
        // Actually, we can just replace the expression part with "return (...)".
        // But what if there's a semicolon after?
        // "x + 1;" -> "return (x + 1);"
        // "x + 1"  -> "return (x + 1)"
        // It's safest to construct: code_before + "return (" + expr_text + ");" + code_after
        // The lastStmt end might include a semicolon.

        const before = currentCode.slice(0, exprStart);
        const exprText = currentCode.slice(exprStart, exprEnd);
        const after = currentCode.slice(lastStmt.getEnd());

        // We might lose the original semicolon if we just ignore what's between exprEnd and lastStmt.getEnd().
        // That's fine, we explicitly add one inside the wrapper.
        // But comments? sourceFile parsing usually attaches them.

        currentCode = before + 'return (' + exprText + ');' + after;
      }
    }
  }

  // 1. Initial Compile
  let ir = compileToIR(currentCode, {});

  // 2. Auto-Inputs Logic (Retry Loop)
  if (opts.autoInputs && ir.diagnostics) {
    const unresolvedVars = new Set<string>();

    // Scan for "Unresolved identifier: X"
    for (const diag of ir.diagnostics) {
      const match = diag.message.match(/Unresolved identifier: (\w+)/);
      if (match) {
        unresolvedVars.add(match[1]);
      }
    }

    if (unresolvedVars.size > 0) {
      const newDecls: string[] = [];
      for (const v of unresolvedVars) {
        // Enforce 'number' type as per user request
        newDecls.push(`var ${v}: number;`);
        injectedInputs.push(v);
      }

      if (newDecls.length > 0) {
        // Prepend new declarations
        currentCode = newDecls.join('\n') + '\n' + currentCode;

        // RE-COMPILE
        ir = compileToIR(currentCode, {});
      }
    }
  }

  if (ir.diagnostics) {
    diagnostics.push(...ir.diagnostics);
  }

  const result: any = { diagnostics };
  if (injectedInputs.length > 0) {
    result.injectedInputs = injectedInputs;
  }

  if (opts.emitIR) {
    result.outIR = { graph: ir };
  }

  // Common inputs from IR (merged source + global)
  const inputs: Record<string, DataType> = { ...(ir.inputs || {}) };

  // Ensure injected inputs are treated as inputs
  for (const name of injectedInputs) {
    if (!inputs[name]) {
      inputs[name] = { kind: DataTypeKind.Primitive, name: 'number' } as PrimitiveType;
    }
  }

  result.inputs = inputs;
  result.output = (ir.root && inferReturnType(ir.root)) || { kind: 'primitive', name: 'void' } as any;

  const mode = opts.debug || 'none';
  const genClean = mode === 'none' || mode === 'both';
  const genDebug = mode === 'only' || mode === 'both';

  if (opts.emitJS || opts.emitJSRunner) {
    try {
      const out: any = {};
      const outRunner: any = {};

      // Clean Pass
      if (genClean) {
        const jsCode = generateJS(ir, {
          inputs,
          checkInputs: true,
          outputType: opts.outputType,
          debug: false
        });
        if (opts.emitJS) out.code = jsCode;
        if (opts.emitJSRunner) {
          const body = jsCode.replace('module.exports = { compute };', 'return compute;');
          outRunner.runner = new Function(body)();
        }
      }

      // Debug Pass
      if (genDebug) {
        const jsDebug = generateJS(ir, {
          inputs,
          checkInputs: true,
          outputType: opts.outputType,
          debug: true
        });
        if (opts.emitJS) out.debugCode = jsDebug;
        if (opts.emitJSRunner) {
          const body = jsDebug.replace('module.exports = { compute };', 'return compute;');
          outRunner.debugRunner = new Function(body)();
        }
      }

      if (opts.emitJS) result.outJS = out;
      if (opts.emitJSRunner) result.outJSRunner = outRunner;

    } catch (e: any) {
      diagnostics.push({ message: `JS Codegen Error: ${e.message}`, severity: DiagnosticSeverity.Error, source: 'codegen-js' });
    }
  }

  if (opts.emitWGSL) {
    try {
      // WGSL doesn't support debug instrumentation yet, so code == debugCode effectively.
      // But adhering to interface:
      const wgslCode = generateWGSL(ir, { inputs, outputType: opts.outputType });
      const out: any = {};

      if (genClean) out.code = wgslCode;
      if (genDebug) out.debugCode = wgslCode; // Duplicate for now

      result.outWGSL = out;
    } catch (e: any) {
      diagnostics.push({ message: `WGSL Codegen Error: ${e.message}`, severity: DiagnosticSeverity.Error, source: 'codegen-wgsl' });
    }
  }

  if (opts.emitCPP) {
    try {
      const out: any = {};

      if (genClean) {
        out.code = generateCPP(ir, {
          inputs,
          outputType: opts.outputType,
          debug: false
        });
      }

      if (genDebug) {
        out.debugCode = generateCPP(ir, {
          inputs,
          outputType: opts.outputType,
          debug: true
        });
      }

      result.outCPP = out;

    } catch (e: any) {
      diagnostics.push({ message: `CPP Codegen Error: ${e.message}`, severity: DiagnosticSeverity.Error, source: 'codegen-cpp' });
    }
  }

  return result;
}

function inferReturnType(node: IRNode): DataType | null {
  if (node.kind === OpKind.Return) {
    return (node as ReturnNode).value.type;
  }
  if (node.kind === OpKind.Block) {
    const block = node as BlockNode;
    for (const stmt of block.statements) {
      const t = inferReturnType(stmt);
      if (t) return t;
    }
  }
  if (node.kind === OpKind.If) {
    const ifNode = node as IfNode;
    const t = inferReturnType(ifNode.thenBlock);
    if (t) return t;
    if (ifNode.elseBlock) {
      return inferReturnType(ifNode.elseBlock);
    }
  }
  if (node.kind === OpKind.While) {
    return inferReturnType((node as WhileNode).body);
  }
  return null;
}

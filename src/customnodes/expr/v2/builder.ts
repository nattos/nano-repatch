import { compileToIR } from './compiler';
import { generateJS } from './codegen-js';
import { generateCPP } from './codegen-cpp';
import { generateWGSL } from './codegen-wgsl';
import { IRGraph, Diagnostic, DataType, DiagnosticSeverity } from './ir-types';

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
};

export function buildCode<T extends BuildOptions>(opts: T): BuildResult<T> {
  // Capture diagnostics
  let diagnostics: Diagnostic[] = [];
  let currentCode = opts.code;
  let injectedInputs: string[] = [];

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
  const inputs: Record<string, DataType> = ir.inputs || {};

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

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
};

export function buildCode<T extends BuildOptions>(opts: T): BuildResult<T> {
  // Capture diagnostics
  let diagnostics: Diagnostic[] = [];

  // 1. Compile to IR
  const ir = compileToIR(opts.code, {});
  if (ir.diagnostics) {
    diagnostics.push(...ir.diagnostics);
  }

  const result: any = { diagnostics };

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

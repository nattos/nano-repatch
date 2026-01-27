import { compileToIR } from './compiler';
import { generateJS } from './codegen-js';
import { generateCPP } from './codegen-cpp';
import { generateWGSL } from './codegen-wgsl';
import { IRGraph, Diagnostic, DataType } from './ir-types';

export interface BuildOptions {
  code: string;
  emitIR?: boolean;
  emitJS?: boolean;
  emitJSRunner?: boolean;
  emitWGSL?: boolean;
  emitCPP?: boolean;

  outputType?: DataType; // For coercion (JS) or return type (CPP)
  debug?: boolean; // Enable debug instrumentation

  // Pass-through options
  globalInputs?: Record<string, any>;
}

export type BuildResult<T extends BuildOptions> = {
  outIR: T['emitIR'] extends true ? { graph: IRGraph } : undefined;
  outJS: T['emitJS'] extends true ? { code: string } : undefined;
  outJSRunner: T['emitJSRunner'] extends true ? { runner: (inputs: any, debug?: any) => any } : undefined;
  outWGSL: T['emitWGSL'] extends true ? { code: string } : undefined;
  outCPP: T['emitCPP'] extends true ? { code: string } : undefined;
  diagnostics: Diagnostic[];
};

export function buildCode<T extends BuildOptions>(opts: T): BuildResult<T> {
  // Capture diagnostics
  let diagnostics: Diagnostic[] = [];

  // 1. Compile to IR
  // We default to empty global inputs for now, assuming source verification.
  // TODO: Allow passing input types in options?
  const ir = compileToIR(opts.code, {});
  diagnostics.push(...ir.diagnostics);

  const result: any = { diagnostics };

  if (opts.emitIR) {
    result.outIR = { graph: ir };
  }

  // Common inputs from IR (merged source + global)
  const inputs = ir.inputs;

  if (opts.emitJS || opts.emitJSRunner) {
    try {
      const jsCode = generateJS(ir, {
        inputs,
        checkInputs: true,
        outputType: opts.outputType,
        debug: opts.debug
      });

      if (opts.emitJS) {
        result.outJS = { code: jsCode };
      }

      if (opts.emitJSRunner) {
        const body = jsCode.replace('module.exports = { compute };', 'return compute;');
        const factory = new Function(body);
        const runner = factory();
        result.outJSRunner = { runner };
      }
    } catch (e: any) {
      diagnostics.push({ message: `JS Codegen Error: ${e.message}`, severity: 1, source: 'codegen-js' });
    }
  }

  if (opts.emitWGSL) {
    try {
      const wgslCode = generateWGSL(ir, { inputs, outputType: opts.outputType });
      result.outWGSL = { code: wgslCode };
    } catch (e: any) {
      diagnostics.push({ message: `WGSL Codegen Error: ${e.message}`, severity: 1, source: 'codegen-wgsl' });
    }
  }

  if (opts.emitCPP) {
    try {
      const cppCode = generateCPP(ir, {
        inputs,
        outputType: opts.outputType,
        debug: opts.debug
      });
      result.outCPP = { code: cppCode };
    } catch (e: any) {
      diagnostics.push({ message: `CPP Codegen Error: ${e.message}`, severity: 1, source: 'codegen-cpp' });
    }
  }

  return result;
}


import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { AnyType, NumberType, StringType } from "../../structor/type-helpers";
import { NodeCategory, StructorType } from "../../structor/structor";
import { anyType, numberType } from "../../structor/std-types";

// Import Types Only (to avoid bundling heavy compilers)
import type { buildCode } from "./v2/builder";
import { Diagnostic, DiagnosticSeverity } from "./v2/ir-types";
import { CompileContext } from "../../structor/structor";

// Wrapper for Lazy Loaded Builder
let builderWrapper: { buildCode: typeof buildCode } | null = null;

const ExpressionFields: InspectorFieldDef[] = [
  { type: 'string', label: 'Expression', path: 'code', placeholder: 'e.g. sin(time) * 0.5' }
];

interface ExpressionConfig {
  code: string;
}

interface CompiledExpression {
  jsCode?: string;
  diagnostics: Diagnostic[];
}

interface ExpressionState {
  runner?: (inputs: any) => any;
  lastCode?: string;
}

// Remove generics to let inference work or use implicit casting
export const expressionNode = defineNode({
  id: "logic.expression",
  version: "2.0.0",
  displayName: "Expression",
  metadata: {
    category: NodeCategory.Logic,
    keywords: ['expression', 'math', 'script', 'code'],
    description: 'Evaluates a mathematical expression (V2).'
  },
  inputs: {}, // Inputs are dynamic
  config: {
    jsCode: { ...StringType, optional: true },
    // Forward inputs/outputs through compiled config
    inputs: { kind: 'record', fields: {}, optional: true } as any,
    outputs: { kind: 'record', fields: {}, optional: true } as any,
    diagnostics: { kind: 'atomic', type: 'any', optional: true } as any // Diagnostics array
  },
  outputs: {
    result: AnyType
  },
  autoBroadcast: false, // We handle raw inputs (autoInputs handles broadcasting internally via V2 if needed, but here we just pass raw)
  ui: { inspector: { fields: ExpressionFields } },

  // Lazy Load the heavy builder (TypeScript)
  loadCompileDeps: async () => {
    if (!builderWrapper) {
      // Dynamic import of the V2 builder
      const module = await import('./v2/builder');
      builderWrapper = { buildCode: module.buildCode };
    }
  },

  shouldRecompileOnConfigChange: (config: any) => {
    return true;
  },

  compileConfig: (uiConfig: any, context?: CompileContext) => {
    const code = uiConfig.code || '';
    const cacheKey = `expr_v2_1:${code}`; // Version 1 of cache schema

    // Try Cache
    if (context && context.compileCache && context.compileCache.has(cacheKey)) {
      // console.log('Expr Cache HIT', cacheKey);
      return context.compileCache.get(cacheKey);
    }

    if (!builderWrapper) {
      return {
        jsCode: undefined,
        diagnostics: [{
          message: "Compiler not loaded. Please wait...",
          severity: DiagnosticSeverity.Warning,
          source: "system"
        }],
        inputs: {},
        outputs: {}
      };
    }

    try {
      // Single pass: emit JS and discover inputs
      const res = builderWrapper.buildCode({
        code,
        emitJS: true,
        autoInputs: true,
        containerMode: 'expression-like'
      });

      const hasErrors = res.diagnostics.some(d => d.severity === 'error'); // Fixed check

      // Map detected inputs to StructorType
      const inputs: Record<string, StructorType> = {};
      for (const [name, type] of Object.entries(res.inputs)) {
        let structorType = anyType;
        if (type.kind === 'primitive' && type.name === 'number') {
          structorType = numberType as any;
        }
        inputs[name] = { ...structorType, description: `Variable ${name}` };
      }

      const outputs = { result: { ...anyType, description: 'Result' } };

      const compiledConfig = {
        jsCode: hasErrors ? undefined : res.outJS?.code,
        diagnostics: res.diagnostics,
        inputs,
        outputs
      };

      // Store in Cache
      if (context && context.compileCache) {
        context.compileCache.set(cacheKey, compiledConfig);
      }

      return compiledConfig;
    } catch (e) {
      return {
        jsCode: undefined,
        diagnostics: [{
          message: `Internal Compiler Error: ${e}`,
          severity: DiagnosticSeverity.Error,
          source: "compiler"
        }],
        inputs: {},
        outputs: {}
      };
    }
  },

  computeForwardPorts: (inputTypes, config: any) => {
    // The "config" here is the COMPILED config returned by compileConfig.
    // We rely on compileConfig having populated the port definitions.

    const inputs = (config && config.inputs) ? config.inputs : {};
    const outputs = (config && config.outputs) ? config.outputs : { result: anyType };

    return {
      inputs: { kind: 'record', fields: inputs },
      outputs: { kind: 'record', fields: outputs }
    };
  },

  createState: () => ({}),

  syncUIFromCompiledConfig: (compiledConfig: any, uiState: any) => {
    uiState.diagnostics = compiledConfig.diagnostics || [];
    uiState.jsCode = compiledConfig.jsCode;
  },

  execute: (inputs, config: any, context, state: any) => {
    if (!config.jsCode) {
      return { result: 0 };
    }

    if (!state) return { result: 0 };

    // Cache runner in state
    if (state.lastCode !== config.jsCode || !state.runner) {
      try {
        // Replace export with return to get the function instance.
        // Use regex to handle potential whitespace variations.
        const body = config.jsCode.replace(/module\.exports\s*=\s*{\s*compute\s*};?;?/, 'return compute;');
        const factory = new Function(body);
        state.runner = factory() as (inputs: any) => any;
        state.lastCode = config.jsCode;
      } catch (e) {
        console.error("Failed to compile runner:", e);
        return { result: null };
      }
    }

    // Execute
    try {
      // Handle dynamic inputs (node-helpers passes raw Structor if inputs definition is empty)
      const realInputs = (inputs as any).fields ? (inputs as any).fields : inputs;
      const result = state.runner!(realInputs);
      return { result };
    } catch (e) {
      console.error("Runtime error:", e);
      return { result: null };
    }
  },

});

registerNode(expressionNode);

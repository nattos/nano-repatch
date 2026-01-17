import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { AnyType, NumberType, StringType } from "../../structor/type-helpers";
// Use the executor-only import for the worker bundle
import { ExpressionExecutor } from "./expr-executor";
import type { ExecutionGraph } from "./expr-types";
import { NodeCategory, StructorType } from "../../structor/structor";
import { anyType, numberType } from "../../structor/std-types";

// Import Type for Compiler (but not the value)
import type { GraphCompiler } from "./expr-compiler";

// Singleton instances
let compilerWrapper: { compiler: GraphCompiler } | null = null;
const executor = new ExpressionExecutor();

// Cache for compiled graphs
const graphCache = new Map<string, ExecutionGraph>();

function getCompiledGraph(code: string): ExecutionGraph {
  if (graphCache.has(code)) {
    return graphCache.get(code)!;
  }

  // If compiler is not loaded, we can't compile new code.
  // Ideally this should not happen if loadCompileDeps is called correctly.
  if (!compilerWrapper) {
    console.warn("Expression Compiler not loaded yet. Returning empty graph.");
    return { nodes: {}, rootId: null };
  }

  try {
    const graph = compilerWrapper.compiler.compile(code);
    graphCache.set(code, graph);
    return graph;
  } catch (e) {
    console.error("Compilation failed:", e);
    return { nodes: {}, rootId: null };
  }
}

const ExpressionFields: InspectorFieldDef[] = [
  { type: 'string', label: 'Expression', path: 'code', placeholder: 'e.g. sin(time) * 0.5' }
];

export const expressionNode = defineNode({
  id: "logic.expression",
  version: "1.0.0",
  displayName: "Expression",
  metadata: {
    category: NodeCategory.Logic,
    keywords: ['expression', 'math', 'script', 'code'],
    description: 'Evaluates a mathematical expression.'
  },
  inputs: {}, // Inputs are dynamic
  config: {
    code: StringType,
    graph: AnyType // Preserved for execution
  },
  outputs: {
    result: AnyType
  },
  autoBroadcast: false, // We handle raw inputs
  ui: { inspector: { fields: ExpressionFields } },

  // Lazy Load the heavy compiler (TypeScript)
  loadCompileDeps: async () => {
    if (!compilerWrapper) {
      // Dynamic import of the compilation logic (which imports typescript)
      const module = await import('./expr-compiler');
      compilerWrapper = { compiler: new module.GraphCompiler() };
    }
  },

  compileConfig: (uiConfig: { code?: string }) => {
    const code = uiConfig.code || '';
    // Compile code to graph
    const graph = getCompiledGraph(code);
    return {
      code: code,
      // Embed the graph in the config so the executor has it without recompiling
      graph: graph as any
    };
  },
  computeForwardPorts: (inputTypes, uiConfig) => {
    const code = uiConfig.code || '';
    const graph = getCompiledGraph(code);

    // Find all input nodes
    const inputNames = new Set<string>();
    for (const node of Object.values(graph.nodes)) {
      if (node.op === 'input') {
        inputNames.add(node.params.key);
      }
    }

    const inputs: Array<[string, StructorType]> = Array.from(inputNames).map(name =>
      [name, {
        ...numberType, // Assume numbers for math expressions
        description: `Variable ${name}`
      }]);

    return {
      inputs: { kind: 'record', fields: Object.fromEntries(inputs) },
      outputs: { kind: 'record', fields: { result: { ...anyType, description: 'Result' } } }
    };
  },
  execute: (inputs, config, context) => {
    // The executor worker receives the Compiled config.
    // So config.graph should be present.
    const graph = config.graph;

    if (!graph || !graph.rootId) {
      // Fallback or empty
      return { result: 0 };
    }

    // Prepare inputs
    const exprInputs: Record<string, any> = { ...(inputs as any) };

    try {
      const result = executor.execute(graph, exprInputs.fields || exprInputs); // Handle both wrapped and raw?
      return { result: result };
    } catch (e) {
      console.error("Execution failed:", e);
      return { result: null };
    }
  },

});

registerNode(expressionNode);

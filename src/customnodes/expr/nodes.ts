import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { AnyType } from "../../structor/type-helpers";
import { GraphCompiler, ExpressionExecutor, ExecutionGraph } from "./parser";
import { NodeCategory } from "../../structor/structor";
import { PortHint } from "../../structor/repository";

// Singleton instances for compilation and execution
const compiler = new GraphCompiler();
const executor = new ExpressionExecutor();

// Cache for compiled graphs to avoid re-compiling the same code
const graphCache = new Map<string, ExecutionGraph>();

function getCompiledGraph(code: string): ExecutionGraph {
  if (graphCache.has(code)) {
    return graphCache.get(code)!;
  }
  try {
    const graph = compiler.compile(code);
    graphCache.set(code, graph);
    return graph;
  } catch (e) {
    console.error("Compilation failed:", e);
    // Return empty graph or handle error
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
    code: { kind: 'atomic', type: 'string' },
    graph: AnyType // Preserved for execution
  },
  outputs: {
    result: AnyType
  },
  autoBroadcast: false, // We handle raw inputs
  ui: { inspector: { fields: ExpressionFields } },
  compileConfig: (uiConfig) => {
    const code = uiConfig.code || '';
    // Compile code to graph
    const graph = getCompiledGraph(code);
    return {
      fields: {
        code: code,
        // Embed the graph in the config so the executor has it without recompiling
        graph: graph as any
      },
      untagged: []
    };
  },
  execute: (inputs, config, context) => {
    // The executor worker receives the Compiled config.
    // So config.fields.graph should be present.
    // We cast config to any because TypeScript thinks it's the raw config type, but compileConfig transformed it.
    // AND definePrimitiveNode UNWRAPS the config before calling us. So we get the plain object.
    const graph = (config as { graph: ExecutionGraph | undefined }).graph;

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
  // Dynamic ports based on compiled graph
  compilePorts: (node, context) => {
    // Use the cached compiled config if available (from worker)
    // Or fallback to parsing if necessary (but prefer cache)
    const compiledConfig = context.compiledConfig;
    let graph: ExecutionGraph | null = null;

    if (compiledConfig && compiledConfig.fields && compiledConfig.fields.graph) {
      graph = compiledConfig.fields.graph;
    } else {
      // Fallback: Check local cache or compile on the fly (main thread)
      // This ensures ports (and wires) don't disappear before worker returns.
      // But we rely on graphCache to make it fast if repeated.
      const code = node.config.code || '';
      if (!code.trim()) {
        return { inputs: [], outputs: [{ name: 'result', type: AnyType }] };
      }
      graph = getCompiledGraph(code);
    }

    if (!graph) return { inputs: [], outputs: [{ name: 'result', type: AnyType }] };

    try {
      const inputs: PortHint[] = [];
      for (const node of Object.values(graph.nodes)) {
        if (node.op === 'input') {
          // Avoid duplicates
          if (!inputs.find(i => i.name === node.params.key)) {
            inputs.push({ name: node.params.key, type: AnyType, description: `Variable: ${node.params.key}` });
          }
        }
      }

      return {
        inputs,
        outputs: [{ name: 'result', type: AnyType }]
      };
    } catch (e) {
      return { inputs: [], outputs: [{ name: 'result', type: AnyType }] };
    }
  }
});

registerNode(expressionNode);

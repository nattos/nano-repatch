import { defineNode, registerNode } from "../../structor/node-helpers";
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
    code: { kind: 'atomic', type: 'string' }
  },
  outputs: {
    result: AnyType
  },
  autoBroadcast: false, // We handle raw inputs
  execute: (inputs, config, context) => {
    const code = config.code || "";
    if (!code.trim()) {
      return { result: 0 };
    }

    const graph = getCompiledGraph(code);

    // Prepare inputs for the expression executor
    // The expression executor expects a dictionary of inputs.
    // We map `inputs` to this dictionary.
    // Since `inputs` is inferred as `{}`, we cast it to `any` to access dynamic fields.
    const exprInputs: Record<string, any> = { ...(inputs as any) };

    try {
      const result = executor.execute(graph, exprInputs);
      return { result: result };
    } catch (e) {
      console.error("Execution failed:", e);
      return { result: null };
    }
  },
  compileConfig: (uiConfig) => ({ fields: { code: uiConfig.code || '' }, untagged: [] }),
  // Dynamic ports based on code
  getPorts: (node) => {
    const code = node.config.code || '';
    if (!code.trim()) {
      return { inputs: [], outputs: [{ name: 'result', type: AnyType }] };
    }

    try {
      // We need to parse the code to find external variables.
      // The GraphCompiler produces an ExecutionGraph.
      // Nodes with op='input' represent external variables.
      const graph = compiler.compile(code);
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
      // If parsing fails, just return default ports or maybe show error?
      // For now, return default.
      return { inputs: [], outputs: [{ name: 'result', type: AnyType }] };
    }
  }
});

registerNode(expressionNode);

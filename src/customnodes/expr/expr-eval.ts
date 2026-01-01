import { defineNode, registerNode, InspectorFieldDef } from "../../structor/node-helpers";
import { AnyType, NumberType, StringType } from "../../structor/type-helpers";
import { GraphCompiler, ExpressionExecutor, ExecutionGraph } from "./parser";
import { NodeCategory } from "../../structor/structor";

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

export const expressionNode = defineNode<any, { code?: string }, { code: typeof StringType, graph: typeof AnyType }>({
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
  compileConfig: (uiConfig) => {
    const code = uiConfig.code || '';
    // Compile code to graph
    const graph = getCompiledGraph(code);
    return {
      code: code,
      // Embed the graph in the config so the executor has it without recompiling
      graph: graph as any
    };
  },
  compilePorts: (node, context) => {
    const code = node.config.code || '';
    const graph = getCompiledGraph(code);

    // Find all input nodes
    const inputNames = new Set<string>();
    for (const node of Object.values(graph.nodes)) {
      if (node.op === 'input') {
        inputNames.add(node.params.key);
      }
    }

    const inputs = Array.from(inputNames).map(name => ({
      name,
      type: NumberType, // Assume numbers for math expressions
      description: `Variable ${name}`
    }));

    return {
      inputs,
      outputs: [{ name: 'result', type: AnyType, description: 'Result' }]
    };
  },
  execute: (inputs, config: { code: string, graph: ExecutionGraph }, context) => {
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

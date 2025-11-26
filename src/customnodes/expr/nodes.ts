import { definePrimitiveNode, AnyType } from "../../structor/type-helpers";
import { GraphCompiler, ExpressionExecutor, ExecutionGraph } from "./parser";
import { Structor } from "../../structor/structor";

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

export const expressionNode = definePrimitiveNode({
  id: "expression",
  inputs: {}, // Inputs are dynamic, but we can define a catch-all or let the executor handle it
  // Actually, for the expression node, we want inputs to be dynamic based on the script.
  // But definePrimitiveNode expects static inputs.
  // However, we can use `redirect: 'untagged'` or just allow extra inputs if the system supports it.
  // The system's `GraphExecutor` passes `inputRecord` to `execute`.
  // If we want named inputs to show up in the UI, we need `getPorts`.
  // But `definePrimitiveNode` doesn't support `getPorts` directly in its type definition yet?
  // Wait, `NodeType` in repository supports `getPorts`. `PrimitiveNodeDefinition` does not.
  // So we might need to wrap this or extend the definition.
  // For now, let's define it as a primitive and rely on the repository registration to add `getPorts`.

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

    // Also provide global context if needed (e.g. Math is handled by parser fallback, but maybe others?)
    // The parser handles Math via global fallback.

    try {
      const result = executor.execute(graph, exprInputs);
      return { result: result };
    } catch (e) {
      console.error("Execution failed:", e);
      return { result: null };
    }
  }
});

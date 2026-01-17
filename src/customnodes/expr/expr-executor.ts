import { ExecutionGraph, NodeId } from "./expr-types";

// ==========================================
// 3. The Executor (Runs the JSON Graph)
// ==========================================

export class ExpressionExecutor {
  execute(graph: ExecutionGraph, inputs: Record<string, any>): any {
    if (!graph.rootId) return null;

    const cache = new Map<NodeId, any>();

    const resolve = (id: NodeId): any => {
      if (cache.has(id)) return cache.get(id);

      const node = graph.nodes[id];
      if (!node) throw new Error(`Missing node ${id}`);

      // Recursive resolution of dependencies
      const args = node.inputs.map(inputId => resolve(inputId));

      let result: any;
      switch (node.op) {
        case 'const':
          result = node.params.value;
          break;
        case 'input':
          // Looks for value in inputs dictionary, or fallback to global (like Math)
          result = inputs[node.params.key] !== undefined
            ? inputs[node.params.key]
            : (globalThis as any)[node.params.key];
          break;
        case 'add': result = args[0] + args[1]; break;
        case 'sub': result = args[0] - args[1]; break;
        case 'mul': result = args[0] * args[1]; break;
        case 'div': result = args[0] / args[1]; break;
        case 'prop':
          if (args[0] === undefined || args[0] === null) throw new Error(`Cannot access property '${node.params.key}' of undefined`);
          result = args[0][node.params.key];
          break;
        case 'struct':
          // Reassemble object { key: value }
          result = {};
          node.params.keys.forEach((key: string, idx: number) => {
            result[key] = args[idx];
          });
          break;
        default:
          throw new Error(`Unknown op: ${node.op}`);
      }

      cache.set(id, result);
      return result;
    };

    return resolve(graph.rootId);
  }
}

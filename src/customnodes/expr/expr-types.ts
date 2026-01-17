
// ==========================================
// 1. The JSON-Serializable Graph Definition
// ==========================================

export type NodeId = string;

export interface GraphNode {
  id: NodeId;
  op: string;        // The operation code (e.g., 'const', 'add', 'get', 'prop')
  inputs: NodeId[];  // Dependencies (other node IDs)
  params?: any;      // Static parameters (e.g., literal values, property names)
}

export interface ExecutionGraph {
  nodes: Record<NodeId, GraphNode>;
  rootId: NodeId | null; // The final result node
}

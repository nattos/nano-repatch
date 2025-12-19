import { registerNode } from "../../structor/node-helpers";
import { expressionNode } from "./nodes";

registerNode({
  ...expressionNode,
  ui: {
    inspector: () => import('./nodes.ui').then(m => m.ExpressionInspectorRenderer)
  }
});

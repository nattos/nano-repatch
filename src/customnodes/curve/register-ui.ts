import { registerNode } from "../../structor/node-helpers";
import { curve_ease, curve_ease4 } from "./nodes";

// Re-register with UI
registerNode({
  ...curve_ease,
  ui: {
    body: () => import('./nodes.ui').then(m => m.CurveBodyRenderer),
    getBodyHeight: () => import('./nodes.ui').then(m => m.CurveBodyHeight),
    inspector: () => import('./nodes.ui').then(m => m.CurveInspectorRenderer)
  }
});

registerNode({
  ...curve_ease4,
  ui: {
    body: () => import('./nodes.ui').then(m => m.CurveBodyRenderer),
    getBodyHeight: () => import('./nodes.ui').then(m => m.CurveBodyHeight),
    inspector: () => import('./nodes.ui').then(m => m.CurveInspectorRenderer)
  }
});

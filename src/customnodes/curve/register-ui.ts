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

import { curve_env, curve_crop } from "./nodes";

registerNode({
  ...curve_env,
  ui: {
    body: () => import('./nodes.ui').then(m => m.CurveEnvBodyRenderer),
    getBodyHeight: () => import('./nodes.ui').then(m => m.CurveEnvBodyHeight),
    inspector: () => import('./nodes.ui').then(m => m.CurveInspectorRenderer)
  }
});

registerNode({
  ...curve_crop,
  ui: {
    ...curve_crop.ui,
    body: () => import('./nodes.ui').then(m => m.CurveCropBodyRenderer),
    getBodyHeight: () => import('./nodes.ui').then(m => m.CurveCropBodyHeight)
  }
});

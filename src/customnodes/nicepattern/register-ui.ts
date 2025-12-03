import { registerNode } from "../../structor/node-helpers";
import {
  rhythmicGenerator,
  chaosGenerator,
  pattern,
  gateLayer,
  expLayer,
  pwmLayer,
  noiseLayer,
  toneSynthLayer
} from "./nodes";

registerNode({
  ...rhythmicGenerator,
  ui: {
    inspector: () => import('./nodes.ui').then(m => m.RhythmicInspector)
  }
});

registerNode({
  ...chaosGenerator,
  ui: {
    inspector: () => import('./nodes.ui').then(m => m.ChaosInspector)
  }
});

registerNode(pattern);

registerNode({
  ...gateLayer,
  ui: { inspector: () => import('./nodes.ui').then(m => m.LayerInspector) }
});

registerNode({
  ...expLayer,
  ui: { inspector: () => import('./nodes.ui').then(m => m.LayerInspector) }
});

registerNode({
  ...pwmLayer,
  ui: { inspector: () => import('./nodes.ui').then(m => m.LayerInspector) }
});

registerNode({
  ...noiseLayer,
  ui: { inspector: () => import('./nodes.ui').then(m => m.LayerInspector) }
});

registerNode({
  ...toneSynthLayer,
  ui: { inspector: () => import('./nodes.ui').then(m => m.LayerInspector) }
});

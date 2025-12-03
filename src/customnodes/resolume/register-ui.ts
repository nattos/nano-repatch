import { registerNode } from "../../structor/node-helpers";
import { resolumeInputNode, resolumeOutputNode } from "./nodes";

registerNode({
  ...resolumeInputNode,
  ui: {
    inspector: () => import('./nodes.ui').then(m => m.ResolumeInputInspector)
  }
});

registerNode({
  ...resolumeOutputNode,
  ui: {
    inspector: () => import('./nodes.ui').then(m => m.ResolumeOutputInspector)
  }
});

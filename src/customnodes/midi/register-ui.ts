import { registerNode } from "../../structor/node-helpers";
import { midiTriggerNode } from "./nodes";

registerNode({
  ...midiTriggerNode,
  ui: {
    body: () => import('./nodes.ui').then(m => m.MidiTriggerBodyRenderer),
    getBodyHeight: () => import('./nodes.ui').then(m => m.MidiTriggerBodyHeight)
  }
});

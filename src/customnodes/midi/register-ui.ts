import { registerNode } from "../../structor/node-helpers";
import {
  midiInputNode,
  midiCcInputNode,
  midiCcNode,
  midiNoteNode,
  midiToMonoNode
} from "./nodes";

registerNode(midiInputNode);
registerNode(midiCcInputNode);
registerNode(midiCcNode);
registerNode(midiNoteNode);
registerNode(midiToMonoNode);

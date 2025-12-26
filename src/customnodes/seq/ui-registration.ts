
import { defaultNodeRepository } from "../../structor/repository";

export function registerSeqUI() {
  const sequencerType = defaultNodeRepository.getNodeType('seq.sequencer');
  if (sequencerType) {
    (sequencerType as any).ui = {
      ...((sequencerType as any).ui || {}),
      body: () => import('./sequencer-editor').then(m => m.SequencerEditorRenderer),
      // Set fixed height for the sequencer body if needed?
      // Or let it be flexible. Default node body logic might handle it.
      // But usually Hero Nodes have specific height expectations.
      // Let's assume standard Grid metrics handle it or we define getBodyHeight.
      // For now, let's leave height dynamic or default.
      // If we need custom height:
      // getBodyHeight: () => Promise.resolve(() => 200)
    };
  }
}


import { defaultNodeRepository } from "../../structor/repository";

export function registerSeqUI() {
  const sequencerType = defaultNodeRepository.getNodeType('seq.sequencer');
  if (sequencerType) {
    (sequencerType as any).ui = {
      ...((sequencerType as any).ui || {}),
      body: () => import('./sequencer-editor').then(m => m.SequencerEditorRenderer),
      getBodyHeight: () => Promise.resolve(() => 160) // 4x4 grid approx height
    };
  }
}


import { defaultNodeRepository } from "../../structor/repository";
import { ROW_HEIGHT } from "../../constants";

export function registerSeqUI() {
  const sequencerType = defaultNodeRepository.getNodeType('seq.sequencer');
  if (sequencerType) {
    (sequencerType as any).ui = {
      ...((sequencerType as any).ui || {}),
      body: () => import('./sequencer-editor').then(m => m.SequencerEditorRenderer),
      getBodyHeight: () => Promise.resolve(() => 2 * ROW_HEIGHT)
    };
  }
}

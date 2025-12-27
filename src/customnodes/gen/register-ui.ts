import { registerNode } from "../../structor/node-helpers";
import { adsr } from "./nodes";
import { html } from 'lit';
import { appController, runtimeManager } from '../../builder/controllers';
import '../../views/graph-widget';
import { GraphWidgetConfig } from '../../views/graph-widget';

const renderAdsrBody = async () => {
  return (node: any, handlers: any) => {
    const config = node.config.values || {};
    const mode = node.config.mode || config.mode || 'D';

    const a = Math.max(0.001, config.attack ?? 0.1);
    const d = Math.max(0.001, config.decay ?? 1.0);
    const s = Math.max(0, Math.min(1, config.sustain ?? 0.7));
    // Determine effective release based on mode
    let r = Math.max(0.001, config.release ?? 1.0);
    if (mode === 'D' || mode === 'ADS') {
      r = d;
    }

    const HOLD = 0.3; // Treat sustain hold as 0.3s for visualization

    let effectiveAttack = a;
    let effectiveDecay = d;
    let effectiveSustain = s;

    if (mode === 'D') {
      effectiveAttack = 0;
      effectiveSustain = 0;
      // D mode: Start(0,0) -> Peak(0,1) -> Sustain(Decay, 0) -> ...
    }

    // Calculate total time and normalization
    const currentTotal = effectiveAttack + effectiveDecay + HOLD + r;
    const totalTime = Math.max(1.0, currentTotal);

    // Normalize
    const nA = effectiveAttack / totalTime;
    const nD = effectiveDecay / totalTime;
    const nH = HOLD / totalTime;
    const nR = r / totalTime;

    let nodes: any[] = [];
    let segments: any[] = [];

    if (mode === 'D') {
      // Decay only visualization (but normalized)
      // Attack is 0. Sustain is 0.
      // Peak at nA (0).
      // Decay ends at nA + nD. Value=0.
      nodes = [
        { id: 'peak', x: 0, y: 1 },
        { id: 'end', x: nD, y: 0 }
      ];
      segments = [
        { id: 'decay', weight: 1, curve: { type: 'linear' } }
      ];
    } else if (mode === 'ADS') {
      // Attack -> Decay -> Sustain -> Release (Hold+Release visible)
      // Visual: Start -> Peak -> SustainStart -> SustainEnd(Hold) -> ReleaseEnd(0)
      nodes = [
        { id: 'start', x: 0, y: 0 },
        { id: 'peak', x: nA, y: 1 },
        { id: 'sustain', x: nA + nD, y: effectiveSustain },
        { id: 'release', x: nA + nD + nH, y: effectiveSustain }, // End of Hold
        { id: 'end', x: nA + nD + nH + nR, y: 0 }
      ];
      segments = [
        { id: 'attack', weight: 1, curve: { type: 'linear' } },
        { id: 'decay', weight: 1, curve: { type: 'linear' } },
        { id: 'hold', weight: 1, curve: { type: 'linear' } },
        { id: 'release', weight: 1, curve: { type: 'linear' } }
      ];
    } else {
      // ADSR (Default)
      nodes = [
        { id: 'start', x: 0, y: 0 },
        { id: 'peak', x: nA, y: 1 },
        { id: 'sustain', x: nA + nD, y: effectiveSustain },
        { id: 'release', x: nA + nD + nH, y: effectiveSustain },
        { id: 'end', x: nA + nD + nH + nR, y: 0 }
      ];
      segments = [
        { id: 'attack', weight: 1, curve: { type: 'linear' } },
        { id: 'decay', weight: 1, curve: { type: 'linear' } },
        { id: 'hold', weight: 1, curve: { type: 'linear' } },
        { id: 'release', weight: 1, curve: { type: 'linear' } }
      ];
    }

    const widgetConfig: GraphWidgetConfig = {
      mode: 'curve',
      domain: [0, 1],
      range: [0, 1],
      envelopeNodes: nodes,
      segments: segments as any,
      interactive: true,

      onEnvelopeChange: (newNodes: any[], newSegments: any[]) => {
        newNodes.sort((a, b) => a.x - b.x);

        const updates: any = {};
        const getDuration = (n1: any, n2: any) => (n2.x - n1.x) * totalTime;

        if (mode === 'D') {
          const newD = getDuration(newNodes[0], newNodes[1]);
          updates.decay = parseFloat(Math.max(0.001, newD).toFixed(3));
        } else if (mode === 'ADS') {
          const newA = getDuration(newNodes[0], newNodes[1]);
          const newD = getDuration(newNodes[1], newNodes[2]);
          const newS = newNodes[2].y;

          updates.attack = parseFloat(Math.max(0.001, newA).toFixed(3));
          updates.decay = parseFloat(Math.max(0.001, newD).toFixed(3));
          updates.sustain = parseFloat(newS.toFixed(3));
        } else {
          // ADSR
          const newA = getDuration(newNodes[0], newNodes[1]);
          const newD = getDuration(newNodes[1], newNodes[2]);
          const newR = getDuration(newNodes[3], newNodes[4]);
          const newS = newNodes[2].y;

          updates.attack = parseFloat(Math.max(0.001, newA).toFixed(3));
          updates.decay = parseFloat(Math.max(0.001, newD).toFixed(3));
          updates.sustain = parseFloat(newS.toFixed(3));
          updates.release = parseFloat(Math.max(0.001, newR).toFixed(3));
        }

        appController.setNodeConfig(node.id, {
          ...node.config.values,
          ...updates
        });
      }
    };

    // Calculate Cursor Position
    const uiState = runtimeManager.uiStates.get(node.id);
    if (uiState && typeof uiState.phase === 'number') {
      const { phase, time, value } = uiState;
      let cursorTime = 0;

      if (mode === 'D') {
        // In D mode, visual is just a decay from 1 -> 0.
        // Map value directly to position to handle both Decay and Release phases seamlessly.
        // x = 0 at value=1, x = nD at value=0.
        // Note: nA is 0 in D mode.
        if (value > 0) {
          // Position proportional to how much we've decayed
          widgetConfig.cursor = nD * (1.0 - value);
        } else {
          if (phase === 0) widgetConfig.cursor = undefined; // Hide on Idle
          else widgetConfig.cursor = nD;
        }
      } else {
        // ADSR_PHASE: IDLE=0, ATTACK=1, DECAY=2, SUSTAIN=3, RELEASE=4
        if (phase === 1) { // Attack
          cursorTime = time;
        } else if (phase === 2) { // Decay
          cursorTime = effectiveAttack + time;
        } else if (phase === 3) { // Sustain
          cursorTime = effectiveAttack + effectiveDecay + (time % HOLD);
        } else if (phase === 4) { // Release
          cursorTime = effectiveAttack + effectiveDecay + HOLD + time;
        } else {
          cursorTime = -1; // Hide (handled below)
        }

        if (cursorTime >= 0) {
          widgetConfig.cursor = Math.min(1, cursorTime / totalTime);
        } else {
          widgetConfig.cursor = undefined;
        }
      }
    }

    return html`<graph-widget .config=${widgetConfig} .value=${undefined} style="width: 100%; height: 100%; min-height: 96px;"></graph-widget>`;
  };
};

registerNode({
  ...adsr,
  ui: {
    ...adsr.ui,
    body: renderAdsrBody,
    getBodyHeight: async () => (node: any) => 120
  }
});

import { registerNode } from "../../structor/node-helpers";
import { adsr } from "./nodes";
import { html } from 'lit';
import { appController } from '../../builder/controllers';
import '../../views/graph-widget';
import { GraphWidgetConfig } from '../../views/graph-widget';

const renderAdsrBody = async () => {
  return (node: any, handlers: any) => {
    const config = node.config.values || {};
    const a = Math.max(0.001, config.attack ?? 0.1);
    const d = Math.max(0.001, config.decay ?? 0.1);
    const s = Math.max(0, Math.min(1, config.sustain ?? 0.7));
    const r = Math.max(0.001, config.release ?? 0.5);

    const HOLD = 0.5;
    const totalTime = a + d + HOLD + r;

    const nA = a / totalTime;
    const nD = d / totalTime;
    const nH = HOLD / totalTime;
    // const nR = r / totalTime;

    const nodes = [
      { id: 'start', x: 0, y: 0 },
      { id: 'peak', x: nA, y: 1 },
      { id: 'sustain', x: nA + nD, y: s },
      { id: 'release', x: nA + nD + nH, y: s },
      { id: 'end', x: 1, y: 0 }
    ];

    const segments = [
      { id: 'attack', weight: 1, curve: { type: 'linear' } },
      { id: 'decay', weight: 1, curve: { type: 'linear' } },
      { id: 'hold', weight: 1, curve: { type: 'linear' } },
      { id: 'release', weight: 1, curve: { type: 'linear' } }
    ];

    const widgetConfig: GraphWidgetConfig = {
      mode: 'curve',
      domain: [0, 1],
      range: [0, 1],
      envelopeNodes: nodes,
      segments: segments as any, // Cast to avoid strict type issues with GraphSegment export matching
      interactive: true,

      onEnvelopeChange: (newNodes: any[], newSegments: any[]) => {
        newNodes.sort((a, b) => a.x - b.x);

        // Extract normalized durations
        const nA_new = newNodes[1].x;
        const nD_new = newNodes[2].x - newNodes[1].x;
        // const nH_new = newNodes[3].x - newNodes[2].x;
        const nR_new = newNodes[4].x - newNodes[3].x;

        const newA = nA_new * totalTime;
        const newD = nD_new * totalTime;
        const newR = nR_new * totalTime;
        const newS = newNodes[2].y;

        appController.setNodeConfig(node.id, {
          ...node.config.values,
          attack: parseFloat(newA.toFixed(3)),
          decay: parseFloat(newD.toFixed(3)),
          sustain: parseFloat(newS.toFixed(3)),
          release: parseFloat(newR.toFixed(3))
        });
      }
    };

    return html`<graph-widget .config=${widgetConfig} .value=${undefined} style="width: 100%; height: 100%; min-height: 96px;"></graph-widget>`;
  };
};

registerNode({
  ...adsr,
  ui: {
    body: renderAdsrBody,
  }
});

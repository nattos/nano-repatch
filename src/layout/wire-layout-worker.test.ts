
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WireDef, LayoutOptions, LayoutResult } from './wire-layout';
import '../builder/local-state'; // Trigger side-effects? No.

// Mock Worker
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(scriptURL: string | URL, options?: WorkerOptions) { }

  postMessage(message: any) {
    if (message.type === 'LAYOUT_REQUEST') {
      // Simulate async response
      setTimeout(() => {
        if (this.onmessage) {
          // Return dummy result
          this.onmessage({
            data: {
              type: 'LAYOUT_RESULT',
              layout: { wires: {}, segments: [] }
            }
          } as MessageEvent);
        }
      }, 10);
    }
  }

  terminate() { }
}

vi.stubGlobal('Worker', MockWorker);

// Now import LocalController
import { LocalController } from '../builder/local-state';
import { GraphState } from '../builder/state';

describe('LocalController Worker Integration', () => {
  let controller: LocalController;

  beforeEach(() => {
    controller = new LocalController();
  });

  it('updates wire layout asynchronously via worker', async () => {
    const mockGraph: GraphState = {
      inner: {
        nodes: {},
        connections: {},
        panning: { x: 0, y: 0 },
        scaling: 1
      },
      selection: [],
      history: { past: [], future: [] }
    };

    expect(controller.observableState.layoutVersion).toBe(0);

    controller.updateWireLayout(mockGraph);

    // Should not have updated yet
    expect(controller.observableState.layoutVersion).toBe(0);

    // Wait for worker
    await new Promise(r => setTimeout(r, 50));

    expect(controller.observableState.layoutVersion).toBe(1);
  });
});

// @ts-nocheck
import 'puppeteer';
import { tracePaths } from './path-trace-util';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('Wire Spreading Regression Test', () => {
  beforeAll(async () => {
    await page.goto(URL);
    await page.setViewport({ width: 1200, height: 800 });
    await page.waitForSelector('nano-repatch');
  });

  beforeEach(async () => {
    // Clear graph
    await page.evaluate(() => {
      if (window.testing && window.testing.appController) {
        window.testing.appController.loadGraph({ nodes: {}, connections: {} });
      }
    });
    // Wait for clear
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app?.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      const grid = editor?.shadowRoot?.querySelector('graph-grid');
      return grid && grid.shadowRoot.querySelectorAll('graph-node').length === 0;
    });
  });

  async function createNode(type, x, y, expectedTotal) {
    const id = await page.evaluate((type, x, y) => {
      const node = window.testing.appController.createNode(type, x, y);
      return node.id;
    }, type, x, y);

    await page.waitForFunction((count) => {
      const grid = document.querySelector('nano-repatch')?.shadowRoot?.querySelector('workspace-layout')?.shadowRoot?.querySelector('graph-editor')?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-node').length === count;
    }, {}, expectedTotal);
    return id;
  }

  async function createConnection(fromId, toId, fromPort = '0', toPort = '0') {
    await page.evaluate((fromId, toId, fromPort, toPort) => {
      window.testing.appController.createConnection(fromId, fromPort, toId, toPort);
    }, fromId, toId, fromPort, toPort);
  }

  async function getWireSegments(page) {
    return await page.evaluate(() => {
      const grid = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
      const segments = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment'));
      return segments.map(el => {
        const rect = el.getBoundingClientRect();
        const type = Array.from(el.classList).find(c => ['h', 'v', 'ctl', 'ctr', 'cbl', 'cbr', 'start', 'end'].includes(c)) || 'unknown';
        const lines = Array.from(el.querySelectorAll('.wire-line')).map(l => {
          const r = l.getBoundingClientRect();
          return { x: r.x, y: r.y, top: r.top, width: r.width, height: r.height };
        });
        return { type, rect, lines, wireId: el.dataset.wireId };
      });
    });
  }

  it('should spread out wires that share the same horizontal lane', async () => {
    // Scenario: Fan-out from a single node to two downstream nodes.
    // The wires MUST share the initial segment.

    const hubA = await createNode('util.hub', 0, 0, 1);
    const hubB = await createNode('util.hub', 2, 0, 2);
    const hubC = await createNode('util.hub', 3, 0, 3); // Further right

    // Connect A -> B
    await createConnection(hubA, hubB);

    // Connect A -> C
    await createConnection(hubA, hubC);

    await new Promise(r => setTimeout(r, 1000));

    // Get segments
    const segments = await getWireSegments(page);

    // Look for horizontal segments in the gap between Col 0 and Col 2.
    // x around 1. (Col 0 ends at x=0 logic? No. Col 0 is x=0 logic. Gap is x=1 logic? No. Gap is x=2 logic?)
    // In wire-layout: Nodes are at Odd X (1, 3, 5). Gaps at Even X (0, 2, 4, 6).
    // Wait, input X is grid coord.
    // toLogical: x = p.x * 2 + 1.
    // Node A at 0 -> Logic X = 1.
    // Node B at 2 -> Logic X = 5.
    // Gap is Logic X = 2, 3, 4.
    // X=3 (Logic) is Node Col 1 (Empty).
    // So wires go through Logic X=2 (Gap), X=3 (Empty Node Col), X=4 (Gap).
    // They should share these segments.

    const horizontalSegments = segments.filter(s => s.type === 'h' && s.lines.length > 0);

    const lines = horizontalSegments.flatMap(s => s.lines);

    let foundOverlap = false;

    // We strictly check for strict overlap (same Y).
    // Any Y-spread > 0.5px is considered "Spreading".

    let foundSharedX = false;

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const l1 = lines[i];
        const l2 = lines[j];

        // Check if they are from different wires
        // We don't have wireId on line, but we can verify later?
        // Actually segments have wireId.

        // Get segment for line (hacky since we flattened)
        // Let's iterate segments instead.
      }
    }

    // Re-iterate segments
    const segs = horizontalSegments;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s1 = segs[i];
        const s2 = segs[j];

        if (s1.wireId === s2.wireId) continue; // Same wire segments might overlap if logic is weird, but we care about different wires

        // Check Overlap
        // We need to check if lines overlap
        for (const l1 of s1.lines) {
          for (const l2 of s2.lines) {
            const xOverlap = Math.max(0, Math.min(l1.x + l1.width, l2.x + l2.width) - Math.max(l1.x, l2.x));
            if (xOverlap > 10) {
              foundSharedX = true;
              const yDiff = Math.abs(l1.top - l2.top);
              if (yDiff < 0.1) {
                foundOverlap = true;
                console.log(`Found Overlapping Segments: Wire ${s1.wireId} vs ${s2.wireId} at X=${l1.x} Y=${l1.top}`);
              }
            }
          }
        }
      }
    }

    if (!foundSharedX) {
      throw new Error('Test Setup Failed: No shared horizontal segments found between wires.');
    }

    if (foundOverlap) {
      throw new Error(`Wires are overlapping! Found overlap between wires.`);
    }

  });
});

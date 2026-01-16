// @ts-nocheck
import 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('Vertical Wire Spreading Test', () => {
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
          return { x: r.x, y: r.y, top: r.top, left: r.left, width: r.width, height: r.height };
        });
        return { type, rect, lines, wireId: el.dataset.wireId };
      });
    });
  }

  it('should spread out wires that share the same vertical lane', async () => {
    // Scenario: Two vertical connections sharing the same gap column.
    // Left Column (0,0) and (0,1) -> connected to nodes on the far right?
    // Or Top-Left (0,0) connects to Bottom-Right (2,2)
    // And Mid-Left (0,1) connects to Mid-Right (2,1)
    // If we block the middle?

    // Let's create a scenario where wires MUST travel vertically in the same gap.

    // Col 0: Hub A (0,0), Hub B (0,3)
    // Col 1: Blocked (Hubs at 1,1 and 1,2)
    // Col 2: Hub C (2,0), Hub D (2,3)
    // If we connect A->B? No, that's straight line (though in gap).

    // Let's try U-shape or shared routing.
    // Node A (0,0) -> Node B (0,2)
    // Node C (2,0) -> Node D (2,2)
    // These are separate.

    // How about:
    // Node A (0,0) -> Node B (0, 3)
    // Node C (0,1) -> Node D (0, 2)
    // Both traveling down the gap to the right of Col 0 (i.e. Gap Col 1, logic X=2).
    // Since Col 0 is nodes. Wires usually exit Right. They enter Gap x=2.
    // They travel down Gap x=2.
    // Start Stubs are in Col 1 (Logic).
    // Vertical segments in Col 2 (Logic).

    const hubA = await createNode('util.hub', 0, 0, 1);
    const hubC = await createNode('util.hub', 0, 1, 2);

    const hubD = await createNode('util.hub', 0, 4, 3);
    const hubB = await createNode('util.hub', 0, 5, 4);

    // Connect A (top) to B (bottom)
    await createConnection(hubA, hubB);
    // Connect C (inner top) to D (inner bottom)
    await createConnection(hubC, hubD);

    await new Promise(r => setTimeout(r, 1000));

    // Get segments
    const segments = await getWireSegments(page);

    // Filter for Vertical segments
    const vSegments = segments.filter(s => s.type === 'v' && s.lines.length > 0);

    // Find overlapping vertical segments
    const lines = vSegments.flatMap(s => s.lines);

    let foundOverlap = false;
    let foundSpread = false;

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const l1 = lines[i];
        const l2 = lines[j];

        // Check for Y overlap (Vertical)
        const yOverlap = Math.max(0, Math.min(l1.top + l1.height, l2.top + l2.height) - Math.max(l1.top, l2.top));

        if (yOverlap > 10) { // Significant vertical overlap
          // Check X difference
          const xDiff = Math.abs(l1.left - l2.left);

          if (xDiff < 0.1) {
            foundOverlap = true;
            console.log(`Found Overlapping V-Lines at X=${l1.left}, Y=${l1.top}`);
          } else if (xDiff > 1.0) {
            foundSpread = true;
            console.log(`Found Spread V-Lines at X1=${l1.left} X2=${l2.left} Y=${l1.top}`);
          }
        }
      }
    }

    if (foundOverlap && !foundSpread) {
      throw new Error('Wires are overlapping vertically and not spreading out!');
    }

    // We expect spreading if there's overlap in the channel.
    expect(foundSpread).toBe(true);
    expect(foundOverlap).toBe(false);
  });
});

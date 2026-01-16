// @ts-nocheck
import 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('Wire Routing Midpoint Test', () => {
  beforeAll(async () => {
    await page.goto(URL);
    await page.setViewport({ width: 1200, height: 800 });
    await page.waitForSelector('nano-repatch');

    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      // Filter out Vite noise
      if (!text.includes('[vite]') && !text.includes('[HMR]')) {
        console.log(`PAGE LOG: ${text}`);
      }
    });
  });

  beforeEach(async () => {
    await page.evaluate(() => {
      if (window.testing && window.testing.appController) {
        window.testing.appController.loadGraph({ nodes: {}, connections: {} });
      }
    });
    await page.waitForFunction(() => {
      const grid = document.querySelector('nano-repatch')?.shadowRoot?.querySelector('workspace-layout')?.shadowRoot?.querySelector('graph-editor')?.shadowRoot?.querySelector('graph-grid');
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

  async function createConnection(fromId, toId) {
    await page.evaluate((fromId, toId) => {
      window.testing.appController.createConnection(fromId, '0', toId, '0');
    }, fromId, toId);
  }

  async function getWireSegments(page) {
    return await page.evaluate(() => {
      const grid = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
      const segments = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment'));
      return segments.map(el => {
        const rect = el.getBoundingClientRect();
        const type = Array.from(el.classList).find(c => ['h', 'v', 'ctl', 'ctr', 'cbl', 'cbr', 'start', 'end'].includes(c)) || 'unknown';
        const style = window.getComputedStyle(el);
        return {
          type,
          rect,
          gridCol: parseInt(style.gridColumnStart),
          gridRow: parseInt(style.gridRowStart)
        };
      });
    });
  }

  it('should route vertical drop near the midpoint of the horizontal span', async () => {
    // Source at (0,0) -> Grid Col 3? (Input=1, Gap=2, Node=3) -> Output port right side
    const srcId = await createNode('util.hub', 0, 0, 1);

    // Dest at (10, 5) -> Far away to the right and down.
    // X=10 -> Col 23? (0->3, 1->5, ... x*2 + 3)
    // Wait, node X is logical. Col = X*2 + 3?
    // Node 0 -> Col 3 (gap left is 2, node is 3)
    // Node 1 -> Col 5
    // Node 10 -> Col 23.
    const dstId = await createNode('util.hub', 10, 5, 2);

    await createConnection(srcId, dstId);
    await new Promise(r => setTimeout(r, 1000));

    const segments = await getWireSegments(page);

    // Find the main vertical segment.
    const vSegments = segments.filter(s => s.type === 'v' || s.type.includes(' corner '));
    // corners are usually ctl, ctr etc.
    // Let's look for any segment that has verticality.
    // Actually, let's look for the "Vertical Drop Column".
    // The wire should travel Horizontally for a while, then drop.

    // Start Col = 3 (Source Node). Wire starts in Gap 4.
    // End Col = 23 (Dest Node). Wire ends in Gap 22?
    // Midpoint approx (4 + 22) / 2 = 13.

    // We expect the vertical segment to be roughly around Col 13.
    // The "Bad" behavior is dropping immediately at Col 4.

    const verticalCols = segments
      .filter(s => s.type === 'v' || s.type === 'cbl' || s.type === 'cbr' || s.type === 'ctl' || s.type === 'ctr')
      .map(s => s.gridCol);

    if (verticalCols.length === 0) throw new Error("No vertical segments found?");

    const avgVCol = verticalCols.reduce((a, b) => a + b, 0) / verticalCols.length;
    console.log(`Average Vertical Column: ${avgVCol}`);

    // If it drops immediately, it would be around Col 4 or 6.
    // If it drops at midpoint, it should be > 10.

    if (avgVCol < 8) {
      throw new Error(`Wire dropped too early! Average Vertical Column: ${avgVCol}. Expected > 8 (Midpoint of 3 and 23 is ~13)`);
    }
  });
});


// @ts-nocheck
import 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

jest.setTimeout(20000);

async function setupTestEnvironment() {
    await page.goto(URL);
    await page.setViewport({ width: 1200, height: 800 });

    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      // Filter Vite noise but allow our debug logs
      if (!text.includes('[vite]') && !text.includes('scheduled an update')) {
        console.log(`PAGE LOG: ${text}`);
      }
    });

    await page.waitForSelector('nano-repatch');
}

async function createNode(type, x, y, expectedTotal, config = {}) {
    const id = await page.evaluate((type, x, y, config) => {
      const node = window.testing.appController.createNode(type, x, y, config);
      return node.id;
    }, type, x, y, config);

    await page.waitForFunction((count) => {
      const app = document.querySelector('nano-repatch');
      const grid = app?.shadowRoot?.querySelector('workspace-layout')?.shadowRoot?.querySelector('graph-editor')?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-node').length === count;
    }, {}, expectedTotal);
    return id;
}

describe('Strict Wire Alignment', () => {
  beforeAll(async () => {
    await setupTestEnvironment();
  });

  beforeEach(async () => {
      await page.evaluate(() => {
          if (window.testing && window.testing.appController) {
              window.testing.appController.loadGraph({ nodes: {}, connections: {} });
          }
      });
      await new Promise(r => setTimeout(r, 200));
  });

  it('terminates wire exactly at the port edge', async () => {
      // 1. Create Hubs (Minimal/Narrow 80px by default?)
      const h1 = await createNode('util.hub', 0, 0, 1);

      // 2. Force Col 3 (Logical X=1) to be Wide (272px)
      // Create a Wide Node (math.add) at X=1, Y=1.
      const wideNode = await createNode('math.add', 1, 1, 2);

      // 3. Create Hub 2 at X=1, Y=0.
      // It will share the column with math.add, so it sits in a 272px column.
      // Since Hub is 80px, it will be centered with large gaps.
      const h2 = await createNode('util.hub', 1, 0, 3, { width: 1 });

      // 4. Connect h1 -> h2
      await page.evaluate((from, to) => {
          window.testing.appController.createConnection(from, 'out', to, 'in');
      }, h1, h2);

      await new Promise(r => setTimeout(r, 500));

      const error = await page.evaluate((h1, wideId, h2) => {
          console.log(`DEBUG: Looking for nodes: H1=${h1}, Wide=${wideId}, H2=${h2}`);

          const app = document.querySelector('nano-repatch');
          if (!app) return 'App not found';
          const grid = app.shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
          if (!grid) return 'Grid not found';

          const nodeH1 = grid.shadowRoot.querySelector(`graph-node[data-id="${h1}"]`);
          const nodeWide = grid.shadowRoot.querySelector(`graph-node[data-id="${wideId}"]`);
          const nodeH2 = grid.shadowRoot.querySelector(`graph-node[data-id="${h2}"]`);

          if (!nodeH1) return `Node H1 (${h1}) not found`;
          if (!nodeWide) return `Node Wide (${wideId}) not found`;
          if (!nodeH2) return `Node H2 (${h2}) not found`;

          const styleH1 = window.getComputedStyle(nodeH1);
          const styleWide = window.getComputedStyle(nodeWide);
          const styleH2 = window.getComputedStyle(nodeH2);

          const colH1 = styleH1.gridColumnStart;
          const colWide = styleWide.gridColumnStart;
          const colH2 = styleH2.gridColumnStart;

          console.log(`DEBUG: Cols: H1=${colH1}, Wide=${colWide}, H2=${colH2}`);

          // Verify Column Sharing
          if (colWide !== colH2) {
             console.log('DEBUG: Column Mismatch!');
             // Don't fail immediately, let's see where they are
          }

          const gridContainer = grid.shadowRoot.querySelector('.grid-container');
          const gridCols = window.getComputedStyle(gridContainer).gridTemplateColumns;
          console.log(`DEBUG: GridCols: ${gridCols}`);

          // Select stub for H2
          const segments = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment.end'));
          const node2Rect = nodeH2.getBoundingClientRect();
          const port = Array.from(nodeH2.shadowRoot.querySelectorAll('graph-port')).find(p => p.getAttribute('type') === 'in');
          const portRect = port.getBoundingClientRect();
          const portLeft = portRect.left;
          const portCenterX = portRect.left + portRect.width/2;

          const stub = segments.find(s => {
              const r = s.getBoundingClientRect();
              return Math.abs((r.top + r.height/2) - (portRect.top + portRect.height/2)) < 10;
          });

          if (!stub) return 'Stub not found';

          const lines = Array.from(stub.querySelectorAll('.wire-line'));
          const line = lines.find(l => {
              const r = l.getBoundingClientRect();
              return r.width > 2 && r.height < 10;
          });

          if (!line) return `Horizontal Line not found. HTML: ${stub.outerHTML}`;

          const lineStyle = line.getAttribute('style'); // Get inline style for calc string
          const lineRect = line.getBoundingClientRect();
          // Still not
          const penetration = lineRect.right - portCenterX;
          const nodeRect = nodeH2.getBoundingClientRect();
          const gridRect = gridContainer.getBoundingClientRect();


          // Assertions
          if (Math.abs(lineRect.right - portLeft) > 1) {
             return `FAILURE: Gap is too large: ${Math.abs(lineRect.right - portLeft)}px. Expected < 1px.`;
          }

          if (penetration > -5) { // Should be -7.5 (safe). If > -5, it's getting too close to center/penetrating.
             // Wait. Penetration = LineRight(580) - Center(587.5) = -7.5.
             // If Penetration is 0 (Center), it failed.
             // If Penetration is 36 (Deep), it failed.
             // So Penetration should be <= -7.
             return `FAILURE: Wire penetrates too far! Value: ${penetration}px. Expected <= -7px.`;
          }

          return 'PASS';
      }, h1, wideNode, h2);

      if (error !== 'PASS') {
          throw new Error(error);
      }
  });
});


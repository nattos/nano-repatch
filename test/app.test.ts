// @ts-nocheck
import 'puppeteer';

jest.setTimeout(5000);

describe('Graph Editor E2E', () => {
  beforeAll(async () => {
    await page.goto('http://localhost:5173');
    await page.waitForSelector('nano-repatch');
  });

  beforeEach(async () => {
    // Clear the graph state instead of reloading
    await page.evaluate(() => {
      window.testing.appController.clear();
    });
    // Wait for nodes to be cleared
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      if (!editor) return false;
      const grid = editor.shadowRoot.querySelector('graph-grid');
      if (!grid) return false;
      return grid.shadowRoot.querySelectorAll('graph-node').length === 0;
    });
  });

  // Helper to create a node
  async function createNode(x, y) {
    const cellSelector = `nano-repatch >>> graph-editor >>> graph-grid >>> .cell[data-x="${x}"][data-y="${y}"]`;
    const cell = await page.waitForSelector(cellSelector);
    if (!cell) throw new Error(`Cell at ${x},${y} not found`);

    // Dispatch dblclick
    await cell.evaluate(el => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    });

    // Wait for ANY node to appear (less strict)
    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');

    // Verify position
    await page.waitForFunction((x, y) => {
      const app = document.querySelector('nano-repatch');
      const grid = app.shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
      const nodes = Array.from(grid.shadowRoot.querySelectorAll('graph-node'));
      return nodes.some(n => n.node && n.node.x === x && n.node.y === y);
    }, {}, x, y);
  }

  // Helper to click a port
  async function clickPort(nodeIndex, type) {
    // We need to find the Nth node.
    // Since >>> returns the first match or we can use $$eval with >>>?
    // Puppeteer's >>> might not well with $$ or index access directly in selector string.
    // Let's use evaluateHandle to get the grid, then query inside.
    // Or better, use the >>> to get the grid, then evaluate inside.

    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');
    await gridHandle.evaluate((grid, nodeIndex, type) => {
      const nodes = grid.shadowRoot.querySelectorAll('graph-node');
      const node = nodes[nodeIndex];
      if (!node) throw new Error(`Node at index ${nodeIndex} not found`);

      // Find the port element inside the node's shadow DOM
      const portSelector = type === 'in' ? '.in-port' : '.out-port';
      const portElement = node.shadowRoot.querySelector(portSelector);
      if (!portElement) throw new Error(`Port ${type} not found in node ${nodeIndex}`);

      portElement.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        composed: true
      }));
    }, nodeIndex, type);
  }

  it('should create a node on double click', async () => {
    await createNode(0, 0);

    const node = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');
    expect(node).not.toBeNull();
  });

  it('should drag a node', async () => {
    await createNode(0, 0);

    // Wait for node
    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');

    // Drag from (50, 50) to (270, 50)
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.mouse.move(270, 50, { steps: 20 });
    await page.mouse.up();

    // Check position style
    const node = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');
    const style = await node.evaluate(el => el.getAttribute('style'));

    expect(style).toContain('grid-column: 3');
    expect(style).toContain('grid-row: 1');
  });

  it('should create a connection', async () => {
    await createNode(0, 0);
    await createNode(2, 0);

    // Wait for 2 nodes
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      return app.shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid').shadowRoot.querySelectorAll('graph-node').length === 2;
    });

    await clickPort(0, 'out');
    await new Promise(r => setTimeout(r, 100));
    await clickPort(1, 'in');

    const connection = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-connection');
    expect(connection).not.toBeNull();
  });

  it('should delete a connection on double click', async () => {
    await createNode(0, 0);
    await createNode(2, 0);
    await new Promise(r => setTimeout(r, 200));

    await clickPort(0, 'out');
    await new Promise(r => setTimeout(r, 100));
    await clickPort(1, 'in');

    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-connection');

    // Double click connection
    // Use evaluate to dispatch event on the path
    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');
    await gridHandle.evaluate(grid => {
      const connection = grid.shadowRoot.querySelector('graph-connection');
      const path = connection.shadowRoot.querySelector('path[style*="pointer-events: stroke"]');
      path.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    });

    // Wait for connection to disappear
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const grid = app.shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
      return grid.shadowRoot.querySelectorAll('graph-connection').length === 0;
    });

    // Verify count is 0
    const count = await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const grid = app.shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
      return grid.shadowRoot.querySelectorAll('graph-connection').length;
    });
    expect(count).toBe(0);
  });
});

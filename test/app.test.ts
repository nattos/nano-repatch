
// @ts-nocheck
/**
 * E2E TEST STANDARD (2025-11-24)
 * 1. Port: 4173 (Do not change)
 * 2. Timeout: Default/5000ms (Do not increase)
 * 3. Server: Managed by jest-puppeteer (Do not spawn manually)
 * 4. State: Use window.testing.appController.loadGraph(...)
 */
import 'puppeteer';

const PORT = 4173;
const URL = `http://localhost:${PORT}`;

jest.setTimeout(5000);

describe('Graph Editor E2E', () => {
  beforeAll(async () => {
    await page.goto(URL);

    // Enable console log forwarding
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (!text.includes('[vite]')) {
        console.log(`PAGE LOG: ${text}`);
      }
    });

    await page.waitForSelector('nano-repatch');
  });

  beforeEach(async () => {
    console.log('Clearing graph...');
    // Clear the graph state instead of reloading
    await page.evaluate(() => {
      if (!window.testing || !window.testing.appController) {
        console.error('Testing API not found on window');
        return;
      }
      window.testing.appController.loadGraph({ nodes: {}, connections: {} });
    });
    console.log('Waiting for nodes to be cleared...');
    // Wait for nodes to be cleared
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      if (!app || !app.shadowRoot) return false;
      const layout = app.shadowRoot.querySelector('workspace-layout');
      if (!layout || !layout.shadowRoot) return false;
      const editor = layout.shadowRoot.querySelector('graph-editor');
      if (!editor || !editor.shadowRoot) return false;
      const grid = editor.shadowRoot.querySelector('graph-grid');
      if (!grid || !grid.shadowRoot) return false;
      const count = grid.shadowRoot.querySelectorAll('graph-node').length;
      return count === 0;
    });
    console.log('Graph cleared.');
  });

  // Helper to create a node via UI
  async function createNode(x, y) {
    // Wait for grid to exist
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app?.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      return !!editor?.shadowRoot?.querySelector('graph-grid');
    });

    // Dispatch dblclick
    await page.evaluate((x, y) => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const cell = grid.shadowRoot.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
      if (cell) {
        cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
      }
    }, x, y);

    // Wait for node to appear
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      const grid = editor?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-node').length > 0;
    });

    // Verify position
    await page.waitForFunction((x, y) => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const nodes = Array.from(grid.shadowRoot.querySelectorAll('graph-node'));
      return nodes.some(n => n.node && n.node.x === x && n.node.y === y);
    }, {}, x, y);
  }

  // Helper to create a node programmatically
  async function createNodeProgrammatic(type, x, y) {
    await page.evaluate((type, x, y) => {
      window.testing.appController.createNode(type, x, y);
    }, type, x, y);

    // Wait for node to appear
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      const grid = editor?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-node').length > 0;
    });
  }

  // Helper to click a port
  async function clickPort(nodeIndex, type) {
    await page.evaluate((nodeIndex, type) => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const nodes = grid.shadowRoot.querySelectorAll('graph-node');
      const node = nodes[nodeIndex];
      if (!node) throw new Error(`Node at index ${nodeIndex} not found`);

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
    await createNode(1, 0);
    // Verification is already inside createNode
  });

  it('should drag a node', async () => {
    await createNode(1, 0);

    // Get node handle for dragging
    const nodeHandle = await page.evaluateHandle(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      return grid.shadowRoot.querySelector('graph-node');
    });

    const box = await nodeHandle.boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Drag from center
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 220, startY, { steps: 20 }); // Move 220px right
    await page.mouse.up();

    // Check position style
    const style = await page.evaluate(el => el.getAttribute('style'), nodeHandle);
    expect(style).toContain('grid-column: 4'); // 1 -> 3 (each col is ~100px?)
    expect(style).toContain('grid-row: 1');
  });

  it('should create a connection', async () => {
    await createNodeProgrammatic('literal', 1, 0);
    await createNodeProgrammatic('add', 3, 0);

    // Wait for 2 nodes
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      const grid = editor?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-node').length === 2;
    });

    await clickPort(0, 'out');
    await new Promise(r => setTimeout(r, 100));
    await clickPort(1, 'in');

    // Wait for connection
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      const grid = editor?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-connection').length === 1;
    });
  });

  it('should delete a connection on double click', async () => {
    await createNodeProgrammatic('literal', 1, 0);
    await createNodeProgrammatic('add', 3, 0);
    await new Promise(r => setTimeout(r, 200));

    await clickPort(0, 'out');
    await new Promise(r => setTimeout(r, 100));
    await clickPort(1, 'in');

    // Wait for connection
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      const grid = editor?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-connection').length === 1;
    });

    // Double click connection
    await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const connection = grid.shadowRoot.querySelector('graph-connection');
      const path = connection.shadowRoot.querySelector('path[style*="pointer-events: stroke"]');
      path.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    });

    // Wait for connection to disappear
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot?.querySelector('workspace-layout');
      const editor = layout?.shadowRoot?.querySelector('graph-editor');
      const grid = editor?.shadowRoot?.querySelector('graph-grid');
      return grid?.shadowRoot?.querySelectorAll('graph-connection').length === 0;
    });
  });
});


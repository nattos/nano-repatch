// @ts-nocheck
import 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

jest.setTimeout(30000);

describe('Multi-select E2E', () => {
  beforeAll(async () => {
    page.on('console', msg => process.stderr.write('PAGE LOG: ' + msg.text() + '\n'));
    page.on('pageerror', err => process.stderr.write('PAGE ERROR: ' + err.toString() + '\n'));
    await page.goto(URL);
    await page.waitForSelector('nano-repatch');
  });

  beforeEach(async () => {
    // Clear the graph state
    await page.evaluate(() => {
      window.testing.appController.loadGraph({ nodes: {}, connections: {} });
    });
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
      return grid.shadowRoot.querySelectorAll('graph-node').length === 0;
    });
  });

  async function createNode(type, x, y) {
    await page.evaluate((type, x, y) => {
      window.testing.appController.createNode(type, x, y);
    }, type, x, y);

    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');
  }

  async function clickNode(index, modifiers = {}) {
    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');
    await gridHandle.evaluate((grid, index, modifiers) => {
      const nodes = grid.shadowRoot.querySelectorAll('graph-node');
      if (nodes[index]) {
        // We need to simulate the click on the graph-node element itself or its internal div
        // The event listener is on the host
        nodes[index].dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          composed: true,
          shiftKey: modifiers.shift,
          ctrlKey: modifiers.ctrl,
          metaKey: modifiers.meta
        }));
      }
    }, index, modifiers);
  }

  async function clickPort(nodeIndex, type) {
    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');
    await gridHandle.evaluate((grid, nodeIndex, type) => {
      const nodes = grid.shadowRoot.querySelectorAll('graph-node');
      const node = nodes[nodeIndex];
      const portSelector = type === 'in' ? '.in-port' : '.out-port';
      const portElement = node.shadowRoot.querySelector(portSelector);
      portElement.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        composed: true
      }));
    }, nodeIndex, type);
  }

  async function waitForSelectionSize(size) {
    await page.waitForFunction((expectedSize) => {
      return window.testing.localController.observableState.selection.size === expectedSize;
    }, {}, size);
  }

  it('should select a single node', async () => {
    await createNode('literal', 0, 0);

    // Debug DOM
    await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      console.log('Debug DOM: grid exists?', !!grid);
      if (grid) {
        console.log('Debug DOM: grid shadowRoot exists?', !!grid.shadowRoot);
        console.log('Debug DOM: graph-node count:', grid.shadowRoot.querySelectorAll('graph-node').length);
        console.log('Debug DOM: grid innerHTML:', grid.shadowRoot.innerHTML);
      }
    });

    await clickNode(0);
    await waitForSelectionSize(1);
  });

  it('should add to selection with shift key', async () => {
    await createNode('literal', 0, 0);
    await createNode('literal', 2, 0);

    await clickNode(0);
    await waitForSelectionSize(1);

    await clickNode(1, { shift: true });
    await waitForSelectionSize(2);
  });

  it('should replace selection without modifiers', async () => {
    await createNode('literal', 0, 0);
    await createNode('literal', 2, 0);

    await clickNode(0);
    await clickNode(1); // No modifiers

    await waitForSelectionSize(1);
  });

  it('should select a single connection', async () => {
    await createNode('literal', 0, 0);
    await createNode('add', 2, 0);

    // create connection
    await clickPort(0, 'out');
    await new Promise(r => setTimeout(r, 100)); // give time for state to update
    await clickPort(1, 'in');

    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-connection');

    // click connection
    await page.evaluate(() => {
      const conn = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid').shadowRoot.querySelector('graph-connection');
      const path = conn.shadowRoot.querySelector('path');
      path.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        composed: true
      }));
    });

    await waitForSelectionSize(1);

    const isSelected = await page.evaluate(() => {
      const conn = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid').shadowRoot.querySelector('graph-connection');
      return conn.hasAttribute('selected');
    });

    expect(isSelected).toBe(true);
  });
});

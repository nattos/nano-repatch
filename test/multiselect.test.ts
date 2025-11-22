// @ts-nocheck
import 'puppeteer';

jest.setTimeout(5000);

describe('Multi-select E2E', () => {
  beforeAll(async () => {
    page.on('console', msg => process.stderr.write('PAGE LOG: ' + msg.text() + '\n'));
    page.on('pageerror', err => process.stderr.write('PAGE ERROR: ' + err.toString() + '\n'));
    await page.goto('http://localhost:5173');
    await page.waitForSelector('nano-repatch');
  });

  beforeEach(async () => {
    // Clear the graph state
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

  async function createNode(x, y) {
    await page.evaluate((x, y) => {
      window.testing.appController.createNode('literal', x, y);
    }, x, y);

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
    await createNode(0, 0);

    // Debug DOM
    await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
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
    await createNode(0, 0);
    await createNode(2, 0);

    await clickNode(0);
    await waitForSelectionSize(1);

    await clickNode(1, { shift: true });
    await waitForSelectionSize(2);
  });

  it('should replace selection without modifiers', async () => {
    await createNode(0, 0);
    await createNode(2, 0);

    await clickNode(0);
    await clickNode(1); // No modifiers

    await waitForSelectionSize(1);
  });

  it('should select a single connection', async () => {
    await createNode(0, 0);
    await createNode(2, 0);

    // create connection
    await clickPort(0, 'out');
    await new Promise(r => setTimeout(r, 100)); // give time for state to update
    await clickPort(1, 'in');

    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-connection');

    // click connection
    await page.evaluate(() => {
        const conn = document.querySelector('nano-repatch').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid').shadowRoot.querySelector('graph-connection');
        const path = conn.shadowRoot.querySelector('path');
        path.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          composed: true
        }));
    });
    
    await waitForSelectionSize(1);
    
    const isSelected = await page.evaluate(() => {
        const conn = document.querySelector('nano-repatch').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid').shadowRoot.querySelector('graph-connection');
        return conn.hasAttribute('selected');
    });

    expect(isSelected).toBe(true);
  });
});

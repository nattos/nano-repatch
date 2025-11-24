// @ts-nocheck
/**
 * E2E TEST STANDARD (2025-11-24)
 * 1. Port: 4173 (Do not change)
 * 2. Timeout: Default/5000ms (Do not increase)
 * 3. Server: Managed by jest-puppeteer (Do not spawn manually)
 * 4. State: Use window.testing.appController.loadGraph(...)
 */
import 'puppeteer';

const URL = 'http://localhost:4173';

jest.setTimeout(5000);

describe('Visual Feedback E2E', () => {
  beforeAll(async () => {
    await page.goto(URL);
    page.on('console', msg => process.stderr.write('PAGE LOG: ' + msg.text() + '\n'));
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

  async function createNode(x, y) {
    await page.evaluate((x, y) => {
      window.testing.appController.createNode('literal', x, y);
    }, x, y);

    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');
  }

  async function clickNode(index) {
    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');
    await gridHandle.evaluate((grid, index) => {
      const nodes = grid.shadowRoot.querySelectorAll('graph-node');
      if (nodes[index]) {
        nodes[index].dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          composed: true
        }));
      }
    }, index);
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

  it('should apply selected attribute to selected node', async () => {
    await createNode(0, 0);
    await clickNode(0);

    const isSelected = await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const node = grid.shadowRoot.querySelector('graph-node');
      return node.hasAttribute('selected');
    });

    expect(isSelected).toBe(true);
  });

  it('should apply connecting class to clicked port', async () => {
    await createNode(0, 0);
    await clickPort(0, 'out'); // Use the original helper

    // Wait for the class to be applied
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const node = grid.shadowRoot.querySelector('graph-node');
      const port = node.shadowRoot.querySelector('.out-port');
      return port.classList.contains('connecting');
    });
  });
});

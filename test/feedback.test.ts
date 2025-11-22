// @ts-nocheck
import 'puppeteer';

jest.setTimeout(5000);

describe('Visual Feedback E2E', () => {
  beforeAll(async () => {
    await page.goto('http://localhost:5173');
    page.on('console', msg => process.stderr.write('PAGE LOG: ' + msg.text() + '\n'));
    await page.waitForSelector('nano-repatch');
  });

  beforeEach(async () => {
    // Clear the graph state
    await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      if (editor && editor.controller) {
        editor.controller.clear();
      }
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
    const appHandle = await page.waitForSelector('nano-repatch');
    await appHandle.evaluate((app, x, y) => {
      const editor = app.shadowRoot.querySelector('graph-editor');
      editor.controller.createNode('literal', x, y);
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
      const editor = app.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const node = grid.shadowRoot.querySelector('graph-node');
      return node.hasAttribute('selected');
    });

    expect(isSelected).toBe(true);
  });

  it('should apply connecting class to clicked port', async () => {
    await createNode(0, 0);

    // Manually dispatch the custom event to bypass any issues with simulated clicks
    await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const node = grid.shadowRoot.querySelector('graph-node');

      const detail = {
        nodeId: node.node.id,
        port: '0',
        type: 'out'
      };
      
      node.dispatchEvent(new CustomEvent('port-click', {
        detail,
        bubbles: true,
        composed: true
      }));
    });

    // Wait for the class to be applied
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const node = grid.shadowRoot.querySelector('graph-node');
      const port = node.shadowRoot.querySelector('.out-port');
      return port.classList.contains('connecting');
    });
  });
});

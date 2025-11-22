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

  async function waitForSelectionSize(size) {
    await page.waitForFunction((expectedSize) => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      return editor.localController.observableState.selection.size === expectedSize;
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
});

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

describe('Selection Undo E2E', () => {
  beforeAll(async () => {
    await page.goto(URL);
    await page.waitForSelector('nano-repatch');
  });

  beforeEach(async () => {
    // Clear the graph state
    await page.evaluate(() => {
      window.testing.appController.loadGraph({ nodes: {}, connections: {} });
      // Clear selection too
      window.testing.localController.queueSelectPaths([], false);
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
          composed: true,
        }));
      }
    }, index);
  }

  async function getUndoStackSize() {
    return await page.evaluate(() => {
      return window.testing.appController.undoStack.length;
    });
  }

  async function waitForSelectionSize(size) {
    await page.waitForFunction((expectedSize) => {
      return window.testing.localController.observableState.selection.size === expectedSize;
    }, {}, size);
  }

  async function undo() {
    await page.evaluate(() => {
      window.testing.appController.undo();
    });
  }

  it('should NOT add selection changes to undo stack', async () => {
    await createNode(0, 0);
    // Creation should add to undo stack
    expect(await getUndoStackSize()).toBe(1);

    await clickNode(0);
    // Selection should NOT add to undo stack
    expect(await getUndoStackSize()).toBe(1);
    await waitForSelectionSize(1);
  });

  it('should preserve selection when undoing other actions', async () => {
    await createNode(0, 0);
    await clickNode(0);
    await waitForSelectionSize(1);

    await createNode(2, 0);
    expect(await getUndoStackSize()).toBe(2); // 2 creations

    // Undo the second creation
    await undo();
    expect(await getUndoStackSize()).toBe(1);

    // Selection should still be active on the first node
    await waitForSelectionSize(1);
  });
});

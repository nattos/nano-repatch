// @ts-nocheck
import 'puppeteer';

jest.setTimeout(5000);

describe('Selection Undo E2E', () => {
  beforeAll(async () => {
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
        // Clear selection too
        editor.localController.queueSelectPaths([], false);
        // Clear undo stack
        editor.controller.undoStack = [];
        editor.controller.redoStack = [];
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
          composed: true,
        }));
      }
    }, index);
  }

  async function getUndoStackSize() {
    return await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      return editor.controller.undoStack.length;
    });
  }

  async function waitForSelectionSize(size) {
    await page.waitForFunction((expectedSize) => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      return editor.localController.observableState.selection.size === expectedSize;
    }, {}, size);
  }

  async function undo() {
    await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      editor.controller.undo();
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

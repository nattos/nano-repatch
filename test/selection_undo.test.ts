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
        editor.localController.selectNodes([]);
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

  async function getSelectionSize() {
    return await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      return editor.localController.observableState.selection.size;
    });
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
    expect(await getSelectionSize()).toBe(1);
  });

  it('should preserve selection when undoing other actions', async () => {
    await createNode(0, 0);
    await clickNode(0);
    expect(await getSelectionSize()).toBe(1);

    await createNode(2, 0);
    expect(await getUndoStackSize()).toBe(2); // 2 creations

    // Undo the second creation
    await undo();
    expect(await getUndoStackSize()).toBe(1);

    // Selection should still be active on the first node (if logic allows)
    // Note: Our current logic might not explicitly preserve selection if the selected node wasn't touched,
    // but the key is that undoing the node creation shouldn't *force* a selection change via the undo system.
    // However, if we undo the creation of a node that WAS selected, it would disappear from selection naturally.
    // Here we selected the first node, then created a second. Undoing the second creation should leave the first node selected.
    expect(await getSelectionSize()).toBe(1);
  });
});

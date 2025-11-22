// @ts-nocheck
import 'puppeteer';

jest.setTimeout(5000);

describe('Undo/Redo UI E2E', () => {
  beforeAll(async () => {
    await page.goto('http://localhost:5173');
    page.on('console', msg => process.stderr.write('PAGE LOG: ' + msg.text() + '\n'));
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

  async function clickUndo() {
    const inspectorHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> inspector-popup');
    await inspectorHandle.evaluate((inspector) => {
      const undoBtn = inspector.shadowRoot.querySelector('#undo-btn');
      if (!undoBtn) throw new Error('Undo button not found');
      undoBtn.click();
    });
  }

  async function clickRedo() {
    const inspectorHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> inspector-popup');
    await inspectorHandle.evaluate((inspector) => {
      const redoBtn = inspector.shadowRoot.querySelector('#redo-btn');
      if (!redoBtn) throw new Error('Redo button not found');
      redoBtn.click();
    });
  }

  async function getNodeCount() {
    return await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      return grid.shadowRoot.querySelectorAll('graph-node').length;
    });
  }

  it('should show undo/redo buttons', async () => {
    const inspectorHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> inspector-popup');
    const buttons = await inspectorHandle.evaluate((inspector) => {
      return {
        undo: !!inspector.shadowRoot.querySelector('#undo-btn'),
        redo: !!inspector.shadowRoot.querySelector('#redo-btn')
      };
    });
    expect(buttons.undo).toBe(true);
    expect(buttons.redo).toBe(true);
  });

  it('should undo node creation', async () => {
    await createNode(0, 0);
    expect(await getNodeCount()).toBe(1);

    await clickUndo();
    expect(await getNodeCount()).toBe(0);
  });

  it('should redo node creation', async () => {
    await createNode(0, 0);
    await clickUndo();
    expect(await getNodeCount()).toBe(0);

    await clickRedo();
    expect(await getNodeCount()).toBe(1);
  });
});

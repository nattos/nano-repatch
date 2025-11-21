// @ts-nocheck
import 'puppeteer';

jest.setTimeout(5000);

describe('Inspector E2E', () => {
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

  async function createNode(x, y, type = 'literal') {
    const appHandle = await page.waitForSelector('nano-repatch');
    await appHandle.evaluate((app, x, y, type) => {
      const editor = app.shadowRoot.querySelector('graph-editor');
      editor.controller.createNode(type, x, y);
    }, x, y, type);

    await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');
  }

  async function selectNode(index) {
    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');
    await gridHandle.evaluate((grid, index) => {
      const nodes = grid.shadowRoot.querySelectorAll('graph-node');
      if (nodes[index]) {
        nodes[index].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      }
    }, index);
  }

  it('should show inspector when a node is selected', async () => {
    await createNode(0, 0);
    await selectNode(0);

    const inspector = await page.waitForSelector('nano-repatch >>> graph-editor >>> inspector-popup');
    const display = await inspector.evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
  });

  it('should change node type', async () => {
    await createNode(0, 0, 'literal');
    await selectNode(0);

    const inspector = await page.waitForSelector('nano-repatch >>> graph-editor >>> inspector-popup');

    // Change type to 'add'
    await inspector.evaluate(el => {
      const select = el.shadowRoot.querySelector('select');
      select.value = 'add';
      select.dispatchEvent(new Event('change'));
    });

    // Verify node text changed
    const node = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid >>> graph-node');
    const text = await node.evaluate(el => el.shadowRoot.textContent);
    expect(text).toContain('add');
  });

  it('should edit literal value', async () => {
    await createNode(0, 0, 'literal');
    await selectNode(0);

    const inspector = await page.waitForSelector('nano-repatch >>> graph-editor >>> inspector-popup');

    // Check if input exists (it shouldn't yet)
    const inputExists = await inspector.evaluate(el => !!el.shadowRoot.querySelector('input'));
    if (!inputExists) {
      // This is expected to fail initially
      throw new Error('Input for literal value not found');
    }

    // Type value
    await inspector.evaluate(el => {
      const input = el.shadowRoot.querySelector('input');
      input.value = '123';
      input.dispatchEvent(new Event('input'));
    });

    // Verify controller state
    const value = await page.evaluate(() => {
      const app = document.querySelector('nano-repatch');
      const editor = app.shadowRoot.querySelector('graph-editor');
      const nodeId = Object.keys(editor.controller.observableState.graph.nodes)[0];
      return editor.controller.observableState.graph.nodes[nodeId].config.value;
    });

    expect(value).toBe('123');
  });
});

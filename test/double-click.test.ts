// @ts-nocheck
import 'puppeteer';

jest.setTimeout(5000);

describe('Double Click Input/Output E2E', () => {
  beforeAll(async () => {
    await page.goto('http://localhost:5173');
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
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

  it('should create an input node when double clicking the left column', async () => {
    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');

    // Dispatch dblclick on left side
    await gridHandle.evaluate(el => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        composed: true,
        clientX: rect.left + 50,
        clientY: rect.top + 50
      }));
    });

    // Wait for node
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const grid = app.shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
      const nodes = Array.from(grid.shadowRoot.querySelectorAll('graph-node'));
      return nodes.some(n => n.node.config.typeId === 'input');
    });
  });

  it('should create an output node when double clicking the right column', async () => {
    const gridHandle = await page.waitForSelector('nano-repatch >>> graph-editor >>> graph-grid');

    // Dispatch dblclick on right side
    await gridHandle.evaluate(el => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        composed: true,
        clientX: rect.right - 50,
        clientY: rect.top + 50
      }));
    });

    // Wait for node
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      const grid = app.shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
      const nodes = Array.from(grid.shadowRoot.querySelectorAll('graph-node'));
      return nodes.some(n => n.node.config.typeId === 'output');
    });
  });
});

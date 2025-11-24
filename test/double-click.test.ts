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

describe('Double Click Input/Output E2E', () => {
  beforeAll(async () => {
    await page.goto(URL);
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
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

  it.skip('should create an input node when double clicking the left column', async () => {
    // Get grid handle
    const gridHandle = await page.evaluateHandle(() => {
      return document.querySelector('nano-repatch')
        .shadowRoot.querySelector('workspace-layout')
        .shadowRoot.querySelector('graph-editor')
        .shadowRoot.querySelector('graph-grid');
    });

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
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const nodes = Array.from(grid.shadowRoot.querySelectorAll('graph-node'));
      return nodes.some(n => n.node && n.node.config.typeId === 'primitive_input');
    });
  });

  it.skip('should create an output node when double clicking the right column', async () => {
    // Get grid handle
    const gridHandle = await page.evaluateHandle(() => {
      return document.querySelector('nano-repatch')
        .shadowRoot.querySelector('workspace-layout')
        .shadowRoot.querySelector('graph-editor')
        .shadowRoot.querySelector('graph-grid');
    });

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
      const layout = app.shadowRoot.querySelector('workspace-layout');
      const editor = layout.shadowRoot.querySelector('graph-editor');
      const grid = editor.shadowRoot.querySelector('graph-grid');
      const nodes = Array.from(grid.shadowRoot.querySelectorAll('graph-node'));
      return nodes.some(n => n.node && n.node.config.typeId === 'primitive_output');
    });
  });
});

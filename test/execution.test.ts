import { Page } from 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('Graph Execution E2E', () => {
  // page is global from jest-puppeteer

  beforeEach(async () => {
    // Enable console log forwarding
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      // Filter out HMR logs
      if (!text.includes('[vite]')) {
        // console.log(`PAGE LOG: ${text}`);
      }
    });

    await page.goto(URL);
    await page.setViewport({ width: 1280, height: 800 });

    // Wait for graph-editor to be available
    await page.waitForFunction(() => {
      const app = document.querySelector('nano-repatch');
      return app && app.shadowRoot && app.shadowRoot.querySelector('workspace-layout');
    });

    // Inject helper to get graph-editor
    await page.evaluate(() => {
      (window as any).getGraphEditor = () => {
        const app = document.querySelector('nano-repatch');
        if (!app || !app.shadowRoot) return null;
        const layout = app.shadowRoot.querySelector('workspace-layout');
        if (!layout || !layout.shadowRoot) return null;
        return layout.shadowRoot.querySelector('graph-editor');
      };
    });

    // Clear existing graph
    await page.evaluate(() => {
      const controller = (window as any).testing.appController;
      controller.loadGraph({ nodes: {}, connections: {} });
    });
  });

  it('should execute graph and update debug overlay', async () => {
    // 1. Create Input Node (Double click left column)
    await page.evaluate(() => {
      const editor = (window as any).getGraphEditor();
      const grid = editor.shadowRoot!.querySelector('graph-grid')!;
      grid.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        composed: true,
        clientX: 50, // Left column
        clientY: 100
      }));
    });

    // 2. Create Output Node (Double click right column)
    await page.evaluate(() => {
      const editor = (window as any).getGraphEditor();
      const grid = editor.shadowRoot!.querySelector('graph-grid')!;
      const rect = grid.getBoundingClientRect();

      // Calculate viewport-relative X coordinate
      // We want to click inside the right column (width - 130 to width)
      // Let's target 50px from the right edge
      const clickX = rect.left + rect.width - 50;

      grid.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        composed: true,
        clientX: clickX,
        clientY: 100
      }));
    });

    // Wait for nodes
    await page.waitForFunction(() => {
      const nodes = (window as any).testing.appController.getState().graph.inner.nodes;
      const count = Object.keys(nodes).length;
      return count === 2;
    });

    // Get Node IDs
    const nodeIds = await page.evaluate(() => {
      const nodes = (window as any).testing.appController.getState().graph.inner.nodes;
      let inputId, outputId;
      for (const [id, node] of Object.entries(nodes) as any) {
        if (node.config.typeId === 'input') inputId = id;
        if (node.config.typeId === 'output') outputId = id;
      }
      return { inputId, outputId };
    });

    if (!nodeIds.inputId || !nodeIds.outputId) throw new Error('Nodes not created correctly');

    // 3. Connect Input -> Output
    await page.evaluate(({ inputId, outputId }) => {
      (window as any).testing.appController.createConnection(inputId, '0', outputId, '0');
    }, nodeIds);

    // 4. Verify Debug Overlay
    // Wait for overlay to appear and show nodes
    await page.waitForFunction(() => {
      const editor = (window as any).getGraphEditor();
      return !!editor?.shadowRoot?.querySelector('debug-overlay');
    });

    // Input node has no value initially unless we set it.
    // Let's set input value via virtual slider.

    // Find input slider in Input Node
    await page.evaluate((inputId) => {
      const editor = (window as any).getGraphEditor();
      const grid = editor!.shadowRoot!.querySelector('graph-grid');
      const node = grid!.shadowRoot!.querySelector(`graph-node[data-id="${inputId}"]`);
      const input = node!.shadowRoot!.querySelector('.virtual-input-field') as HTMLInputElement;
      if (!input) throw new Error('Input field not found');
      input.value = '42';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }, nodeIds.inputId);

    // 5. Verify Output in Overlay
    // The overlay should show the output node with value 42 (since it's connected to input)
    // Overlay format: ID Value
    if (!nodeIds.outputId) throw new Error('Output node not found');
    await page.waitForFunction((outputId) => {
      const editor = (window as any).getGraphEditor();
      const overlay = editor.shadowRoot!.querySelector('debug-overlay');
      if (!overlay) return false;
      const text = overlay.shadowRoot!.textContent;
      return text && text.includes(outputId) && text.includes('42');
    }, {}, nodeIds.outputId);

    // Also verify stats
    const statsText = await page.evaluate(() => {
      const editor = (window as any).getGraphEditor();
      const overlay = editor.shadowRoot!.querySelector('debug-overlay');
      return overlay!.shadowRoot!.querySelector('.stats')!.textContent;
    });
    expect(statsText).toContain('nodes executed');
  });
});

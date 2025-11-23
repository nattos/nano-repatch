import puppeteer, { Browser, Page } from 'puppeteer';

describe('Graph Execution E2E', () => {
  jest.setTimeout(30000);
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    console.log('Navigating to page...');
    await page.goto('http://localhost:5173');
    console.log('Waiting for selector...');
    await page.waitForSelector('graph-editor');
    console.log('Clearing graph...');
    // Clear graph
    await page.evaluate(() => {
      (window as any).testing.appController.clear();
    });
    console.log('Graph cleared.');
  });

  it('should execute graph and update debug overlay', async () => {
    // 1. Create Input Node (Double click left column)
    await page.evaluate(() => {
      const grid = document.querySelector('graph-editor')!.shadowRoot!.querySelector('graph-grid')!;
      grid.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        composed: true,
        clientX: 50, // Left column
        clientY: 100
      }));
    });

    // 2. Create Output Node (Double click right column)
    await page.evaluate(() => {
      const grid = document.querySelector('graph-editor')!.shadowRoot!.querySelector('graph-grid')!;
      const { width } = grid.getBoundingClientRect();
      grid.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        composed: true,
        clientX: width - 50, // Right column
        clientY: 100
      }));
    });

    // Wait for nodes
    await page.waitForFunction(() => {
      const nodes = (window as any).testing.appController.getState().graph.inner.nodes;
      return Object.keys(nodes).length === 2;
    });

    // Get Node IDs
    const nodeIds = await page.evaluate(() => {
      const nodes = (window as any).testing.appController.getState().graph.inner.nodes;
      const ids = Object.keys(nodes);
      const inputId = ids.find(id => nodes[id].config.typeId === 'input');
      const outputId = ids.find(id => nodes[id].config.typeId === 'output');
      return { inputId, outputId };
    });

    // 3. Connect Input -> Output
    await page.evaluate(({ inputId, outputId }) => {
      (window as any).testing.appController.createConnection(inputId, '0', outputId, '0');
    }, nodeIds);

    // 4. Verify Debug Overlay
    // Wait for overlay to appear and show nodes
    await page.waitForSelector('graph-editor >>> debug-overlay');

    // Check if output node has value (initially undefined or default?)
    // Input node has no value initially unless we set it.
    // Let's set input value via virtual slider.

    // Find input slider in Input Node
    // We need to access shadow DOM of graph-node
    // This is tricky with puppeteer selectors.
    // Let's use evaluate to find the input element.

    await page.evaluate((inputId) => {
      const editor = document.querySelector('graph-editor');
      const grid = editor!.shadowRoot!.querySelector('graph-grid');
      const node = grid!.shadowRoot!.querySelector(`graph-node[data-id="${inputId}"]`);
      const input = node!.shadowRoot!.querySelector('input[type="number"]') as HTMLInputElement;
      input.value = '42';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }, nodeIds.inputId);

    // 5. Verify Output in Overlay
    // The overlay should show the output node with value 42 (since it's connected to input)
    // Overlay format: ID Value
    if (!nodeIds.outputId) throw new Error('Output node not found');
    await page.waitForFunction((outputId) => {
      const overlay = document.querySelector('graph-editor')!.shadowRoot!.querySelector('debug-overlay');
      const text = overlay!.shadowRoot!.textContent;
      return text && text.includes(outputId) && text.includes('42');
    }, {}, nodeIds.outputId);

    // Also verify stats
    const statsText = await page.evaluate(() => {
      const overlay = document.querySelector('graph-editor')!.shadowRoot!.querySelector('debug-overlay');
      return overlay!.shadowRoot!.querySelector('.stats')!.textContent;
    });
    expect(statsText).toContain('Nodes Executed');
  });
});

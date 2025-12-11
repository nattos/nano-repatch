import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

describe('Dynamic Pack Ports', () => {
  let browser: puppeteer.Browser;
  let page: puppeteer.Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();

    // Enable Log Forwarding
    page.on('console', msg => console.log(msg.text()));

    // Load App
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle0' });

    // Wait for AppController
    await page.waitForFunction(() => (window as any).testing?.appController);
  });

  afterAll(async () => {
    await browser.close();
  });

  it('renders 4 input ports for core.pack (float4)', async () => {
    // Load tester4.json using fs to avoid module wrapping issues
    const graphPath = path.resolve(__dirname, '../../graphs/tester4.json');
    const graphString = fs.readFileSync(graphPath, 'utf-8');

    await page.evaluate((graph) => {
      (window as any).testing.appController.loadGraph(JSON.parse(graph));
    }, graphString);

    await new Promise(r => setTimeout(r, 3000)); // Wait for render and inference

    // Find the core.pack node. ID is node-5f33f391-85ff-4e7e-8ecd-cbc2a841a010
    const nodeId = 'node-5f33f391-85ff-4e7e-8ecd-cbc2a841a010';

    // Check for standard ports x, y, z, w
    const hasPort = async (name: string) => {
        return await page.evaluate((id, portName) => {
             // Drill down shadow DOMs to find grid
             const app = document.querySelector('nano-repatch');
             const layout = app?.shadowRoot?.querySelector('workspace-layout');
             const editor = layout?.shadowRoot?.querySelector('graph-editor');
             const grid = editor?.shadowRoot?.querySelector('graph-grid');

             if (!grid || !grid.shadowRoot) return false;

             const nodes = Array.from(grid.shadowRoot.querySelectorAll('graph-node'));
             const node = nodes.find((n: any) => n.node && n.node.id === id);
             if (!node) return false;

             const shadow = node.shadowRoot;
             if (!shadow) return false;

             // Check .slider-label (used when input editor covers port)
             const sliderLabels = Array.from(shadow.querySelectorAll('.slider-label'));
             if (sliderLabels.some((p: any) => p.textContent.trim() === portName)) return true;

             // Check graph-port name property
             const graphPorts = Array.from(shadow.querySelectorAll('graph-port'));
             if (graphPorts.some((p: any) => p.name === portName || p.getAttribute('name') === portName)) return true;


             return false;
        }, nodeId, name);
    };

    expect(await hasPort('x')).toBe(true);
    expect(await hasPort('y')).toBe(true);
    expect(await hasPort('z')).toBe(true);
    expect(await hasPort('w')).toBe(true);
  });
});

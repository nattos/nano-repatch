
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

describe('Reproduction Tester3 Alignment', () => {
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

  it('verifies mod -> dividend wire alignment in tester3.json', async () => {
    // Load JSON Content
    const jsonPath = path.resolve(__dirname, '../../graphs/tester3.json');
    const graphData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    // Inject Graph
    await page.evaluate((data) => {
        const { appController } = (window as any).testing;
        appController.loadGraph(data);
    }, graphData);

    // Wait for render with manual polling
    await new Promise(r => setTimeout(r, 500));

    const result = await page.evaluate(async () => {
        const waitForGrid = async () => {
            const start = Date.now();
            while (Date.now() - start < 5000) {
                const app = document.querySelector('nano-repatch');
                const layout = app?.shadowRoot?.querySelector('workspace-layout');
                const editor = layout?.shadowRoot?.querySelector('graph-editor');
                const grid = editor?.shadowRoot?.querySelector('graph-grid');

                if (grid && grid.shadowRoot) return grid;
                await new Promise(r => setTimeout(r, 100));
            }
            return null;
        };

        const grid = await waitForGrid();
        if (!grid) {
            return {
                error: 'No grid found after polling',
                // ...
            };
        }

        // DEBUG: Computed Style
        const style = window.getComputedStyle(grid.shadowRoot!.host as Element);
        const rows = style.getPropertyValue('grid-template-rows');
        const gap = style.getPropertyValue('--grid-gap');
        console.log(`DEBUG: grid-template-rows: ${rows}`);
        console.log(`DEBUG: grid-gap var: ${gap}`);

        // DEBUG: Computed Style of Row 0 Cell
        const row0Cell = grid.shadowRoot!.querySelector('.cell.node-cell[data-y="0"]');
        if (row0Cell) {
             const cs = window.getComputedStyle(row0Cell);
             console.log(`DEBUG: Row 0 Cell Height: ${cs.height}`);
             console.log(`DEBUG: Row 0 Cell MinHeight: ${cs.minHeight}`);
             console.log(`DEBUG: Row 0 Cell OuterHTML: ${row0Cell.outerHTML}`);
        } else {
             console.log('DEBUG: No Row 0 Cell found.');
        }


        const wireSegs = Array.from(grid.shadowRoot!.querySelectorAll('.wire-segment'));
        // We expect ONE wire from Node 1 (Mod) to Node 2 (Dividend)
        // From JSON:
        // Left Node (1,1) ID ending in dda1f9a26d04. Output 'mod' (index 1 / bottom)
        // Right Node (3,1) ID ending in efe20918fd19. Input 'dividend' (index 0 / top)

        // Find Source Node (Hub) and Dest Node (Pack)
        const sourceNodeEl = grid.shadowRoot.querySelector('graph-node[data-id="node-7a3d051a-c3e1-4184-8c76-cf0dec8e8f48"]');
        const destNodeEl = grid.shadowRoot.querySelector('graph-node[data-id="node-bfa849bb-1804-47be-b906-bf09488a88e7"]');

        if (!sourceNodeEl || !destNodeEl) return { error: 'Nodes not found' };

        // Helper to get Wire Y
        const getWireY = (wireId: string, suffix: 'start' | 'end') => {
             let stub = grid.shadowRoot!.getElementById(`${wireId}-${suffix}`);

             // Fallback for Hidden Stubs (e.g. Full Nodes): Check Gap Segment
             if (suffix === 'start' && (!stub || !stub.querySelector('.wire-line'))) {
                  // Usually the first path segment (index 0) is the Gap Segment adjacent to Start
                  const gapSeg = grid.shadowRoot!.getElementById(`${wireId}-0`);
                  if (gapSeg) stub = gapSeg;
             }

             if (!stub) {
                  const allSegments = Array.from(grid.shadowRoot!.querySelectorAll(`.wire-segment[data-wire-id="${wireId}"]`));
                  return { error: `Wire segment ${wireId}-${suffix} not found. Found: ${allSegments.map(s => s.id).join(', ')}` };
             }

             const line = stub.querySelector('.wire-line') as HTMLElement;
             const r = stub.getBoundingClientRect();

             console.log(`DEBUG: Wire Stub ${wireId}-${suffix}: Top=${r.top}, HTML=${stub.outerHTML}`);

             if (!line) {
                 // No visible line? Use data-wire-level from container.
                 // This attribute reflects the calculated visual offset relative to cell top.
                 const wireLevel = stub.dataset.wireLevel;
                 if (wireLevel) {
                     const yOffset = parseFloat(wireLevel);
                     return { y: r.top + yOffset, h: 2 }; // Assume standard trace height
                 }

                 // Fallback if data attribute missing (shouldn't happen)
                 return { y: r.top + r.height/2, h: 0 };
             }

             const transform = line.style.transform;
             const m = transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
             let yOffset = m ? parseFloat(m[1]) : 0;

             if (!m && line.style.top) {
                 yOffset = parseFloat(line.style.top);
             }

             let height = 0;
             if (line.style.height) {
                 if (line.style.height.endsWith('%')) {
                     // Inner line 100% height = Stub Height
                     height = r.height;
                 } else {
                     height = parseFloat(line.style.height);
                 }
             } else {
                 height = r.height; // Fallback
             }

             return { y: r.top + yOffset, h: height };
        };

        // Wire ID from JSON: conn-fbb4b059-3bc4-43ca-a2af-44022b873807
        const wireId = "conn-fbb4b059-3bc4-43ca-a2af-44022b873807";

        const startObj = getWireY(wireId, 'start');
        const endObj = getWireY(wireId, 'end');

        if ((startObj as any).error) return startObj;
        if ((endObj as any).error) return endObj;

        return {
            sourceTop: sourceNodeEl.getBoundingClientRect().top,
            destTop: destNodeEl.getBoundingClientRect().top,
            startY: startObj,
            endY: endObj
        };
    });

    if ((result as any).error) throw new Error((result as any).error);

    const { sourceTop, destTop, startY: startYObj, endY: endYObj } = result as any;

    // Expectations
    const TARGET_START = 38;
    const TARGET_END = 86;
    const TOLERANCE = 4;

    // Verify Start
    const startY = startYObj.y;
    const startH = startYObj.h;

    // Check Range
    const startMin = startY;
    const startMax = startY + startH;
    const targetStartAbs = sourceTop + TARGET_START;

    const startOk = (targetStartAbs >= startMin - TOLERANCE && targetStartAbs <= startMax + TOLERANCE);

    // Verify End
    const endY = endYObj.y;
    const endH = endYObj.h;

    const endMin = endY;
    const endMax = endY + endH;
    const targetEndAbs = destTop + TARGET_END;

    const endOk = (targetEndAbs >= endMin - TOLERANCE && targetEndAbs <= endMax + TOLERANCE);

    if (!startOk) {
        throw new Error(`Source Alignment Failed. Target ${targetStartAbs} not in [${startMin}, ${startMax}]`);
    }
    if (!endOk) {
        throw new Error(`Dest Alignment Failed. Target ${targetEndAbs} not in [${endMin}, ${endMax}]`);
    }
    // PASS

  }, 30000);
});

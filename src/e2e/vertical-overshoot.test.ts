import 'puppeteer';
import { tracePaths } from './path-trace-util';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('Vertical Wire Overshoot Test', () => {
    beforeAll(async () => {
        await page.goto(URL);
        await page.setViewport({ width: 1200, height: 800 });
        await page.waitForSelector('nano-repatch');
    });

    beforeEach(async () => {
        await page.evaluate(() => {
            if ((window as any).testing && (window as any).testing.appController) {
                (window as any).testing.appController.loadGraph({ nodes: {}, connections: {} });
            }
        });
        await page.waitForFunction(() => {
             const app = document.querySelector('nano-repatch');
             const layout = app?.shadowRoot?.querySelector('workspace-layout');
             const editor = layout?.shadowRoot?.querySelector('graph-editor');
             const grid = editor?.shadowRoot?.querySelector('graph-grid');
             return grid && grid.shadowRoot.querySelectorAll('graph-node').length === 0;
        });
    });

    async function createNode(type: string, x: number, y: number) {
        return await page.evaluate((type, x, y) => {
            const node = (window as any).testing.appController.createNode(type, x, y);
            return node.id;
        }, type, x, y);
    }

    async function createConnection(fromId: string, toId: string, fromPort = '0', toPort = '0') {
        await page.evaluate((fromId, toId, fromPort, toPort) => {
            (window as any).testing.appController.createConnection(fromId, fromPort, toId, toPort);
        }, fromId, toId, fromPort, toPort);
    }

    async function getWireSegments() {
        return await page.evaluate(() => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!.querySelector('workspace-layout')!.shadowRoot!.querySelector('graph-editor')!.shadowRoot!.querySelector('graph-grid')!;
            const segments = Array.from(grid.shadowRoot!.querySelectorAll('.wire-segment'));
            return segments.map(el => {
                const rect = el.getBoundingClientRect();
                const type = Array.from(el.classList).find(c => ['h','v','ctl','ctr','cbl','cbr','start','end'].includes(c)) || 'unknown';
                const dataset = (el as HTMLElement).dataset;
                const lines = Array.from(el.querySelectorAll('.wire-line')).map(l => {
                    const r = l.getBoundingClientRect();
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                });
                return { type, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, dataset, lines };
            });
        });
    }

    it('connects FMod:mod to Hub on same row without vertical overshoot', async () => {
        // 1. Create Nodes on Row 0
        const fmodId = await createNode('math.fmod', 0, 0);
        const hubId = await createNode('util.hub', 2, 0);

        // 2. Connect FMod:mod (Index 1) to Hub:value (Index 0)
        await createConnection(fmodId, hubId, 'mod', 'value');

        await new Promise(r => setTimeout(r, 500)); // Wait for render

        // 3. Trace Wire
        const segments = await getWireSegments();
        // Flatten to boxes
        const boxes = segments.flatMap(s => s.lines.length > 0 ? s.lines : [{ x: s.rect.x, y: s.rect.y, width: s.rect.width, height: s.rect.height }]);

        const result = tracePaths(boxes);
        if (result.paths.length !== 1) {
            console.log('Detected Segments:', segments);
            throw new Error(`Expected 1 wire path, found ${result.paths.length}`);
        }
        const path = result.paths[0];

        // 4. Analyze Vertical Segments
        console.log('Path Boxes:', path.boxes);

        // Find vertical segments (Height > Width + Tolerance)
        const verticalSegments = path.boxes.filter(b => b.height > b.width + 2);

        if (verticalSegments.length === 0) {
             console.warn("No vertical segments found. Check if direct line?");
        } else {
            for (const v of verticalSegments) {
                console.log(`Vertical Segment: y=${v.y} h=${v.height} bottom=${v.y+v.height}`);

                // Overshoot Check: If height is drastically larger than the port separation (~24px)
                // e.g. if it's 80px (full cell height) it's likely an overshoot/bug in coalescing.
                if (v.height > 60) {
                    throw new Error(`Vertical segment overshoot detected! Height: ${v.height}px (Expected ~24px)`);
                }
            }
        }
    });
});

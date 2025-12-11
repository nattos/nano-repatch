import 'puppeteer';
import { tracePaths } from './path-trace-util';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('Diagonal Broken Wire Test', () => {
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

    it('connects FMod:mod (Row 0) to Hub (Row 1) without breaking', async () => {
        // 1. Create Nodes
        const fmodId = await createNode('math.fmod', 0, 0);
        const hubId = await createNode('util.hub', 2, 1); // Row 1

        // 2. Connect FMod:mod (Index 1) to Hub:value (Index 0)
        await createConnection(fmodId, hubId, 'mod', 'value');

        await new Promise(r => setTimeout(r, 500)); // Wait for render

        // 3. Trace Wire
        const segments = await getWireSegments();
        // Flatten to boxes
        const boxes = segments.flatMap(s => s.lines.length > 0 ? s.lines : [{ x: s.rect.x, y: s.rect.y, width: s.rect.width, height: s.rect.height }]);

        const result = tracePaths(boxes);

        // Debug
        if (result.paths.length !== 1) {
            console.log('Detected Segments:', segments);
            console.log('Detected Boxes:', boxes);
            throw new Error(`Expected 1 continuous wire path, found ${result.paths.length}. The wire is broken.`);
        }
    });
});

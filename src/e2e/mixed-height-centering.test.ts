import 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('Mixed Height Centering Test', () => {
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

    it('centers a short node vertically when sharing a row with a tall node', async () => {
        // 1. Create a Short Node (Hub)
        const shortNodeId = await createNode('util.hub', 0, 0);

        // 2. Create a "Tall" node. We'll use a standard node and force its height via CSS/JS
        // because we don't strictly know which node is "tall" by default without exploring.
        const tallNodeId = await createNode('math.clamp', 2, 0); // Same row

        await new Promise(r => setTimeout(r, 500)); // Wait for render

        // 3. Force height of tall node to be double (e.g. 200px)
        await page.evaluate((id) => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!
                .querySelector('workspace-layout')!.shadowRoot!
                .querySelector('graph-editor')!.shadowRoot!
                .querySelector('graph-grid')!;
            const nodeEl = Array.from(grid.shadowRoot!.querySelectorAll('graph-node')).find(n => n.getAttribute('data-id') === id) as HTMLElement;
            if (nodeEl) {
                nodeEl.style.height = '200px';
                // We also need to ensure the CELL respects this?
                // Grid 'auto' row should expand.
            }
        }, tallNodeId);

        await new Promise(r => setTimeout(r, 500)); // Layout update

        // 4. Measure Rects
        const positions = await page.evaluate((shortId, tallId) => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!
                .querySelector('workspace-layout')!.shadowRoot!
                .querySelector('graph-editor')!.shadowRoot!
                .querySelector('graph-grid')!;

            const nodes = Array.from(grid.shadowRoot!.querySelectorAll('graph-node')) as HTMLElement[];

            // DEBUG: Log all node IDs found
            const nodeIds = nodes.map(n => (n as any).node?.id);
            console.log('Available GraphNodes (node.id):', nodeIds);

            // Use property check or simply find by coordinate logic if needed, but prop check should work if cast correctly
            // Let's assume order: short (created first) might be first in DOM?
            // Better: Check internal property via `any`
            const shortEl = nodes.find(n => n.getAttribute('data-id') === shortId);
            const tallEl = nodes.find(n => n.getAttribute('data-id') === tallId);

            if (!shortEl) throw new Error(`Short Node ${shortId} not found in DOM`);
            if (!tallEl) throw new Error(`Tall Node ${tallId} not found in DOM`);

            const sRect = shortEl.getBoundingClientRect();
            const tRect = tallEl.getBoundingClientRect();

            // Explicitly serialize DOMRect properties
            const shortRect = { x: sRect.x, y: sRect.y, width: sRect.width, height: sRect.height };
            const tallRect = { x: tRect.x, y: tRect.y, width: tRect.width, height: tRect.height };

            return { shortRect, tallRect };
        }, shortNodeId, tallNodeId);

        console.log('Positions:', positions);

        // Measure Tall Node's computed styles
        const styles = await page.evaluate((tallId) => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!
                .querySelector('workspace-layout')!.shadowRoot!
                .querySelector('graph-editor')!.shadowRoot!
                .querySelector('graph-grid')!;
            const nodeEl = Array.from(grid.shadowRoot!.querySelectorAll('graph-node')).find(n => n.getAttribute('data-id') === tallId) as HTMLElement;
            if (nodeEl) {
                const computedStyle = window.getComputedStyle(nodeEl);
                return {
                    height: computedStyle.height,
                    // Inspect internals
                    wrapperTop: (nodeEl.shadowRoot!.querySelector('.ports-wrapper') as HTMLElement).getBoundingClientRect().top - nodeEl.getBoundingClientRect().top,
                    inputsTop: (nodeEl.shadowRoot!.querySelector('.inputs') as HTMLElement).getBoundingClientRect().top - nodeEl.getBoundingClientRect().top,
                };
            }
            return null;
        }, tallNodeId); // Check Tall Node
        console.log('DOM Styles (Tall):', styles);

        // 5. Assert Centering
        const shortMidY = positions.shortRect.y + positions.shortRect.height / 2;
        const tallMidY = positions.tallRect.y + positions.tallRect.height / 2;

        const diff = Math.abs(shortMidY - tallMidY);
        console.log(`Midpoint Diff: ${diff}px`);

        if (diff > 5) {
             throw new Error(`Nodes are not centered! Diff: ${diff}px. ShortMid: ${shortMidY}, TallMid: ${tallMidY}`);
        }

        // 6. Verify Wire Alignment
        // Create a connection to verify wire attaches correctly to centered node
        await page.evaluate((shortId, tallId) => {
            const app = (window as any).testing.appController;
            // Connect Short (Hub) Output 0 -> Tall (Clamp) Input 'value' (or min?)
            // Hub has 'untagged' output usually, or named '0'? Hub output is named '0' in some tests?
            // util.hub has 1 input 'in' and 1 output 'out'?
            // Let's assume 'out' -> 'value'.
            // First check ports.
            // But we can just try to connect.
            // Logs show util.hub has output 'value'.
            app.createConnection(shortId, 'value', tallId, 'value');
        }, shortNodeId, tallNodeId);

        await new Promise(r => setTimeout(r, 500)); // Layout & Wire Render

        // Measure Port vs Wire
        const alignment = await page.evaluate((shortId) => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!
                .querySelector('workspace-layout')!.shadowRoot!
                .querySelector('graph-editor')!.shadowRoot!
                .querySelector('graph-grid')!;

            // Find the wire endpoint at Short Node (Output)
            // It's a 'start' segment or strict Horizontal line attached to port.
            // Short Node is at x=0. Port is on Right.
            // Wire start should be at x=1 (Gap). No, x=0 is node logic x.
            // Rendered grid column: Node at 2*0+3 = 3. Gap at 4.
            // We need to find the "Stub" wire segment (class .start or .h) connected to this node.

            // Easier: Find the PORT element. Measure its center Y.
            const shortNode = Array.from(grid.shadowRoot!.querySelectorAll('graph-node')).find(n => n.getAttribute('data-id') === shortId);
            const portEl = shortNode!.shadowRoot!.querySelector('.outputs graph-port');
            // We assume first output port

            if (!portEl) return { error: 'Port not found' };
            const portRect = portEl.getBoundingClientRect();
            const portMidY = portRect.y + portRect.height / 2;

            // Find the wire.
            // We can search all wires and find one that is close?
            // Or assume the only wire.
            const wireSegs = Array.from(grid.shadowRoot!.querySelectorAll('.wire-segment'));
            // Find a segment that is nearby our port.
            // Port is at Right of Node.
            // Segment should be to the right.

            let closestWireY = -1;
            let minDiff = 9999;

            for (const wire of wireSegs) {
                const r = wire.getBoundingClientRect();
                // Check X proximity
                if (r.x > portRect.right - 10 && r.x < portRect.right + 50) {
                     // Check for inner wire-line
                     const line = wire.querySelector('.wire-line');
                     if (line) {
                         const lr = line.getBoundingClientRect();
                         const wireMidY = lr.y + lr.height / 2;
                         const d = Math.abs(wireMidY - portMidY);
                         if (d < minDiff) {
                             minDiff = d;
                             closestWireY = wireMidY;
                         }
                     }
                }
            }

            return { portMidY, closestWireY, minDiff };
        }, shortNodeId);

            if (alignment.error) throw new Error(alignment.error);
            console.log(`Wire Alignment: { portMidY: ${Math.round(alignment.portMidY)}, closestWireY: ${Math.round(alignment.closestWireY)}, minDiff: ${Math.round(alignment.minDiff)} }`);

        // If detached, minDiff will be large (e.g. 12px or more).
        // If attached, should be ~0.
        if (alignment.minDiff > 5) {
            throw new Error(`Wire detached from port! Diff: ${alignment.minDiff}px`);
        }
    });

    it('maintains wire continuity for same-column nodes with large vertical gap', async () => {
        // 1. Create Top Node (Hub) at 0,0
        const topNodeId = await createNode('util.hub', 0, 0);

        // 2. Create Bottom Node (Hub) at 0, 4 (Gap of 3 rows)
        const bottomNodeId = await createNode('util.hub', 0, 4);

        await new Promise(r => setTimeout(r, 500));

        // 3. Connect Top to Bottom
        await page.evaluate((topId, botId) => {
            const app = (window as any).testing.appController;
            app.createConnection(topId, 'value', botId, 'value');
        }, topNodeId, bottomNodeId);

        await new Promise(r => setTimeout(r, 500));

        // 4. Analyze Segments
        const continuityError = await page.evaluate((botId) => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!
                .querySelector('workspace-layout')!.shadowRoot!
                .querySelector('graph-editor')!.shadowRoot!
                .querySelector('graph-grid')!;

            // Find the Port Stub at the Bottom Node (Input)

            const wireSegs = Array.from(grid.shadowRoot!.querySelectorAll('.wire-segment'));

            // Get Bottom Node Rect
            const botNode = Array.from(grid.shadowRoot!.querySelectorAll('graph-node')).find(n => n.getAttribute('data-id') === botId);
            const botRect = botNode!.getBoundingClientRect();
            // Input Port is at Left side.
            const portEl = botNode!.shadowRoot!.querySelector('.inputs graph-port');
            const portRect = portEl!.getBoundingClientRect();
            // Typically Port is circle or box. Mid point.
            const portMidY = portRect.top + portRect.height / 2;

            // Find the Stub attached to this port.
            // Horizontal segment ending at portRect.left (approx).
            const stub = wireSegs.find(w => {
                const r = w.getBoundingClientRect();
                const line = w.querySelector('.wire-line');
                if (!line) return false;
                const lr = line.getBoundingClientRect();
                // Check Y alignment match
                const yMatch = Math.abs((lr.top + lr.height/2) - portMidY) < 5;
                // Check X proximity
                const xMatch = Math.abs(lr.right - portRect.left) < 50;
                return yMatch && xMatch;
            });

            if (!stub) return { error: 'Stub not found' };

            const stubLine = stub.querySelector('.wire-line')!;
            const stubRect = stubLine.getBoundingClientRect();
            const stubY = stubRect.top + stubRect.height / 2;
            const stubLeft = stubRect.left;

            // Find the Vertical segment traversing down to this stub.
            // It should be a vertical segment where bottom ~ stubY, and left ~ stubLeft.
            const vertical = wireSegs.find(w => {
                 const className = w.className;
                 if (!className.includes('vertical')) return false;

                 const line = w.querySelector('.wire-line');
                 if (!line) return false;
                 const lr = line.getBoundingClientRect();

                 // X alignment: should match Stub Left (start of stub).
                 const xMatch = Math.abs(lr.left - stubLeft) < 10;
                 // Y alignment: bottom should match Stub Y.
                 const yMatch = Math.abs(lr.bottom - stubY) < 10;
                 // Note: Vertical might connect via a Corner if layout is different.
                 // But for strict same-column, usually Vertical drops to Stub level, then turns?
                 // Wait, Stub is horizontal.
                 // Vertical drops to y. Corner turns. Horizontal goes to port.
                 // So we should verify Vertical -> Corner -> Stub chain?
                 // Or just check if Vertical ends NEAR Stub Y/X?
                 // If there's a Corner, Vertical Bottom < Stub Y?
                 // Standard Manhatten: Vertical drops to Corner Y. Corner connects to Stub.
                 // Stub Y = Corner Y.
                 // Vertical Bottom = Corner Y.
                 // So Vertical Bottom = Stub Y.

                 return xMatch && yMatch;
            });

            // If direct vertical connection not found, check for Corner.
            if (!vertical) {
                 const corner = wireSegs.find(w => {
                     const className = w.className; // e.g. ne, nw, etc.
                     if (!className.includes('ne') && !className.includes('nw') && !className.includes('se') && !className.includes('sw')) return false;
                     // Corner that shares Y with Stub and X with Stub Left.
                     const r = w.getBoundingClientRect();
                     // Corner Y should align with Stub Y?
                     const cx = r.left + r.width/2;
                     const cy = r.top + r.height/2;

                     const xMatch = Math.abs(cx - stubLeft) < 10;
                     const yMatch = Math.abs(cy - stubY) < 10;
                     return xMatch && yMatch;
                 });
                 if (corner) return null; // Corner acts as link.

                 return { error: 'Vertical/Corner Discontinuity', stubY, stubLeft };
            }

            return null; // All good
        }, bottomNodeId);

        if (continuityError) {
             throw new Error(`Continuity Error: ${JSON.stringify(continuityError)}`);
        }
    });
});

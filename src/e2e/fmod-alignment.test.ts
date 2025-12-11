import 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

describe('FMod Alignment Test', () => {
    beforeAll(async () => {
        await page.goto(URL);
        await page.setViewport({ width: 1200, height: 800 });
        await page.waitForSelector('nano-repatch');
        page.on('console', msg => console.log(msg.text()));
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

    it('verifies fmod port order and wiring', async () => {
        // 1. Create fmod Node
        const fmodId = await page.evaluate(() => {
            const app = (window as any).testing.appController;
            const node = app.createNode('math.fmod', 0, 0);
            return node.id;
        });

        await new Promise(r => setTimeout(r, 500));

        // 2. Inspect Repository Definition (DOM Scrape Only)
        const repoInfo = await page.evaluate(() => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!
                .querySelector('workspace-layout')!.shadowRoot!
                .querySelector('graph-editor')!.shadowRoot!
                .querySelector('graph-grid')!;

            // Find our node (created at 0,0 - likely first one)
            // Use generic selector to handle any ID
            const nodeEl = grid.shadowRoot!.querySelector('graph-node');

            if (!nodeEl) return { error: 'Node not found' };

            const inputPorts = Array.from(nodeEl.shadowRoot.querySelectorAll('.inputs graph-port')).map((p: any) => p.name);
            const outputPorts = Array.from(nodeEl.shadowRoot.querySelectorAll('.outputs graph-port')).map((p: any) => p.name);

            return {
                inputs: inputPorts,
                outputs: outputPorts
            };
        });

        console.log('Visual Port Order:', repoInfo);

        if (repoInfo.error) throw new Error(repoInfo.error);
        if (repoInfo.inputs.length < 2) throw new Error('Expected 2 inputs on fmod, found ' + repoInfo.inputs.length);

        // 3. Connect Wires based on discovered names
        const input0 = repoInfo.inputs[0];
        const input1 = repoInfo.inputs[1];

        const output0 = repoInfo.outputs[0]; // Assuming src has same type
        const output1 = repoInfo.outputs[1];

        console.log(`Connecting: ${output0} -> ${input0}, ${output1} -> ${input1}`);

        // Ensure we have a source node. Use fmod output to loopback or another fmod.
        const fmod2Id = await page.evaluate(() => {
            const app = (window as any).testing.appController;
            return app.createNode('math.fmod', 4, 0).id;
        });

        await new Promise(r => setTimeout(r, 500));

        await page.evaluate((src, dst, out0, in0, out1, in1) => {
            const app = (window as any).testing.appController;
            app.createConnection(src, out0, dst, in0);
            app.createConnection(src, out1, dst, in1);
        }, fmodId, fmod2Id, output0, input0, output1, input1);

        await new Promise(r => setTimeout(r, 500));

        // 4. Measure Alignment
        const alignment = await page.evaluate((dstId) => {
            const grid = document.querySelector('nano-repatch')!.shadowRoot!
                .querySelector('workspace-layout')!.shadowRoot!
                .querySelector('graph-editor')!.shadowRoot!
                .querySelector('graph-grid')!;

            const dstNode = Array.from(grid.shadowRoot!.querySelectorAll('graph-node')).find(n => n.getAttribute('data-id') === dstId);
            const inputs = Array.from(dstNode!.shadowRoot!.querySelectorAll('.inputs graph-port'));

            // Input 0: Dividend
            const divPort = inputs[0];
            const divRect = divPort.getBoundingClientRect();
            const divMidY = divRect.top + divRect.height / 2;

            // Input 1: Divisor
            const modPort = inputs[1]; // assuming 2 ports
            const modRect = modPort.getBoundingClientRect();
            const modMidY = modRect.top + modRect.height / 2;

            const wireSegs = Array.from(grid.shadowRoot!.querySelectorAll('.wire-segment'));

            // Helper to get actual visual Y of the wire line inside segment
            const getWireY = (w: Element) => {
                 const r = w.getBoundingClientRect();
                 const line = w.querySelector('.wire-line') as HTMLElement;
                 if (!line) return r.top + r.height/2; // Fallback

                 // transform: translateY(33px)
                 const transform = line.style.transform;
                 const m = transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
                 const yOffset = m ? parseFloat(m[1]) : 0;

                 // Container Top + yOffset + LineHalfHeight (1px)
                 return r.top + yOffset + 1;
            };

            const segments = wireSegs.map(w => {
                 const r = w.getBoundingClientRect();
                 return {
                      x: r.x, y: r.y, w: r.width, h: r.height,
                      lineY: getWireY(w)
                 };
            });

            // Find wire near Input 0 (Checking lineY)
            const wire0 = wireSegs.find(w => {
                 const r = w.getBoundingClientRect();
                 const y = getWireY(w);
                 // Check X alignment (Right edge of wire should meet Left edge of Port)
                 // Check Y alignment (Line Y should match Port Mid Y)
                 return Math.abs(r.right - divRect.left) < 50 && Math.abs(y - divMidY) < 5;
            });

            // Find wire near Input 1
            const wire1 = wireSegs.find(w => {
                 const r = w.getBoundingClientRect();
                 const y = getWireY(w);
                 return Math.abs(r.right - modRect.left) < 100 && Math.abs(y - modMidY) < 5;
            });

            return {
                divPortY: divMidY,
                modPortY: modMidY,
                foundWire0: !!wire0,
                foundWire1: !!wire1,
                segments,
                divRect: { top: divRect.top, left: divRect.left },
                modRect: { top: modRect.top, left: modRect.left }
            };
        }, fmod2Id);

        console.log('Alignment:', alignment);

        if (!alignment.foundWire0) throw new Error('Wire to Dividend (Input 0) not found');
        if (!alignment.foundWire1) throw new Error('Wire to Divisor (Input 1) not found');

    });
});

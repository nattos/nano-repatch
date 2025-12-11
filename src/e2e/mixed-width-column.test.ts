// @ts-nocheck
import 'puppeteer';
import { tracePaths, validatePathMetrics, PathMetrics } from './path-trace-util';


const PORT = 5173;
const URL = `http://localhost:${PORT}`;


describe('Mixed Width Columns Wire Test', () => {
    beforeAll(async () => {
        await page.goto(URL);
        await page.setViewport({ width: 1200, height: 800 });

        // Enable console log forwarding
        page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        if (!text.includes('[vite]')) {
            console.log(`PAGE LOG: ${text}`);
        }
        });

        await page.waitForSelector('nano-repatch');
    });

    beforeEach(async () => {
        // Clear graph
        await page.evaluate(() => {
        if (window.testing && window.testing.appController) {
            window.testing.appController.loadGraph({ nodes: {}, connections: {} });
        }
        });
        // Wait for clear
        await page.waitForFunction(() => {
        const app = document.querySelector('nano-repatch');
        const layout = app?.shadowRoot?.querySelector('workspace-layout');
        const editor = layout?.shadowRoot?.querySelector('graph-editor');
        const grid = editor?.shadowRoot?.querySelector('graph-grid');
        return grid && grid.shadowRoot.querySelectorAll('graph-node').length === 0;
        });
    });

    async function createNode(type, x, y, expectedTotal) {
        const id = await page.evaluate((type, x, y) => {
        const node = window.testing.appController.createNode(type, x, y);
        return node.id;
        }, type, x, y);

        await page.waitForFunction((count) => {
        const app = document.querySelector('nano-repatch');
        const grid = app?.shadowRoot?.querySelector('workspace-layout')?.shadowRoot?.querySelector('graph-editor')?.shadowRoot?.querySelector('graph-grid');
        return grid?.shadowRoot?.querySelectorAll('graph-node').length === count;
        }, {}, expectedTotal);
        return id;
    }

    // Helper to create connection
    async function createConnection(fromId, toId, fromPort = '0', toPort = '0') {
        await page.evaluate((fromId, toId, fromPort, toPort) => {
            window.testing.appController.createConnection(fromId, fromPort, toId, toPort);
        }, fromId, toId, fromPort, toPort);
    }

    async function getWireSegments(page) {
        return await page.evaluate(() => {
        const grid = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
        const segments = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment'));
        return segments.map(el => {
            const rect = el.getBoundingClientRect();
            const type = Array.from(el.classList).find(c => ['h','v','ctl','ctr','cbl','cbr','start','end'].includes(c)) || 'unknown';
            const dataset = (el).dataset;
            const lines = Array.from(el.querySelectorAll('.wire-line')).map(l => {
                const r = l.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            });
            return { type, rect: { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, dataset, lines };
        });
        });
    }

    // Helper to get node info including ports
    async function getNodeInfo(nodeId) {
        return await page.evaluate((id) => {
        const grid = document.querySelector('nano-repatch').shadowRoot
            .querySelector('workspace-layout').shadowRoot
            .querySelector('graph-editor').shadowRoot
            .querySelector('graph-grid');
        const node = grid.shadowRoot.querySelector(`graph-node[data-id="${id}"]`);
        if (!node) return null;
        const rect = node.getBoundingClientRect();

        const getPorts = (selector) => Array.from(node.shadowRoot.querySelectorAll(selector)).map(el => {
            const r = el.getBoundingClientRect();
            return {
            name: el.getAttribute('name') || '0',
            rect: { x: r.x, y: r.y, top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height }
            };
        });

        return {
            id,
            rect: { x: rect.x, y: rect.y, top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width, height: rect.height },
            inputs: getPorts('graph-port[type="in"]'),
            outputs: getPorts('graph-port[type="out"]')
        };
        }, nodeId);
    }


    // Robust validation using tracePaths utility
    async function validateWire(sourceId, sourcePortName, destId, destPortName, expectedMetrics?: PathMetrics) {
        const sourceInfo = await getNodeInfo(sourceId);
        const destInfo = await getNodeInfo(destId);

        if (!sourceInfo) throw new Error(`Source Node ${sourceId} not found`);
        if (!destInfo) throw new Error(`Dest Node ${destId} not found`);

        const sourcePort = sourceInfo.outputs.find(p => p.name === sourcePortName) || sourceInfo.outputs[0];
        const destPort = destInfo.inputs.find(p => p.name === destPortName) || destInfo.inputs[0];

        if (!sourcePort) throw new Error(`Source Port ${sourcePortName} not found on node ${sourceId}`);
        if (!destPort) throw new Error(`Dest Port ${destPortName} not found on node ${destId}`);

        // Get segments and map to BoundingBox
        const rawSegments = await getWireSegments(page);

        // Filter visible/valid segments
        const segmentBoxes = rawSegments
            .flatMap(s => {
                if (s.lines && s.lines.length > 0) {
                    return s.lines.map(l => ({
                        x: l.x, y: l.y, width: l.width, height: l.height
                    }));
                }
                // For start/end stubs, if they have no lines (invisible), we might skip them
                // but usually they have lines if they are part of the wire structure we test?
                if (s.type === 'unknown') return [];

                // If implicit/invisible segment?
                if (s.lines.length === 0) return [];

                return [{
                    x: s.rect.x, y: s.rect.y, width: s.rect.width, height: s.rect.height
                }];
            });

        if (segmentBoxes.length === 0) {
            throw new Error('No wire segments found.');
        }

        // Trace the wire segments only
        const result = tracePaths(segmentBoxes);

        // Check for connectivity among ALL found paths
        const consideredPaths = [];
        let matchingPath = null;

        for (const path of result.paths) {
             if (!path.isValid) continue;

             const pStart = path.boxes[0];
             const pEnd = path.boxes[path.boxes.length - 1];

             // Port Anchor Points (Right for Source, Left for Dest)
             const srcAnchor = { x: sourcePort.rect.right, y: sourcePort.rect.top + sourcePort.rect.height/2 };
             const dstAnchor = { x: destPort.rect.left, y: destPort.rect.top + destPort.rect.height/2 };

             const checkConn = (box, anchor, name) => {
                 const boxY = box.y + box.height/2;
                 const yDiff = Math.abs(boxY - anchor.y);
                 const dx = Math.max(box.x - anchor.x, 0, anchor.x - (box.x + box.width));

                 if (yDiff > 5) return { ok: false, msg: `Y-diff ${yDiff.toFixed(1)} boxY:${boxY.toFixed(1)} anchorY:${anchor.y.toFixed(1)}` };
                 if (dx > 20) return { ok: false, msg: `Gap ${dx.toFixed(1)} x:${box.x.toFixed(1)} anchorX:${anchor.x.toFixed(1)}` };
                 return { ok: true };
             };

             // Forward
             const startOk = checkConn(pStart, srcAnchor, 'Source');
             const endOk = checkConn(pEnd, dstAnchor, 'Dest');

             // Reverse
             const startRev = checkConn(pEnd, srcAnchor, 'Source');
             const endRev = checkConn(pStart, dstAnchor, 'Dest');

             if ((startOk.ok && endOk.ok) || (startRev.ok && endRev.ok)) {
                 matchingPath = path;
                 break;
             }
             consideredPaths.push({ path, startOk, endOk, startRev, endRev });
        }

        if (!matchingPath) {
             const debugInfo = consideredPaths.map((p, i) =>
                 `Path ${i}: Fwd(S:${p.startOk.ok ? 'OK' : p.startOk.msg}, E:${p.endOk.ok ? 'OK' : p.endOk.msg}) Rev(S:${p.startRev.ok ? 'OK' : p.startRev.msg}, E:${p.endRev.ok ? 'OK' : p.endRev.msg})`
             ).join('\n');
             throw new Error(`No wire found connecting ${sourceId}:${sourcePortName} to ${destId}:${destPortName}. Found ${result.paths.length} disconnected chains.\n${debugInfo}`);
        }

        // Metric Validation on the matching path
        if (expectedMetrics) {
            validatePathMetrics(matchingPath, expectedMetrics);
        }

        return matchingPath;
    }

    it('connects a centered Hub in a wide column to another node', async () => {
        // Scenario from user image:
        // Col 0: contains a Hub (Narrow) AND an FMod (Wide).
        // This forces Col 0 to be wide. Hub should be centered.
        // We test connection from Hub (centered) to another Hub (centered) in Col 2.
        // Col 2 also has mixed width to force centering there too?
        // Let's mimic user image:
        // Left Column: Hub (top), FMod (bottom).
        // Right Column: Hub (top), FMod (bottom).
        // Wire between Hubs.
        // Wire between FMods.

        // 1. Create Left Nodes (Col 0)
        const hubId1 = await createNode('util.hub', 0, 0, 1);
        const fmodId1 = await createNode('math.fmod', 0, 2, 2); // Below Hub

        // 2. Create Right Nodes (Col 2)
        // Note: Col 1 is Gap. Col 2 is Nodes.
        const hubId2 = await createNode('util.hub', 2, 0, 3);
        const fmodId2 = await createNode('math.fmod', 2, 2, 4);

        // 3. Connect Hub -> Hub
        await createConnection(hubId1, hubId2);

        // 4. Connect FMod -> FMod
        await createConnection(fmodId1, fmodId2, 'mod', 'divisor'); // bottom -> bottom ports

        await new Promise(r => setTimeout(r, 1000));

        // 5. Validation
        // Verify Hub connection
        await validateWire(hubId1, '0', hubId2, '0');

        // Verify FMod connection
        await validateWire(fmodId1, 'mod', fmodId2, 'divisor');
    });

});

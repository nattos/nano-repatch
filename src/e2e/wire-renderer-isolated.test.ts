// @ts-nocheck
import 'puppeteer';
import { tracePaths, validatePathMetrics, PathMetrics } from './path-trace-util';


const PORT = 5173;
const URL = `http://localhost:${PORT}`;





describe('Wire Layout Tests', () => {
  jest.setTimeout(30000);
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

      // Check for strictly ONE valid path that connects (the wire itself must be contiguous)
      if (result.paths.length !== 1) {
          const debugInfo = result.paths.map((p, i) =>
              `Path ${i} (${p.boxes.length} boxes): ` +
              p.boxes.map(b => `[x:${b.x.toFixed(1)}, y:${b.y.toFixed(1)}, w:${b.width.toFixed(1)}, h:${b.height.toFixed(1)}]`).join(' -> ')
          ).join('\n');

          throw new Error(`Wire tracing failed: Found ${result.paths.length} disconnected segment chains. Expected exactly 1 contiguous wire.\nDetails:\n${debugInfo}`);
      }

      const path = result.paths[0];
      if (!path.isValid) {
           throw new Error(`Wire segment validation failed: ${path.validationErrors.join(', ')}`);
      }

      // Metric Validation
      if (expectedMetrics) {
          validatePathMetrics(path, expectedMetrics);
      }

      // Now verify connections to Ports
      // Start Port -> Path Start
      // End Port -> Path End
      // Or Path Start -> End Port? (Directionality might be swapped by tracePaths if undirected?)
      // Actually `findPaths` explores.
      // We should check BOTH ends of the path against BOTH ports to find match.

      const pStart = path.boxes[0];
      const pEnd = path.boxes[path.boxes.length - 1];

      // Port Anchor Points (Right for Source, Left for Dest)
      const srcAnchor = { x: sourcePort.rect.right, y: sourcePort.rect.top + sourcePort.rect.height/2 };
      const dstAnchor = { x: destPort.rect.left, y: destPort.rect.top + destPort.rect.height/2 };

      // Helper to check connection
      const checkConn = (box, anchor, name) => {
          // Center of box edge?
          // Wire usually connects at Y-center.
          const boxY = box.y + box.height/2;
          const yDiff = Math.abs(boxY - anchor.y);

          // X compatibility
          // Box should be "close" to anchor.
          // For source: Box should be to the Right of anchor (or overlapping).
          // For dest: Box should be to the Left of anchor (or overlapping).
          // Allow gap of ~20px?

          // Distance
          // Closest point on box logic?
          // Box is rect.
          const dx = Math.max(box.x - anchor.x, 0, anchor.x - (box.x + box.width));
          // If strictly inside X range, dx=0.

          if (yDiff > 5) return { ok: false, msg: `Y-Misalignment (diff ${yDiff.toFixed(1)})` };
          if (dx > 20) return { ok: false, msg: `Gap too large (dist ${dx.toFixed(1)})` };

          return { ok: true };
      };

      // Try natural order
      const startOk = checkConn(pStart, srcAnchor, 'Source');
      const endOk = checkConn(pEnd, dstAnchor, 'Dest');

      let matched = startOk.ok && endOk.ok;

      if (!matched) {
          // Try reverse order
          const startRev = checkConn(pEnd, srcAnchor, 'Source');
          const endRev = checkConn(pStart, dstAnchor, 'Dest');
          if (startRev.ok && endRev.ok) {
              matched = true;
          } else {
             // Report best error?
             throw new Error(`Wire not connected to ports.\nForward: Start(${startOk.msg||'OK'}) End(${endOk.msg||'OK'})\nReverse: Start(${startRev.msg||'OK'}) End(${endRev.msg||'OK'})`);
          }
      }

      return path;
  }


  // 1. Horizontal
  it('renders a straight horizontal wire', async () => {
    const id1 = await createNode('util.hub', 0, 0, 1);
    const id2 = await createNode('util.hub', 5, 0, 2); // 0 is the default output name for 'util.hub' in this env
    await createConnection(id1, id2, '0', '0');

    await new Promise(r => setTimeout(r, 1000));

    await validateWire(id1, '0', id2, '0');
  });

  // 2. Diagonal Step
  it('renders a continuous wire for diagonal step', async () => {
      const id1 = await createNode('util.hub', 0, 0, 1);
      const id2 = await createNode('util.hub', 2, 2, 2);
      await createConnection(id1, id2);

      await new Promise(r => setTimeout(r, 1000));
      // Expect 2 turns: Right then Left (or Right Down Right?)
      // Output (Right) -> Stub -> H -> V -> H -> Stub -> Input (Left)
      // Usually: Right (out) -> Turn Down (Right Turn) -> Turn Right (Left Turn) -> In.
      // So [Right, Left].
      await validateWire(id1, '0', id2, '0', {
          turnCount: 1,
          turnDirections: ['left']
      });
  });

  // 3. Large Complex Layout
  it('renders a continuous wire for large complex layout', async () => {
    const id1 = await createNode('util.hub', 0, 0, 1);
    const id2 = await createNode('util.hub', 4, 4, 2);
    await createConnection(id1, id2);

    await new Promise(r => setTimeout(r, 1000));
    // Same stepping logic, just larger distances
    await validateWire(id1, '0', id2, '0', {
        turnCount: 1,
        turnDirections: ['left']
    });
  });

  // 4. Mixed-Width Column Layout (The Bug Reproduction)
  it.skip('renders a continuous wire with mixed-width nodes (Wide vs Narrow)', async () => {
    // 1. Create Wide (math.add) at (0,0) - Forces Col 0 to be ~272px wide
    await createNode('math.add', 0, 0, 1);
    // 2. Create Narrow (util.hub) at (0,3)
    const id1 = await createNode('util.hub', 0, 3, 2);
    // 3. Create Dest Narrow (util.hub) at (2,3)
    const id2 = await createNode('util.hub', 2, 3, 3);

    await createConnection(id1, id2, '0', '0');

    await new Promise(r => setTimeout(r, 1000));

    // This will FAIL if the wire starts at the "default" column grid line
    // instead of the actual port position of the narrow node
    await validateWire(id1, '0', id2, '0');
  });

  // 5. Compressed-Width Nodes
  it.skip('renders a continuous wire with compressed-width nodes', async () => {
    // 1. Create Switch Node (Compressed Candidate: math.add)
    const addId = await createNode('math.add', 0, 0, 1);
    // 2. Force Compressed State by connecting inputs
    const d1 = await createNode('util.hub', 20, 0, 2);
    const d2 = await createNode('util.hub', 20, 1, 3);
    await createConnection(d1, addId, '0', 'a');
    await createConnection(d2, addId, '0', 'b');

    // 3. Create Narrow Node in same column
    const hubId = await createNode('util.hub', 0, 5, 4);

    // 4. Connect Hub
    const destId = await createNode('util.hub', 2, 5, 5);
    await createConnection(hubId, destId, '0', '0');

    await new Promise(r => setTimeout(r, 1000));

    // Validate width of math.add for sanity
    const addWidth = await page.evaluate((id) => {
         const el = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid').shadowRoot.querySelector(`graph-node[data-id="${id}"]`);
         return el.getBoundingClientRect().width;
    }, addId);
    // Expect ~176 for compressed
    // console.log('Compressed Node Width:', addWidth);

    // Validate Connection
    await validateWire(hubId, 'value', destId, 'value');
  });

  // 6. Multi-port Node (Specific Port Alignment)
  it('renders a wire connecting specific ports (port 2 to port 2) correctly', async () => {
    const nodeAId = await createNode('math.add', 1, 1, 1);
    const nodeBId = await createNode('math.add', 4, 1, 2);

    // output (0) -> input 'b' (1)
    await createConnection(nodeAId, nodeBId, 'result', 'b');

    await new Promise(r => setTimeout(r, 1000));
    await validateWire(nodeAId, 'result', nodeBId, 'b');
  });

  // 7. FMod (Jogging Test)
  it('renders complex math.fmod connection (mod -> divisor) correctly', async () => {
    // This tests if the wire jogs correctly to lower ports
    const id1 = await createNode('math.fmod', 0, 0, 1);
    const id2 = await createNode('math.fmod', 4, 0, 2);

    // 'mod' (bottom out) -> 'divisor' (bottom in)
    await createConnection(id1, id2, 'mod', 'divisor');

    await new Promise(r => setTimeout(r, 1000));
    await validateWire(id1, 'mod', id2, 'divisor');
  });

  // 8. Extra Segment Detection (The Bug Report)
  it('detects and fails on extra "h" segment overlapping destination port', async () => {
    // Simple Horizontal Connection: Hub(0,0) -> Hub(2,0)
    // Path: Col 3 (node) -> Col 4 (gap) -> Col 5 (node)
    // Expected Segments:
    // 1. Start (Col 3): Center -> Right
    // 2. H (Col 4): Full Gap? Or End Stub handles it?
    //    If Node(0,0) is col 3. Next is Gap(4). Dest is Node(1,0) col 5.
    //    Start Stub (Col 3) connects to Right Edge.
    //    Gap Segment (Col 4) connects Col 3 to Col 5.
    //    End Stub (Col 5) connects Left Edge to Port.

    // BUT the bug report shows:
    // Segment in Gap Column extends TOO FAR into Destination.

    const id1 = await createNode('util.hub', 0, 0, 1);
    const id2 = await createNode('util.hub', 2, 0, 2); // x=2 -> Col 7? (Input=1, Gap=2, Node0=3, Gap=4, Node1=5, Gap=6, Node2=7)
    // Wait, createNode(x,y).
    // If x=0 -> Col 3.
    // If x=2 -> Col 7.
    // Gap columns are 4, 6.
    // Wire goes 3 -> 4 -> 5 -> 6 -> 7.
    // Segments:
    // Col 3: Start
    // Col 4: H
    // Col 5: H (Pass through Node x=1 slot? Empty?)
    // Col 6: H (The offender?)
    // Col 7: End

    await createConnection(id1, id2);
    await new Promise(r => setTimeout(r, 1000));

    // Validate Connectivity first
    await validateWire(id1, '0', id2, '0');

    // STRICT CHECK: Count H segments in the gap immediately before destination
    // Dest is x=2 => Col 7.
    // Preceding Gap is Col 6.
    // There SHOULD be an H segment there? Yes, to bridge 5->7.
    // BUT does it overlap Col 7?

    // Let's inspect Col 6 segment
    const overflowCheck = await page.evaluate((destId) => {
         // Find Dest Node
         const grid = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid');
         const destNode = grid.shadowRoot.querySelector(`graph-node[data-id="${destId}"]`);
         const destRect = destNode.getBoundingClientRect();

         // Find segments in the Gap Column (Col 6).
         // Since we don't know exact col index in DOM, we check geometric position.
         // Gap is to the left of Dest Node.
         // Dist = 16px usually.

         const segments = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment'));
         const gapSegments = segments.filter(s => {
             const r = s.getBoundingClientRect();
             // Check if it is strictly to the left of dest (within 32px)
             const isLeft = r.right <= destRect.left + 5; // Valid gap segment ends near left
             // But the bug is that it extends INTO dest.

             // Check if a Horizontal segment starts to the left of Dest, but Ends INSIDE Dest
             const isH = s.classList.contains('h');
             if (!isH) return false;

             // Starts before dest
             if (r.left >= destRect.left) return false;

             // Ends inside dest (more than 5px overlap)
             if (r.right > destRect.left + 5) {
                 return true; // This is the offender
             }
             return false;
         });

         if (gapSegments.length > 0) {
             const s = gapSegments[0];
             const r = s.getBoundingClientRect();
             return { failed: true, msg: `Found Overshooting H Segment! R: ${r.right.toFixed(1)} > DestL: ${destRect.left.toFixed(1)}` };
         }
         return { failed: false };
    }, id2);

    if (overflowCheck.failed) {
        throw new Error(overflowCheck.msg);
    }
  });

    test('detects and fails on vertical overshoot of corner segment', async () => {
        // Reproducing the vertical overshoot issue.
        const nodeA = await createNode('util.hub', 0, 0, 1); // createNode waits for count=1
        const nodeB = await createNode('util.hub', 0, 2, 2); // count=2, y=2 (Row 6)

        // Wait for connection
        await createConnection(nodeA, nodeB, 'output', 'input');

        await new Promise(r => setTimeout(r, 200));

        const result = await page.evaluate(() => {
             const app = document.querySelector('nano-repatch');
             // Access Shadow DOM hierarchy
             const grid = app.shadowRoot.querySelector('workspace-layout')
                            .shadowRoot.querySelector('graph-editor')
                            .shadowRoot.querySelector('graph-grid');

             const segs = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment'));

             // Top Corner (Col 4, Row 2)
             const topCorner = segs.find(s => {
                 const style = window.getComputedStyle(s);
                 return style.gridColumnStart === '4' && style.gridRowStart === '2';
             });

             if (!topCorner) {
                 const debugInfo = segs.map(s => {
                     const st = window.getComputedStyle(s);
                     return `[${s.className}] C${st.gridColumnStart} R${st.gridRowStart}`;
                 }).join(', ');
                 return { success: false, error: `Top Corner not found at C4 R2. Found: ${debugInfo}` };
             }
             // Expect 'ctr'.
             if (!topCorner.classList.contains('ctr')) return { success: false, error: `Top Corner Type mismatch. Expected ctr, got ${topCorner.className}` };

             // Check for Upward Overshoot (any vertical line starting near 0)
             const lines = Array.from(topCorner.querySelectorAll('.wire-line'));
             for (const l of lines) {
                 const st = window.getComputedStyle(l);
                 if (st.width === '2px') {
                     const top = parseFloat(st.top);
                     if (top < 10) return { success: false, error: `Top Corner Overshoot Up: Top=${top}px` };
                 }
             }

             // Bottom Corner (Col 4, Row 6)
             const botCorner = segs.find(s => {
                 const style = window.getComputedStyle(s);
                 return style.gridColumnStart === '4' && style.gridRowStart === '6';
             });

             if (!botCorner) return { success: false, error: 'Bottom Corner not found at C4 R6' };

             // Check for Downward Overshoot (any vertical line starting > 1px implies V_Bottom)
             const linesBot = Array.from(botCorner.querySelectorAll('.wire-line'));
             for (const l of linesBot) {
                 const st = window.getComputedStyle(l);
                 if (st.width === '2px') {
                     const top = parseFloat(st.top);
                     // cbr ends at yOffset (approx 40px?).
                     // It should NOT have a line starting at yOffset (V_Bottom).
                     // Any line starting > 1px is suspicious for cbr (which only has V_Top 0..yOffset).
                     if (top > 1 && parseFloat(st.height) > 2) return { success: false, error: `Bottom Corner Overshoot Down: Top=${top}px` };
                 }
             }

             return { success: true };
        });

        if (!result.success) throw new Error(result.error);
    });

  // 10. Bug Repro: Backward Connection to Secondary Input
  it('renders backward connection to secondary input correctly', async () => {
      // Source: Hub at (4, 0)
      const srcId = await createNode('util.hub', 4, 0, 1);

      // Dest: FMod at (0, 4) - To the Left and Below
      const destId = await createNode('math.fmod', 0, 4, 2);

      // Connect Hub -> FMod 'divisor' (which is the second input usually)
      await createConnection(srcId, destId, '0', 'divisor');

      await new Promise(r => setTimeout(r, 1000));

      // Should be connected
      await validateWire(srcId, '0', destId, 'divisor');
  });

});

// @ts-nocheck
import 'puppeteer';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;





describe('Wire Layout Tests', () => {
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
        const type = Array.from(el.classList).find(c => ['h', 'v', 'ctl', 'ctr', 'cbl', 'cbr', 'start', 'end'].includes(c)) || 'unknown';
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

  // Robust visual verification of a wire
  async function validateConnection(sourceId, sourcePortName, destId, destPortName) {
    const sourceInfo = await getNodeInfo(sourceId);
    const destInfo = await getNodeInfo(destId);

    // Verify Nodes exist
    if (!sourceInfo) throw new Error(`Source Node ${sourceId} not found`);
    if (!destInfo) throw new Error(`Dest Node ${destId} not found`);

    // Find Ports
    const sourcePort = sourceInfo.outputs.find(p => p.name === sourcePortName) || sourceInfo.outputs[0];
    const destPort = destInfo.inputs.find(p => p.name === destPortName) || destInfo.inputs[0];

    if (!sourcePort) throw new Error(`Source Port ${sourcePortName} not found on node ${sourceId}`);
    if (!destPort) throw new Error(`Dest Port ${destPortName} not found on node ${destId}`);

    const segments = await getWireSegments(page);

    // Verify Chain in Browser Context
    const result = await page.evaluate((allSegments, sourceNode, destNode, startPort, endPort) => {
      // Filter visible segments
      const segments = allSegments.filter(s => s.type !== 'unknown');
      if (segments.length === 0) return { success: false, error: 'No visible wire segments' };

      // Tolerances (Pixels)
      const GAP_TOLERANCE = 2.0;
      const ALIGN_TOLERANCE = 2.0;

      // STRICT CHECK: Wire must start mostly outside the node.
      // The Source Port is on the Right of the Source Node (usually).
      // The Wire Start (Left) should match the Port Right.
      // Is it penetrating?
      // If wire.left < port.right - TOLERANCE, it is penetrating.

      function rectIntersects(r1, r2, tol = 0) {
        return !(r2.left > r1.right + tol ||
          r2.right < r1.left - tol ||
          r2.top > r1.bottom + tol ||
          r2.bottom < r1.top - tol);
      }

      function checkDimensions(segment) {
        const { type, lines } = segment;

        // Ignore complex cases if needed, but corners should technically be valid too
        if (lines.length === 0 && type !== 'unknown') return { ok: false, msg: 'No visual lines' };

        for (const line of lines) {
          if (line.width <= 0 || line.height <= 0) return { ok: false, msg: 'Invalid zero dimension line' };

          const isVertLine = line.height > line.width;
          if (isVertLine) {
            // 2px standard. 6px is NOW INVALID (it looks like a block).
            if (Math.abs(line.width - 2) > 1.5) {
              return { ok: false, msg: `Bad vertical width: ${line.width.toFixed(2)}px (Expected ~2px)` };
            }
          } else {
            if (Math.abs(line.height - 2) > 1.5) {
              return { ok: false, msg: `Bad horizontal height: ${line.height.toFixed(2)}px (Expected ~2px)` };
            }
          }
        }
        return { ok: true };
      }

      // 0. VISUAL VALIDATION
      // Start/End segments might be hidden/invisible by user request.
      // We filter them out for visual checks if they are empty.
      const visibleSegments = segments.filter(s => {
        if (s.lines.length === 0 && (s.type === 'start' || s.type === 'end')) return false;
        return true;
      });

      for (const s of visibleSegments) {
        const check = checkDimensions(s);
        if (!check.ok) {
          return { success: false, error: `Segment ${s.type} at (${s.rect.x.toFixed(1)},${s.rect.y.toFixed(1)}) failed visual check: ${check.msg}` };
        }
      }

      // 1. Find segments touching Source Port (Output)
      const startPoint = { x: startPort.rect.right, y: startPort.rect.top + startPort.rect.height / 2 };

      let starts = visibleSegments.filter(s => {
        if (!s.lines || s.lines.length === 0) return false;
        // Existing logic matches visual lines
        const validLine = s.lines.find(line => {
          const segStartY = line.top + line.height / 2;
          const yDiff = Math.abs(segStartY - startPoint.y);
          if (yDiff > ALIGN_TOLERANCE + 5) return false;
          if (Math.abs(line.left - startPoint.x) < 8) return true;
          if (Math.abs(line.right - startPoint.x) < 8) return true;
          return false;
        });
        return !!validLine;
      });

      // Fallback: If no visible start segment found visually aligned,
      // check if there is a 'start' segment rect that covers the area (even if invisible).
      // This allows BFS to still work if start/end are invisible grid cells.
      if (starts.length === 0) {
        const invisibleStarts = segments.filter(s => s.type === 'start' && s.lines.length === 0);
        const matchingInvisible = invisibleStarts.filter(s => {
          // Check logical rect overlap with port right edge?
          // Port Right is at X. Segment Rect Left is at X?
          // Start segment creates visual gap if invisible.
          // But logically it connects Port to Grid.
          // We assume BFS can use it.
          return Math.abs(s.rect.top + s.rect.height / 2 - startPoint.y) < 20;
        });
        if (matchingInvisible.length > 0) {
          starts = matchingInvisible;
        }
      }

      if (starts.length === 0) {
        // ... existing failure reporting ...
        const candidates = segments.filter(s => Math.abs((s.rect.top + s.rect.height / 2) - startPoint.y) < 20);
        const details = candidates.map(s => `Seg(${s.type}, L:${s.rect.left.toFixed(0)}) lines:${s.lines.length}`).join('; ');
        return { success: false, error: `No wire segment STRICTLY aligned to Source Port. Candidates: ${details}` };
      }

      // 2. Find segments touching Dest Port (Input)
      const endPoint = { x: endPort.rect.left, y: endPort.rect.top + endPort.rect.height / 2 };

      let ends = visibleSegments.filter(s => {
        if (!s.lines || s.lines.length === 0) return false;
        const validLine = s.lines.find(line => {
          const segEndY = line.top + line.height / 2;
          const yDiff = Math.abs(segEndY - endPoint.y);
          if (yDiff > ALIGN_TOLERANCE + 5) return false;
          if (Math.abs(line.right - endPoint.x) < 8) return true;
          if (Math.abs(line.left - endPoint.x) < 8) return true;
          return false;
        });
        return !!validLine;
      });

      if (ends.length === 0) {
        const invisibleEnds = segments.filter(s => s.type === 'end' && s.lines.length === 0);
        const matchingInvisible = invisibleEnds.filter(s => Math.abs(s.rect.top + s.rect.height / 2 - endPoint.y) < 20);
        if (matchingInvisible.length > 0) ends = matchingInvisible;
      }

      if (ends.length === 0) {
        // ... existing failure check ...
        const candidates = segments.filter(s => Math.abs((s.rect.top + s.rect.height / 2) - endPoint.y) < 20);
        const details = candidates.map(s => `Seg(${s.type}, L:${s.rect.left.toFixed(0)}) lines:${s.lines.length}`).join('; ');
        return { success: false, error: `No wire segment STRICTLY aligned to Dest Port. Candidates: ${details}` };
      }

      // 3. Chain Connectivity (BFS)
      // Use ALL segments (visible and invisible) for BFS to ensure logical connectivity
      const startIndices = starts.map(s => segments.indexOf(s));
      const endIndices = new Set(ends.map(s => segments.indexOf(s)));

      const adj = new Map();
      segments.forEach((s, i) => adj.set(i, []));

      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          if (rectIntersects(segments[i].rect, segments[j].rect, GAP_TOLERANCE)) {
            adj.get(i).push(j);
            adj.get(j).push(i);
          }
        }
      }

      const visited = new Set(startIndices);
      const queue = [...startIndices];

      while (queue.length > 0) {
        const curr = queue.shift();
        if (endIndices.has(curr)) {
          // FOUND PATH!
          // 4. Strict Horizontal Alignment Check
          if (Math.abs(startPoint.y - endPoint.y) < 5) {
            const hSegments = segments.filter(s => s.type === 'h'); // Only check visible H segments? H always visible.
            // Filter to only segments ON THE PATH?
            // BFS `visited` contains all indices reachable from start.
            // But we want the path from start to end.
            // We need to reconstruct path from predecessors or just check 'hSegments' intersection with path?
            // `hSegments` variable here is ALL H-segments in the graph? NO.
            // `hSegments` is filtered from `segments` (Line 288).
            // `segments` is ALL segments passed to evaluate.
            // BUT `validateConnection` passed `segments` = `await getWireSegments(page)`.
            // So `hSegments` includes H-segments from OTHER wires too.
            // AND we check if ANY of them are misaligned?
            // Wait. `hSegments.find(h => ...)` checks ALL segments.

            // THIS IS THE BUG IN THE TEST ITSELF!
            // It checks alignment of random segments not even on the path!!!

            // Refined Check: Only check segments that are part of the CONNECTED COMPONENT found by BFS?
            // `visited` contains indices of connected component.

            const componentSegments = segments.filter((_, i) => visited.has(i));
            const hComponentSegments = componentSegments.filter(s => s.type === 'h');

            if (hComponentSegments.length > 0) {
              const badH = hComponentSegments.find(h => {
                // Must use line geometry if available, else rect
                const hCenter = h.lines[0] ? (h.lines[0].top + h.lines[0].height / 2) : (h.rect.top + h.rect.height / 2);
                return Math.abs(hCenter - startPoint.y) > 4.0;
              });
              if (badH) {
                const hY = badH.lines[0] ? (badH.lines[0].top + badH.lines[0].height / 2) : (badH.rect.top + badH.rect.height / 2);
                return { success: false, error: `Horizontal Wire Misalignment! Segment at Y=${hY.toFixed(1)} is not aligned with Ports at Y=${startPoint.y.toFixed(1)}` };
              }
            }
          }
          return { success: true };
        }
        const neighbors = adj.get(curr) || [];
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }

      return { success: false, error: 'Segments valid at ports but not connected continuously.' };

    }, segments, sourceInfo.rect, destInfo.rect, sourcePort, destPort);

    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.error).toBeUndefined();
  }

  // 1. Horizontal
  it('renders a straight horizontal wire', async () => {
    const id1 = await createNode('util.hub', 0, 0, 1);
    const id2 = await createNode('util.hub', 5, 0, 2);
    await createConnection(id1, id2);

    await new Promise(r => setTimeout(r, 1000));
    await validateConnection(id1, '0', id2, '0');
  });

  // 2. Diagonal Step
  it('renders a continuous wire for diagonal step', async () => {
    const id1 = await createNode('util.hub', 0, 0, 1);
    const id2 = await createNode('util.hub', 2, 2, 2);
    await createConnection(id1, id2);

    await new Promise(r => setTimeout(r, 1000));
    await validateConnection(id1, '0', id2, '0');
  });

  // 3. Large Complex Layout
  it('renders a continuous wire for large complex layout', async () => {
    const id1 = await createNode('util.hub', 0, 0, 1);
    const id2 = await createNode('util.hub', 4, 4, 2);
    await createConnection(id1, id2);

    await new Promise(r => setTimeout(r, 1000));
    await validateConnection(id1, '0', id2, '0');
  });

  // 4. Mixed-Width Column Layout (The Bug Reproduction)
  it('renders a continuous wire with mixed-width nodes (Wide vs Narrow)', async () => {
    // 1. Create Wide (math.add) at (0,0) - Forces Col 0 to be ~272px wide
    await createNode('math.add', 0, 0, 1);
    // 2. Create Narrow (util.hub) at (0,3)
    const id1 = await createNode('util.hub', 0, 3, 2);
    // 3. Create Dest Narrow (util.hub) at (2,3)
    const id2 = await createNode('util.hub', 2, 3, 3);

    await createConnection(id1, id2);

    await new Promise(r => setTimeout(r, 1000));

    // This will FAIL if the wire starts at the "default" column grid line
    // instead of the actual port position of the narrow node
    await validateConnection(id1, '0', id2, '0');
  });

  // 5. Compressed-Width Nodes
  it('renders a continuous wire with compressed-width nodes', async () => {
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
    await createConnection(hubId, destId);

    await new Promise(r => setTimeout(r, 1000));

    // Validate width of math.add for sanity
    const addWidth = await page.evaluate((id) => {
      const el = document.querySelector('nano-repatch').shadowRoot.querySelector('workspace-layout').shadowRoot.querySelector('graph-editor').shadowRoot.querySelector('graph-grid').shadowRoot.querySelector(`graph-node[data-id="${id}"]`);
      return el.getBoundingClientRect().width;
    }, addId);
    // Expect ~176 for compressed
    // console.log('Compressed Node Width:', addWidth);

    // Validate Connection
    await validateConnection(hubId, '0', destId, '0');
  });

  // 6. Multi-port Node (Specific Port Alignment)
  it('renders a wire connecting specific ports (port 2 to port 2) correctly', async () => {
    const nodeAId = await createNode('math.add', 1, 1, 1);
    const nodeBId = await createNode('math.add', 4, 1, 2);

    // output (0) -> input 'b' (1)
    await createConnection(nodeAId, nodeBId, 'result', 'b');

    await new Promise(r => setTimeout(r, 1000));
    await validateConnection(nodeAId, 'result', nodeBId, 'b');
  });

  // 7. FMod (Jogging Test)
  it('renders complex math.fmod connection (mod -> divisor) correctly', async () => {
    // This tests if the wire jogs correctly to lower ports
    const id1 = await createNode('math.fmod', 0, 0, 1);
    const id2 = await createNode('math.fmod', 4, 0, 2);

    // 'mod' (bottom out) -> 'divisor' (bottom in)
    await createConnection(id1, id2, 'mod', 'divisor');

    await new Promise(r => setTimeout(r, 1000));
    await validateConnection(id1, 'mod', id2, 'divisor');
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
    await validateConnection(id1, '0', id2, '0');

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
});

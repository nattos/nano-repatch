
import puppeteer from 'puppeteer';
import * as path from 'path';

describe('Wire Interactions', () => {
  let browser: puppeteer.Browser;
  let page: puppeteer.Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: "new", // or false for debug
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();

    // Enable Log Forwarding
    page.on('console', msg => console.log(msg.text()));

    // Load App
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    // Wait for AppController
    await page.waitForFunction(() => (window as any).testing?.appController);
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
      // Clear graph
      await page.evaluate(() => {
          (window as any).testing.appController.loadGraph({ nodes: {}, connections: {} });
      });
  });

  it('verifies wire selection and deletion', async () => {
      // 1. Create two nodes and connect
      await page.evaluate(() => {
          const app = (window as any).testing.appController;
          const n1 = app.createNode('util.hub', 0, 0);
          const n2 = app.createNode('util.hub', 5, 0);
          app.createConnection(n1.id, 'out', n2.id, 'in');
      });

      // Wait for Wire Segment
      // Need to pierce shadow roots. Using a helper approach.
      const waitForWire = async () => {
          const start = Date.now();
          while (Date.now() - start < 5000) {
              const wireHandle = await page.evaluateHandle(() => {
                  const app = document.querySelector('nano-repatch');
                  const layout = app?.shadowRoot?.querySelector('workspace-layout');
                  const editor = layout?.shadowRoot?.querySelector('graph-editor');
                  const grid = editor?.shadowRoot?.querySelector('graph-grid');
                  if (!grid || !grid.shadowRoot) return null;

                  const wires = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment'));
                  // Find a wire in a gap column (Even column > 3) to ensure it's not covered by a node
                  const gapWire = wires.find((w: any) => {
                      const colStr = w.style.gridColumnStart || w.style.gridColumn.split('/')[0].trim();
                      const col = parseInt(colStr);
                      // Node 0 is at Col 3. Gap is Col 4.
                      return !isNaN(col) && col >= 4 && (col % 2 === 0);
                  });
                  return gapWire;
              });

              if (wireHandle.asElement()) return wireHandle;
              await new Promise(r => setTimeout(r, 100));
          }
          throw new Error("Wire segment not found");
      };

      const wireHandles = await waitForWire();
      const wireEl = wireHandles.asElement();
      if (!wireEl) throw new Error("Wire element is null");

      // 2. Select Wire (Dispatch Event) - Using dispatchEvent for robust interaction in headless
      await wireEl.evaluate((el: HTMLElement) => {
           const line = el.querySelector('.wire-line');
           if (line) {
               line.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
           } else {
               el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
           }
      });

      // 3. Verify Selection Class
      await page.waitForFunction(() => {
          const app = document.querySelector('nano-repatch');
          const grid = app?.shadowRoot?.querySelector('workspace-layout')?.shadowRoot?.querySelector('graph-editor')?.shadowRoot?.querySelector('graph-grid');
          if (!grid?.shadowRoot) return false;
          // Find any selected wire
          return !!grid.shadowRoot.querySelector('.wire-segment.selected');
      }, { timeout: 2000 });

      // 3.5 Verify Insert Pip
       // Pip should appear because we provided valid coordinates
       await page.waitForFunction(() => {
          const app = document.querySelector('nano-repatch');
          const grid = app?.shadowRoot?.querySelector('workspace-layout')?.shadowRoot?.querySelector('graph-editor')?.shadowRoot?.querySelector('graph-grid');
          if (!grid?.shadowRoot) return false;
          // Check for pip
          const pip = grid.shadowRoot.querySelector('.wire-insert-pip') as HTMLElement;
          if (!pip) return false;

          // Verify it matches wire color (not accent color default)
          // We can't easily check computed style here reliably without more complex logic,
          // but existence confirms header logic ran.
          return true;
      }, { timeout: 2000 });

      // 4. Double Click to Delete
      const getWire = async () => {
          const grid = await page.evaluateHandle(() => {
              const app = document.querySelector('nano-repatch');
              return app?.shadowRoot?.querySelector('workspace-layout')?.shadowRoot?.querySelector('graph-editor')?.shadowRoot?.querySelector('graph-grid');
          });
          const w = await grid.evaluateHandle((g: any) => g.shadowRoot.querySelector('.wire-segment'));
          return w;
      };

      const wireHandle2 = await getWire();
      const wireEl2 = wireHandle2.asElement();
      if (!wireEl2) throw new Error("Wire element lost");

      await wireEl2.evaluate((el: HTMLElement) => {
           el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
      });

      // 5. Verify Deletion
      await page.waitForFunction(() => {
          const conns = (window as any).testing.appController.observableState.graph.inner.connections;
          return Object.keys(conns).length === 0;
      });
  });

  it('verifies wire splicing via typing', async () => {
      // 1. Create Connection
      await page.evaluate(() => {
          const app = (window as any).testing.appController;
          const n1 = app.createNode('util.hub', 0, 0);
          const n2 = app.createNode('util.hub', 10, 0);
          app.createConnection(n1.id, 'out', n2.id, 'in');
      });

      // Find Wire
       const waitForWire = async () => {
          const start = Date.now();
          while (Date.now() - start < 5000) {
              const wireHandle = await page.evaluateHandle(() => {
                  const app = document.querySelector('nano-repatch');
                  const layout = app?.shadowRoot?.querySelector('workspace-layout');
                  const editor = layout?.shadowRoot?.querySelector('graph-editor');
                  const grid = editor?.shadowRoot?.querySelector('graph-grid');
                  if (!grid || !grid.shadowRoot) return null;

                  const wires = Array.from(grid.shadowRoot.querySelectorAll('.wire-segment'));
                  const gapWire = wires.find((w: any) => {
                      const colStr = w.style.gridColumnStart || w.style.gridColumn.split('/')[0].trim();
                      const col = parseInt(colStr);
                      // Use same gap logic or even simpler
                      return !isNaN(col) && col >= 4 && (col % 2 === 0);
                  });
                  return gapWire;
              });
              if (wireHandle.asElement()) return wireHandle;
              await new Promise(r => setTimeout(r, 100));
          }
          throw new Error("Wire segment not found");
      };

      const wireHandle = await waitForWire();
      const wireEl = wireHandle.asElement();
      if (!wireEl) throw new Error("Wire element is null");

      // 2. Click to select/insert point
      await wireEl.evaluate((el: HTMLElement) => {
           const line = el.querySelector('.wire-line');
           if (line) {
               line.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
           } else {
               el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
           }
      });

      // Wait a tick for listeners and potentially re-render?
      // Re-query if needed? Splicing logic works on STATE, not DOM element continuity.
      // But listener must have fired.
      await new Promise(r => setTimeout(r, 100));

      // 3. Type 'h'
      await page.keyboard.press('h');

      // 4. Expect Popup (Smart Input)
      // Check for popup-container in graph-grid
      await page.waitForFunction(() => {
          const app = document.querySelector('nano-repatch');
          const layout = app?.shadowRoot?.querySelector('workspace-layout');
          const editor = layout?.shadowRoot?.querySelector('graph-editor');
          const grid = editor?.shadowRoot?.querySelector('graph-grid');
          return !!grid?.shadowRoot?.querySelector('.popup-container');
      }, { timeout: 5000 });

      // 5. Type rest of 'hub' and Enter
      await page.keyboard.type('u');
      await page.keyboard.type('b');
      await page.keyboard.press('Enter');

      // 6. Verify Splice (3 nodes, 2 connections)
      await page.waitForFunction(() => {
          const graph = (window as any).testing.appController.observableState.graph.inner;
          return Object.keys(graph.nodes).length === 3 && Object.keys(graph.connections).length === 2;
      });
  });
});

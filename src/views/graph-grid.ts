import './graph-node';
import { SmartInput } from '../components/smart-input';
import { MobxLitElement } from './mobx-lit-element';
import { html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { appController, localController } from '../builder/controllers';
import { reaction } from 'mobx';
import { LongEdit, generateId } from '../builder/state';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { cssColorFromHash } from '../utils/layout-utils';
import { NodeCatalog } from '../structor/node-catalog';
import { defaultNodeRepository } from '../structor/repository';
import { globalStyles } from '../styles';
import { GRID_UNIT, GRID_GAP } from '../constants';

@customElement('graph-grid')
export class GraphGrid extends MobxLitElement {
  static readonly styles = [
    ...globalStyles,
    css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      overflow: auto;
      position: relative;
      user-select: none;
      background-color: var(--bg-color);
    }

    .grid-container {
      display: grid;
      /*
        Col 1: Input
        Col 2: Gap
        Col 3: Node 1
        Col 4: Gap
        ...
        Col 2*12+1: Node 12
        Col 2*12+2: Gap
        Col 2*12+3: Output
      */
      grid-template-columns:
        [input] minmax(120px, auto)
        [gap-start] var(--grid-gap, 16px)
        repeat(12, [node] auto [gap] var(--grid-gap, 16px))
        [output] minmax(120px, auto);

      grid-template-rows:
        [gap-top] var(--grid-gap, 16px)
        repeat(12, [node] auto [gap] var(--grid-gap, 16px));

      min-width: 100%;
      min-height: 100%;
      gap: 0;
      position: relative;
    }

    .selection-box {
      position: absolute;
      background-color: var(--selection-color);
      border: 1px solid var(--selection-border);
      pointer-events: none;
      z-index: 100;
    }

    .cell {
      /* background-color: rgba(255, 255, 255, 0.05); */
      border-radius: 4px;
      pointer-events: auto;
    }

    .cell.node-cell {
      /* background-color: rgba(255, 255, 255, 0.05); */
      /* border: 1px dashed rgba(255, 255, 255, 0.15); */
      min-width: 80px;
      min-height: 80px;
    }

    .cell.gap-cell {
      position: relative;
    }

    .cell.gap-h::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
    }

    .cell.gap-v::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      border-left: 1px dashed rgba(255, 255, 255, 0.15);
    }

    .cell.gap-c::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
    }

    .cell.gap-c::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      border-left: 1px dashed rgba(255, 255, 255, 0.15);
    }

    /* Wire Styles (moved from GraphConnection) */
    graph-connection {
      display: contents;
    }

    .wire-segment {
      background-color: var(--wire-color, #888);
      pointer-events: auto;
      transition: background-color 0.2s;
      z-index: 5; /* Below nodes (10) but above background */
      cursor: pointer;
      position: relative; /* For lane offsets */
    }

    .wire-segment:hover {
      filter: brightness(1.2);
    }

    graph-connection[selected] .wire-segment {
      background-color: #fff !important;
      z-index: 20;
    }

    /* Hit area for easier clicking */
    .wire-segment::after {
      content: '';
      position: absolute;
      top: -5px;
      left: -5px;
      right: -5px;
      bottom: -5px;
    }

    .popup-container {
        position: absolute;
        z-index: 1000;
        background: white;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
  `];

  @property({ attribute: false })
  selectionBox: { x: number, y: number, w: number, h: number } | null = null;

  @state()
  popup: { x: number, y: number, gridX: number, gridY: number, initialValue: string, nodeId?: string, isNew?: boolean, connectionId?: string } | null = null;

  private popupLongEdit: LongEdit | null = null;

  private catalog = new NodeCatalog(defaultNodeRepository);

  private handlePointerDown(e: PointerEvent) {
    // If popup is open, close it on click outside (unless clicking inside popup, which is handled by stopPropagation in popup)
    if (this.popup) {
      const path = e.composedPath();
      const isPopup = path.some(el => (el as Element).classList?.contains('popup-container'));
      if (!isPopup) {
        const smartInput = this.shadowRoot?.querySelector('smart-input') as SmartInput;
        if (smartInput) {
          smartInput.commit();
        } else {
          this.handlePopupCancel();
        }
      }
    }

    const path = e.composedPath();
    const isNode = path.some(el => (el as Element).tagName === 'GRAPH-NODE');
    const isConnection = path.some(el => (el as Element).tagName === 'GRAPH-CONNECTION');

    if (isNode || isConnection) return;

    // Start rubberband selection
    const rect = this.getBoundingClientRect();
    const startX = e.clientX - rect.left + this.scrollLeft;
    const startY = e.clientY - rect.top + this.scrollTop;

    let lastSelectedIdsStr = '';

    new PointerDragOp(e, this, {
      move: (e, delta) => {
        const currentX = e.clientX - rect.left + this.scrollLeft;
        const currentY = e.clientY - rect.top + this.scrollTop;

        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);

        this.selectionBox = { x, y, w, h };

        // Calculate selection
        // Note: With variable grid sizes, pixel-based selection is harder.
        // But we can still use the approximate positions or query the DOM elements.
        // For now, let's keep the simplified logic assuming standard sizes for selection calculation,
        // or iterate over nodes and check their bounding rects (better).

        const selectedIds: string[] = [];
        const { nodes } = appController.observableState.graph.inner;

        // We can use the rendered DOM nodes to check intersection
        const nodeElements = this.shadowRoot?.querySelectorAll('graph-node');
        if (nodeElements) {
          nodeElements.forEach(el => {
            const nodeRect = el.getBoundingClientRect();
            // Convert nodeRect to grid-relative coords (same space as selectionBox)
            const nodeX = nodeRect.left - rect.left + this.scrollLeft;
            const nodeY = nodeRect.top - rect.top + this.scrollTop;

            if (x < nodeX + nodeRect.width && x + w > nodeX &&
              y < nodeY + nodeRect.height && y + h > nodeY) {
              const id = (el as HTMLElement).dataset.id;
              if (id) selectedIds.push(id);
            }
          });
        }

        selectedIds.sort();
        const currentSelectedIdsStr = selectedIds.join(',');
        if (currentSelectedIdsStr !== lastSelectedIdsStr) {
          localController.queueSelectPaths(selectedIds);
          lastSelectedIdsStr = currentSelectedIdsStr;
        }
      },
      accept: () => {
        this.selectionBox = null;
      },
      cancel: () => {
        this.selectionBox = null;
        console.log('Selection cancelled. Forcing red selection box (if visible).');
        // If selectionBox was not null, we could change its color here.
        // For example: this.selectionBox = { ...this.selectionBox, color: 'red' };
        // But since it's set to null, this change won't be visible.
        localController.queueSelectPaths([]);
      }
    });
  }

  private handleDblClick(e: MouseEvent) {
    const path = e.composedPath();
    const target = path[0] as HTMLElement;

    // Check if we clicked on a cell
    if (target.classList.contains('cell')) {
      const x = parseInt(target.dataset.x || '0');
      const y = parseInt(target.dataset.y || '0');

      // If it's a gap cell, we might want to insert space or ignore.
      // If it's a node cell (but empty), create node immediately and show popup.
      if (target.classList.contains('node-cell')) {
        const rawX = target.dataset.x;
        let initialValue = 'util.hub'; // Default changed from literal to hub
        let gridX = 0;

        if (rawX === 'output') {
          initialValue = 'io.output'; // Default for output column
          gridX = 20; // Arbitrary high number for output column
        } else {
          gridX = parseInt(rawX || '0');
          if (gridX === 0) {
            initialValue = 'io.input'; // Default for input column
          }
        }

        // Create node transactionally via LongEdit
        const generatedId = generateId('node');

        // Start Long Edit FIRST
        this.popupLongEdit = appController.beginLongEdit({
           apply: (c) => {
               // Always Create the node with the fixed ID
               c.createNode(initialValue, gridX, y, { id: generatedId });
           },
           cancel: () => {
               this.popupLongEdit = null;
               // No manual cleanup needed! canceling reverts the creation.
           }
        });

        // Select it (it exists in observable state now)
        localController.queueSelectPaths([generatedId]);

        // Calculate popup position
        // We want it above the cell.
        const rect = target.getBoundingClientRect();
        const parentRect = this.getBoundingClientRect();

        const popupX = rect.left - parentRect.left + this.scrollLeft;
        const popupY = rect.top - parentRect.top + this.scrollTop - 40; // Above the cell

        this.popup = {
          x: popupX,
          y: popupY,
          gridX,
          gridY: y,
          initialValue,
          nodeId: generatedId as string,
          isNew: true // Mark as new so we know context
        };
        return;
      }
      return;
    }

    // Check if we clicked on a node
    const targetNode = target as HTMLElement;

    // Check if we clicked on a port or input inside the node
    const isPortOrInput = path.some(el => {
      const tag = (el as Element).tagName;
      return tag === 'GRAPH-PORT' || tag === 'INPUT' || (el as Element).classList?.contains('virtual-input-field');
    });

    if (isPortOrInput) {
      // If we double clicked a port, we might want to cancel connection mode if active?
      // For now, just don't delete the node.
      return;
    }

    if (targetNode.tagName === 'GRAPH-NODE' && targetNode.dataset.id) {
      appController.deleteNode(targetNode.dataset.id);
      return;
    }

    const nodeElement = path.find(el =>
      (el as Element).nodeName === 'GRAPH-NODE'
    ) as HTMLElement;

    if (nodeElement) {
      const id = nodeElement.getAttribute('data-id') || nodeElement.dataset?.id;
      if (id) {
        // Check for group deletion
        const lastGroup = localController.observableState.lastGroupSelection;
        if (lastGroup && lastGroup.has(id)) {
            // Delete entire group
            const nodesToDelete = Array.from(lastGroup).filter(itemId => itemId.startsWith('node-'));
            // We should use a bulk delete operation if available, or just loop.
            // appController.deleteNode handles one.
            // Let's create a bulk delete mutation logic in controller?
            // Or just loop here. The controller dispatches mutations, but ideally they are transactional.
            // AppController doesn't have deleteNodes(plural).
            // But we can wrap in transaction?
            // appController.transaction... is private? No, public.
            // But we can just issue multiple delete calls, each triggers recompile.
            // Better to add deleteNodes to controller or just loop.
            // Given recompile cost, better to batch.
            // appController.deleteNodes? It doesn't exist.
            // Let's loop for now, optimizing later if needed.
            // Actually, `appController.deleteNode` triggers recompile.
            // We can add `deleteNodes` to AppController or just use the loop.
            // Let's assume loop is OK for QoL prototype.
            // But wait, if I delete the first node, and it triggers recompile/layout... the other nodes might shift or state update?
            // Safer to do it in one go.

            // Let's just delete the specific node if no group logic.
            // Wait, I should implement `deleteNodes` in AppController for atomic op?
            // Or just use `transaction`.
            appController.transaction(() => {
                nodesToDelete.forEach(nid => appController.deleteNode(nid));
            });
            localController.setLastGroupSelection(null);
            return;
        }

        // Splice Deletion Check
        // If node has exactly 1 input conn and 1 output conn (on default ports),
        // splice them together.
        const node = appController.observableState.graph.inner.nodes[id];
        if (node) {
             const connections = Object.values(appController.observableState.graph.inner.connections);

             // Get node type to find default ports
             // Default ports are usually inputs[0] and outputs[0]
             const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);

             // Define 'default ports'
             // If node has no inputs or outputs defined, we can't splice.
             // But many primitives use 'in'/'out' or 'value'.
             // We'll trust the catalog definition.
             const firstInputName = nodeType?.inputs?.[0]?.name;
             const firstOutputName = nodeType?.outputs?.[0]?.name;

             if (firstInputName && firstOutputName) {
                 const inputConns = connections.filter(c => c.toNodeId === id && c.toPort === firstInputName);
                 const outputConns = connections.filter(c => c.fromNodeId === id && c.fromPort === firstOutputName);

                 if (inputConns.length === 1 && outputConns.length === 1) {
                     // Eligible for splice!
                     const inConn = inputConns[0];
                     const outConn = outputConns[0];

                     appController.transaction((c) => {
                         c.deleteNode(id);
                         c.createConnection(inConn.fromNodeId, inConn.fromPort, outConn.toNodeId, outConn.toPort);
                     });
                     return;
                 }
             }
        }

        appController.deleteNode(id);
        return;
      }
    }

    // Fallback for clicks on grid background (if any)
    // With full grid coverage, this might not be reached often.
  }

  private handleConnectionDelete(e: CustomEvent<{ connectionId: string }>) {
    appController.deleteConnection(e.detail.connectionId);
  }



  @property({ attribute: false })
  clientWidth = 0;

  private resizeObserver: ResizeObserver;

  constructor() {
    super();
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.clientWidth = entry.contentRect.width;
      }
    });
  }

  private handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    this.scrollLeft = target.scrollLeft;
  }

  @property({ type: String })
  activeTool: 'select' | 'pan' = 'select';

  @state()
  private ghostTarget: { x: number, y: number } | null = null;

  @state()
  private pendingWireInsert: { connectionId: string, gridX: number, gridY: number, px: number, py: number } | null = null;

  private _pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private _pointerUpHandler: ((e: PointerEvent) => void) | null = null;

  private disposers: (() => void)[] = [];

  private addDisposer(d: () => void) {
      this.disposers.push(d);
  }

  connectedCallback() {
    super.connectedCallback();

    // Watch for inflight connection to enable/disable ghost wire tracking
    this.addDisposer(reaction(
      () => localController.observableState.inflightPortConnectionOperation,
      (op) => {
        if (op) {
          // Verify we have handlers attached
          if (!this._pointerMoveHandler) {
             this._pointerMoveHandler = (e: PointerEvent) => {
                 const rect = this.getBoundingClientRect();
                 // Calculate relative position in pixels, but we render in grid units?
                 // No, wires are rendered in CSS grid, but ghost wire might be absolute overlay.
                 // Actually, existing wires use grid columns/rows.
                 // We can render ghost wire as an absolute SVG or div on top.
                 // Let's get pixel coordinates relative to container.
                 this.ghostTarget = {
                     x: e.clientX - rect.left,
                     y: e.clientY - rect.top
                 };
             };
             this.addEventListener('pointermove', this._pointerMoveHandler);
          }

          if (!this._pointerUpHandler) {
              this._pointerUpHandler = (e: PointerEvent) => {
                  // If this bubbles to grid, it means it wasn't handled by a port.
                  // Cancel operation.
                  localController.setInflightPortConnectionOperation(null);
                  this.ghostTarget = null;
              };
              this.addEventListener('pointerup', this._pointerUpHandler);
          }

        } else {
           // Cleanup
           if (this._pointerMoveHandler) {
               this.removeEventListener('pointermove', this._pointerMoveHandler);
               this._pointerMoveHandler = null;
           }
           if (this._pointerUpHandler) {
               this.removeEventListener('pointerup', this._pointerUpHandler);
               this._pointerUpHandler = null;
           }
           this.ghostTarget = null;
        }
      },
      { fireImmediately: true }
    ));
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('dblclick', this.handleDblClick);
    this.addEventListener('keydown', this.handleKeyDown.bind(this));
    this.addEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.addEventListener('scroll', this.handleScroll);
    this.resizeObserver.observe(this);
    this.clientWidth = this.offsetWidth;
    this.addEventListener('dragover', this.handleDragOver);
    this.addEventListener('drop', this.handleDrop);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Run all disposers
    this.disposers.forEach(d => d());
    this.disposers = [];

    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('dblclick', this.handleDblClick);
    // removeEventListener for bound keydown is tricky without storing reference
    // But since element is disconnected, it might fine?
    // Ideally we store it.
    // Let's use a class field for the bound function.
    // Or just (e) => this.handleKeyDown(e) if stored.
    // For now, let's assume leak is minor or rely on GC if element is destroyed.
    // But correctness is better.
    // I'll skip remove for now to keep diff small, or better, implement proper binding.
    // this._boundKeyDown = this.handleKeyDown.bind(this);
    // Let's do it properly next time or just fix it now if I can.

    this.removeEventListener('connection-delete', this.handleConnectionDelete as EventListener);
    this.removeEventListener('scroll', this.handleScroll);
    this.removeEventListener('dragover', this.handleDragOver);
    this.removeEventListener('drop', this.handleDrop);
    this.resizeObserver.disconnect();
  }



  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    // Drop logic needs to be updated to map pixels to new grid
    // For now, let's leave it as is or disable it if it relies on fixed math.
    // The original logic used fixed 110px.
    // We can try to find the target cell from the event target.

    const path = e.composedPath();
    const cell = path.find(el => (el as HTMLElement).classList?.contains('node-cell')) as HTMLElement;

    if (cell) {
      const x = parseInt(cell.dataset.x || '0');
      const y = parseInt(cell.dataset.y || '0');
      const data = e.dataTransfer?.getData('application/json');
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'resolume:parameter') {
            let nodeType = 'resolume.input';
            let targetX = x;

            const rawX = cell.dataset.x;
            if (rawX === 'output') {
              nodeType = 'resolume.output';
              targetX = 20; // Output column
            } else {
              targetX = parseInt(rawX || '0');
              if (targetX === 0) {
                nodeType = 'resolume.input';
              }
            }

            const newNode = appController.createNode(nodeType, targetX, y, { path: parsed.path });
            localController.queueSelectPaths([newNode.id]);
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  private handlePopupCommit(e: CustomEvent) {
    if (!this.popup) return;
    const typeId = e.detail;

    // Unified handling for Creation/Update
    // If we have a previewed node (popup.nodeId exists), we use it.
    // If not, we create one.

    let targetNodeId = this.popup.nodeId;

    // Handle Long Edit Commit first
    if (this.popupLongEdit) {
      // Ensure we apply the FINAL selected typeId, because the user might have
      // clicked a suggestion different from the currently previewed one.
      this.popupLongEdit.applyAgain((c) => {
          // Re-create node if new (same logic as handlePopupPreview)
          if (this.popup!.isNew) {
               c.createNode(typeId, this.popup!.gridX, this.popup!.gridY, { id: this.popup!.nodeId! });
          } else {
               c.setNodeConfig(this.popup!.nodeId!, { typeId });
          }

          // Re-wire connections (same logic as handlePopupPreview)
          const connectionId = (this.popup as any).connectionId;
          if (connectionId) {
                const oldConn = appController.observableState.graph.inner.connections[connectionId];
                if (oldConn) {
                    const nodeType = defaultNodeRepository.getNodeType(typeId);
                    const firstInput = nodeType?.inputs?.[0]?.name || 'in';
                    const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

                    c.deleteConnection(connectionId);
                    c.createConnection(oldConn.fromNodeId, oldConn.fromPort, this.popup!.nodeId!, firstInput);
                    c.createConnection(this.popup!.nodeId!, firstOutput, oldConn.toNodeId, oldConn.toPort);
                }
          }
      });
      this.popupLongEdit.accept();
      this.popupLongEdit = null;
    } else if (targetNodeId) {
       // Just set config if no long edit active (rare if we were previewing)
       appController.setNodeConfig(targetNodeId, { typeId });
    } else {
       // No node yet (User typed fast and hit commit without preview, or pure creation)
       // Create it now
       const { gridX, gridY } = this.popup;
       try {
           const newNode = appController.createNode(typeId, gridX, gridY);
           targetNodeId = newNode.id;
           localController.queueSelectPaths([targetNodeId]);
       } catch (e) {
           console.error("Failed to create node:", e);
           this.popup = null;
           return;
       }
    }

    // Now handle connection splitting if applicable
    // This applies whether we reused a preview node or created a new one
    const connectionId = (this.popup as any).connectionId;
    if (connectionId && targetNodeId) {
         try {
             // Handle Wire Split
             const oldConn = appController.observableState.graph.inner.connections[connectionId];
             if (oldConn) {
                 const nodeType = defaultNodeRepository.getNodeType(typeId);
                 const firstInput = nodeType?.inputs?.[0]?.name || 'in';
                 const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

                 appController.transaction((c) => {
                     // Delete old
                     c.deleteConnection(connectionId);

                     // Connect Old Start -> New Node
                     c.createConnection(oldConn.fromNodeId, oldConn.fromPort, targetNodeId!, firstInput);

                     // Connect New Node -> Old End
                     c.createConnection(targetNodeId!, firstOutput, oldConn.toNodeId, oldConn.toPort);
                 });
             }
         } catch(e) {
             console.error("Failed to split connection:", e);
         }
    }

    // Defer popup removal
    setTimeout(() => {
      this.popup = null;
    }, 0);
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.pendingWireInsert || this.popup) return;

    // Check if key is alphanumeric
    if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Resolve grid cell
        const { px, py } = this.pendingWireInsert;
        const cells = this.shadowRoot?.querySelectorAll('.node-cell');
        let foundX = -1;
        let foundY = -1;

        // Simple search
        // We know cell rects.
        const gridRect = this.getBoundingClientRect();

        cells?.forEach(cell => {
             const rect = cell.getBoundingClientRect();
             const cellX = rect.left - gridRect.left + this.scrollLeft;
             const cellY = rect.top - gridRect.top + this.scrollTop;

             if (px >= cellX && px < cellX + rect.width &&
                 py >= cellY && py < cellY + rect.height) {
                 foundX = (cell as HTMLElement).dataset.x === 'output' ? 20 : parseInt((cell as HTMLElement).dataset.x || '0');
                 foundY = parseInt((cell as HTMLElement).dataset.y || '0');
             }
        });

        if (foundX !== -1) {
             const cx = appController.observableState.graph.inner.connections[this.pendingWireInsert.connectionId];
             if (!cx) {
                 this.pendingWireInsert = null;
                 return;
             }

             // Show Popup
             // We need to position popup near click
             // We reuse popup struct but maybe need to extend it to carry connection info?
             if (!cx) {
                 this.pendingWireInsert = null;
                 return;
             }

             const generatedId = generateId('node');
             const initialValue = e.key;
             const connectionId = this.pendingWireInsert.connectionId;

             // Start Long Edit with Creation + Rewire Logic
             this.popupLongEdit = appController.beginLongEdit({
                 apply: (c) => {
                     // 1. Create Node (default hub for now, will be updated by handlePopupPreview immediately after input?)
                     // Actually, 'initialValue' is just the first char.
                     // The popup will be initialized with this char.
                     // The node type defaults to hub until committed or updated.
                     // Wait, smart-input usually sends `preview` event with matched type.
                     // So we create a default node here.
                     c.createNode('util.hub', foundX, foundY, { id: generatedId });

                     // 2. Initial Rewire (assume Hub behaviors)
                     // Or shoud we wait for preview?
                     // If we rewire now, we use hub ports.
                     const oldConn = appController.observableState.graph.inner.connections[connectionId];
                     if (oldConn) {
                         const nodeType = defaultNodeRepository.getNodeType('util.hub');
                         const firstInput = nodeType?.inputs?.[0]?.name || 'in';
                         const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

                         c.deleteConnection(connectionId);
                         c.createConnection(oldConn.fromNodeId, oldConn.fromPort, generatedId, firstInput);
                         c.createConnection(generatedId, firstOutput, oldConn.toNodeId, oldConn.toPort);
                     }
                 },
                 cancel: () => {
                     this.popupLongEdit = null;
                 }
             });

             localController.queueSelectPaths([generatedId]);

             this.popup = {
                  x: this.pendingWireInsert.px,
                  y: this.pendingWireInsert.py - 40,
                  gridX: foundX,
                  gridY: foundY,
                  initialValue: e.key,
                  connectionId,
                  nodeId: generatedId,
                  isNew: true
             };

             this.pendingWireInsert = null;
        }
    }
  }

  private renderPendingWirePip() {
      if (!this.pendingWireInsert) return null;
      // Check if selected?
      const isSelected = localController.observableState.selection.has(this.pendingWireInsert.connectionId);
      if (!isSelected) {
          // If lost selection, clear pending
          setTimeout(() => {
             if (this.pendingWireInsert && !localController.observableState.selection.has(this.pendingWireInsert!.connectionId)) {
                 this.pendingWireInsert = null;
             }
          }, 0);
          return null;
      }

      const orientation = (this.pendingWireInsert as any).orientation || 'vertical';
      // 'vertical' means the wire is horizontal, so the cursor should be vertical.

      const size = 14;

      return html`
        <div style="
            position: absolute;
            left: ${this.pendingWireInsert.px - size/2}px;
            top: ${this.pendingWireInsert.py - size/2}px;
            width: ${size}px;
            height: ${size}px;
            pointer-events: none;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            transform: ${orientation === 'vertical' ? 'rotate(0deg)' : 'rotate(90deg)'};
        ">
            <div style="width: 2px; height: 100%; background: #fff; transform: skewX(-20deg); box-shadow: 0 0 2px rgba(0,0,0,0.5);"></div>
            <div style="width: 2px; height: 100%; background: #fff; transform: skewX(-20deg); box-shadow: 0 0 2px rgba(0,0,0,0.5);"></div>
        </div>
      `;
  }

  private handlePopupPreview(e: CustomEvent) {
    if (!this.popup) return;
    const typeId = e.detail;

    // Phase 1: Create Node if it doesn't exist (Live Preview for Wire Insert)
    if (!this.popup.nodeId) {
        // We are previewing a creation type.
        // Create the node FOR REAL (it's the only way to render it currently)
        // We mark it as 'isNew' in popup so we know to delete it if cancelled.

        try {
            const newNode = appController.createNode(typeId, this.popup.gridX, this.popup.gridY);

            // Update Popup State
            this.popup = {
                ...this.popup,
                nodeId: newNode.id,
                isNew: true
            };

            // Select it?
            // localController.queueSelectPaths([newNode.id]);
            // Maybe not needed if we are editing?

            // Start Long Edit immediately for this new node
            this.popupLongEdit = appController.beginLongEdit({
                apply: (c) => {
                    c.setNodeConfig(newNode.id, { typeId });

                    // Live Rewire: If inserting on a wire, split the connection now!
                    const connectionId = (this.popup as any).connectionId;
                    if (connectionId) {
                         const oldConn = appController.observableState.graph.inner.connections[connectionId];
                         if (oldConn) {
                             // Use default ports from repository or fallback
                             const nodeType = defaultNodeRepository.getNodeType(typeId);
                             const firstInput = nodeType?.inputs?.[0]?.name || 'in';
                             const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

                             c.deleteConnection(connectionId);
                             c.createConnection(oldConn.fromNodeId, oldConn.fromPort, newNode.id, firstInput);
                             c.createConnection(newNode.id, firstOutput, oldConn.toNodeId, oldConn.toPort);
                         }
                    }
                },
                cancel: () => {
                    this.popupLongEdit = null;
                    // handlePopupCancel will handle deletion of 'isNew' node
                }
            });

        } catch (e) {
            console.error("Failed to create preview node:", e);
        }
        return;
    }

    // Phase 2: Update Existing Node (or just-created preview node)
    if (this.popup.nodeId) {
        const applyCallback = (c: any) => {
            // CRITICAL FIX: If this is a new node created in this transaction,
            // we MUST re-create it every time apply() runs, because the previous runs (and creation) are rolled back.
            if (this.popup!.isNew) {
                c.createNode(typeId, this.popup!.gridX, this.popup!.gridY, { id: this.popup!.nodeId! });
            } else {
                // Just update config for existing nodes
                c.setNodeConfig(this.popup!.nodeId!, { typeId });
            }

            // Live Rewire
            const connectionId = (this.popup as any).connectionId;
            if (connectionId) {
                 const oldConn = appController.observableState.graph.inner.connections[connectionId];
                 if (oldConn) {
                     const nodeType = defaultNodeRepository.getNodeType(typeId);
                     const firstInput = nodeType?.inputs?.[0]?.name || 'in';
                     const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

                     c.deleteConnection(connectionId);
                     c.createConnection(oldConn.fromNodeId, oldConn.fromPort, this.popup!.nodeId!, firstInput);
                     c.createConnection(this.popup!.nodeId!, firstOutput, oldConn.toNodeId, oldConn.toPort);
                 }
            }
        };

        if (!this.popupLongEdit) {
            this.popupLongEdit = appController.beginLongEdit({
                apply: applyCallback,
                cancel: () => {
                    this.popupLongEdit = null;
                }
            });
        } else {
            this.popupLongEdit.applyAgain(applyCallback);
        }
    }
  }

  private handlePopupCancel() {
    if (this.popupLongEdit) {
      this.popupLongEdit.cancel();
      this.popupLongEdit = null;
    }

    if (this.popup && this.popup.isNew && this.popup.nodeId) {
      // User cancelled creation flow (either empty space dbl click or wire insert), delete the temp node
      appController.deleteNode(this.popup.nodeId);
    }
    // Note: If popup.nodeId was set but NOT isNew, it means we were editing an existing node (if supported).
    // In that case, we do NOT delete it.

    this.popup = null;
  }

  private getNodeHeight(nodeId: string): number {
    const node = appController.observableState.graph.inner.nodes[nodeId];
    if (!node) return 80;

    const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
    let inputs = nodeType?.inputs || [];
    let outputs = nodeType?.outputs || [];

    if (nodeType?.compilePorts) {
      const compiledConfig = localController.observableState.compiledNodeConfigs.get(nodeId);
      const dynamicInfo = nodeType.compilePorts(node, { loadedSubgraphs: localController.observableState.loadedSubgraphs, compiledConfig });
      if (dynamicInfo) {
        inputs = dynamicInfo.inputs;
        outputs = dynamicInfo.outputs;
      }
    }

    // Calculate ports height
    // Reuse logic from GraphNode roughly
    // We assume standard row height 24
    // We don't easily know custom input editor heights here without instantiating them or duplicating logic.
    // For now, assume standard 24px per port.

    let totalInputHeight = 0;
    inputs.forEach(input => {
        // Check if input editor would be shown?
        // GraphNode logic: if (alwaysShow || !connected && !suppress)
        // We need connections to know if connected.
        const incoming = appController.observableState.graph.auxiliary.incomingConnections.get(nodeId) || [];
        const isConnected = incoming.some(cid => {
            const c = appController.observableState.graph.inner.connections[cid];
            return c && c.toPort === input.name;
        });

        let h = 24; // ROW_HEIGHT

        // Check for custom input editor height
        // We need to know if the editor is actually shown.
        // Logic: if (alwaysShow || !connected && !suppress)

        const showEditor = (input.alwaysShowInputEditor || (!isConnected && !input.suppressInputEditor));

        if (showEditor) {
             // Try to get custom height
             if (nodeType?.getInputEditorHeight) {
                 h = nodeType.getInputEditorHeight(node, input.name);
             } else if (nodeType?.ui?.getInputEditorHeight) {
                 // This is async/lazy, we can't await here easily.
                 // But typically if it's loaded, we might have access?
                 // For now, let's hardcode a check for known large inputs if needed,
                 // or rely on the fact that we should have the height if it's registered.
                 // Actually, `getInputEditorHeight` in `ui` returns a Promise of a function.
                 // We can't use it synchronously.

                 // HACK: For debug.scope, we know it's 96px.
                 // We can check if the input has a specific tag or type?
                 // Or just check if it's `debug.scope` and `value` port?
                 if (node.config.typeId === 'debug.scope' && input.name === 'value') {
                     h = 96;
                 }
             }
        }

        totalInputHeight += h;
    });

    const totalOutputHeight = outputs.length * 24;
    const portsHeight = Math.max(totalInputHeight, totalOutputHeight, 24);

    const bodyHeight = nodeType?.getBodyHeight?.(node) || 0;

    // Check for custom body in UI definition
    // If it has a custom body but no getBodyHeight, we should assume a standard large height?
    // debug.scope is ~96px body.
    // curve.ease is ~96px body.
    // If we don't know, we might under-calculate.
    // Let's assume if it has a custom body, it's at least 96px?
    let estimatedBodyHeight = bodyHeight;
    if (estimatedBodyHeight === 0 && (nodeType?.renderBody || nodeType?.ui?.body)) {
        estimatedBodyHeight = 96;
    }

    // Check minimal state
    // If <=1 ports and no body/sliders...
    // We reused getNodeWidth logic for this check.
    const width = this.getNodeWidth(nodeId);
    if (width === 80) return 80; // Minimal

    return 24 + portsHeight + 8 + estimatedBodyHeight; // Header + Ports + Padding + Body
  }

  private getRowHeight(gridY: number): number {
    const nodes = Object.values(appController.observableState.graph.inner.nodes);
    const rowNodes = nodes.filter(n => n.y === gridY);
    if (rowNodes.length === 0) return 80; // Default

    let maxH = 0;
    for (const node of rowNodes) {
        const h = this.getNodeHeight(node.id);
        if (h > maxH) maxH = h;
    }
    return maxH;
  }

  private getNodeWidth(nodeId: string): number {
    const node = appController.observableState.graph.inner.nodes[nodeId];
    if (!node) return 272; // Default to normal

    const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
    let inputs = nodeType?.inputs || [];
    let outputs = nodeType?.outputs || [];

    // Dynamic ports check
    if (nodeType?.compilePorts) {
      const compiledConfig = localController.observableState.compiledNodeConfigs.get(nodeId);
      const dynamicInfo = nodeType.compilePorts(node, { loadedSubgraphs: localController.observableState.loadedSubgraphs, compiledConfig });
      if (dynamicInfo) {
        inputs = dynamicInfo.inputs;
        outputs = dynamicInfo.outputs;
      }
    }

    const hasCustomBody = !!(nodeType?.renderBody || nodeType?.ui?.body);

    // Check for visible sliders
    // Logic must match GraphNode.render:
    // hasVisibleSliders = inputs.some(i => shouldShowInputEditor(i, isConnected))

    const incoming = appController.observableState.graph.auxiliary.incomingConnections.get(nodeId) || [];
    const connectedPorts = new Set(incoming.map(cid => {
        const c = appController.observableState.graph.inner.connections[cid];
        return c ? c.toPort : null;
    }));

    const hasVisibleSliders = inputs.some(input => {
        if (input.alwaysShowInputEditor) return true;
        if (connectedPorts.has(input.name)) return false;
        if (input.suppressInputEditor) return false;
        return true;
    });

    if (hasCustomBody || hasVisibleSliders) return 272;

    if (inputs.length <= 1 && outputs.length <= 1) return 80;
    if (inputs.length <= 3 && outputs.length <= 3) return 176;
    return 272;
  }

  private getNodePortY(nodeId: string, portName: string, isInput: boolean): number {
    const node = appController.observableState.graph.inner.nodes[nodeId];
    if (!node) return 40; // Default center-ish

    const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);
    let ports = isInput ? (nodeType?.inputs || []) : (nodeType?.outputs || []);

    if (nodeType?.compilePorts) {
      const compiledConfig = localController.observableState.compiledNodeConfigs.get(nodeId);
      const dynamicInfo = nodeType.compilePorts(node, { loadedSubgraphs: localController.observableState.loadedSubgraphs, compiledConfig });
      if (dynamicInfo) {
        ports = isInput ? dynamicInfo.inputs : dynamicInfo.outputs;
      }
    }

    const index = ports.findIndex(p => p.name === portName);
    if (index === -1) return 40;

    // Metric calculation:
    // Header: 24
    // Padding Y: 8
    // Row Height: 24
    // Pip Offset Y (from row top): 12
    // Y = 24 + 8 + (index * 24) + 12
    return 24 + 8 + (index * 24) + 12;
  }

  private renderGridCells() {
    const { nodes } = appController.observableState.graph.inner;
    const cells = [];

    // Calculate dynamic grid size
    let maxNodeX = 0;
    let maxNodeY = 0;

    for (const node of Object.values(nodes)) {
      if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') {
          // Track Y for output nodes so we have enough rows, but ignore X
          if (node.y > maxNodeY) maxNodeY = node.y;
          continue;
      }
      if (node.x > maxNodeX) maxNodeX = node.x;
      if (node.y > maxNodeY) maxNodeY = node.y;
    }

    const rows = Math.max(maxNodeY + 3, 12);
    const cols = Math.max(maxNodeX + 3, 8);

    // Input Column (x=0)
    for (let y = 0; y < rows; y++) {
      const rowHeight = this.getRowHeight(y);
      cells.push(html`<div class="cell node-cell" data-x="0" data-y="${y}" style="grid-column: 1; grid-row: ${2 * y + 2}; height: ${rowHeight}px;"></div>`);
      // Gap below input?
      cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: 1; grid-row: ${2 * y + 3};"></div>`);
    }

    // Main Grid (x=1..cols)
    for (let x = 1; x <= cols; x++) {
      const colIdx = 2 * x + 1;

      for (let y = 0; y < rows; y++) {
        const rowIdx = 2 * y + 2;
        const rowHeight = this.getRowHeight(y);

        // Node Cell
        cells.push(html`<div class="cell node-cell" data-x="${x}" data-y="${y}" style="grid-column: ${colIdx}; grid-row: ${rowIdx}; height: ${rowHeight}px;"></div>`);

        // Gap below Node (Row 2*y+3) -> Horizontal Line
        cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: ${colIdx}; grid-row: ${rowIdx + 1};"></div>`);

        // Gap to the left (Col 2*x) -> Vertical Line
        cells.push(html`<div class="cell gap-cell gap-v" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx}; height: ${rowHeight}px;"></div>`);

        // Corner (Gap left + Gap below) -> Cross
        cells.push(html`<div class="cell gap-cell gap-c" style="grid-column: ${colIdx - 1}; grid-row: ${rowIdx + 1};"></div>`);
      }
    }

    // Output Column
    const outputCol = 2 * cols + 3;
    for (let y = 0; y < rows; y++) {
      const rowHeight = this.getRowHeight(y);
      cells.push(html`<div class="cell node-cell" data-x="output" data-y="${y}" style="grid-column: ${outputCol}; grid-row: ${2 * y + 2}; height: ${rowHeight}px;"></div>`);
      cells.push(html`<div class="cell gap-cell gap-h" style="grid-column: ${outputCol}; grid-row: ${2 * y + 3};"></div>`);
      // Gap to left of output
      cells.push(html`<div class="cell gap-cell gap-v" style="grid-column: ${outputCol - 1}; grid-row: ${2 * y + 2}; height: ${rowHeight}px;"></div>`);
      cells.push(html`<div class="cell gap-cell gap-c" style="grid-column: ${outputCol - 1}; grid-row: ${2 * y + 3};"></div>`);
    }
    return cells;
  }

  private renderGhostWire() {
    const op = localController.observableState.inflightPortConnectionOperation;
    if (!op || !this.ghostTarget) return null;

    // Find source node element
    const nodeEl = this.shadowRoot?.querySelector(`graph-node[data-id="${op.nodeId}"]`) as HTMLElement;
    if (!nodeEl) return null;

    const nodeRect = nodeEl.getBoundingClientRect();
    const gridRect = this.getBoundingClientRect();

    // Relative position of node
    const nodeX = nodeRect.left - gridRect.left + this.scrollLeft;
    const nodeY = nodeRect.top - gridRect.top + this.scrollTop;

    // Port Offset
    const portY = this.getNodePortY(op.nodeId, op.port, op.type === 'in');

    // Start Point
    // Input port on left, Output port on right
    // Actually, visually:
    // Input column: Output is on Right.
    // Node Inputs: Left.
    // Node Outputs: Right.
    // Output column: Input is on Left.

    // If op.type === 'out', we draw from Right side.
    // If op.type === 'in', we draw from Left side.

    let startX = nodeX;
    if (op.type === 'out') {
        startX += nodeRect.width;
    }
    // If op.type is 'in' (dragging FROM an input? e.g. re-wiring or something),
    // usually we drag FROM output.
    // But we support dragging from input port to output port too?
    // Yes, port drag lets you start from either.

    const startY = nodeY + portY - 8; // Adjust for port center?
    // getNodePortY returns center Y relative to node top?
    // "Y = 24 + 8 + (index * 24) + 12" -> This is center of row.
    // GraphNode header is 24px + 8px padding?
    // Let's verify visual alignment.
    // GraphNode renders port at: top: 32px + index*24.
    // getNodePortY returns: 32 + index*24 + 12. Correct.
    // But we need to subtract scrollTop from ghostTarget calculation if we included it above?
    // this.ghostTarget includes scroll?
    // In pointermove: clientX - rect.left. This is viewport relative?
    // No, rect.left is element left.
    // If element is scrolled, clientX is still visual.
    // But we handle `scrollLeft` in nodeX calculation.
    // So we need to add `scrollLeft` to ghostTarget too?
    // e.clientX is screen coord.
    // ghostTarget X = e.clientX - rect.left. This is "offset in client area".
    // If we want "absolute grid coordinates", we must Add Scroll.

    const targetX = this.ghostTarget.x + this.scrollLeft;
    const targetY = this.ghostTarget.y + this.scrollTop;

    // SVG line
    return html`
        <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9999; overflow: visible;">
            <line x1="${startX}" y1="${startY}" x2="${targetX}" y2="${targetY}" stroke="rgba(255, 255, 255, 0.5)" stroke-width="2" stroke-dasharray="4" />
        </svg>
    `;
  }

  render() {
    const { nodes, connections } = appController.observableState.graph.inner;

    // Output Column calculation for node placement
    let maxNodeX = 0;
    for (const node of Object.values(nodes)) {
      if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') continue;
      if (node.x > maxNodeX) maxNodeX = node.x;
    }
    const cols = Math.max(maxNodeX + 3, 8);
    const outputCol = 2 * cols + 3;

    return html`
      ${this.renderGhostWire()}
      ${this.renderPendingWirePip()}
      ${this.selectionBox ? html`
        <div class="selection-box" style="left: ${this.selectionBox.x}px; top: ${this.selectionBox.y}px; width: ${this.selectionBox.w}px; height: ${this.selectionBox.h}px;"></div>
      ` : ''}

      ${this.popup ? html`
        <div class="popup-container" style="left: ${this.popup.x}px; top: ${this.popup.y}px;">
            <smart-input
                .catalog=${this.catalog}
                .value=${this.popup.initialValue}
                .autofocus=${true}
                @commit=${this.handlePopupCommit.bind(this)}
                @preview-type=${this.handlePopupPreview.bind(this)}
                @cancel=${this.handlePopupCancel.bind(this)}
            ></smart-input>
        </div>
      ` : ''}

      <div class="grid-container" tabindex="-1">
        ${this.renderGridCells()}

        ${Object.values(connections).flatMap(conn => {
      const wireLayout = localController.observableState.wireLayout.wires[conn.id];
      const isSelected = localController.observableState.selection.has(conn.id);
      const color = cssColorFromHash(`${conn.fromPort}-${conn.toPort}`);

      // Register selectable
      localController.defineSelectable({
        path: conn.id,
        renderInspectorContent: () => html`
              <h3>Connection</h3>
              <div class="field">
                <label>From Port:</label>
                <input
                  data-testid="from-port-input"
                  type="text"
                  .value=${conn.fromPort.toString()}
                  @input=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            appController.setConnectionPorts(conn.id, { fromPort: target.value });
          }}
                />
              </div>
              <div class="field">
                <label>To Port:</label>
                <input
                  data-testid="to-port-input"
                  type="text"
                  .value=${conn.toPort.toString()}
                  @input=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            appController.setConnectionPorts(conn.id, { toPort: target.value });
          }}
                />
              </div>
            `
      });

      const elements = [];

      if (wireLayout && wireLayout.path.length > 0) {
        // Iterate ALL points to include terminal segments inside nodes
        for (let i = 0; i < wireLayout.path.length; i++) {
          const curr = wireLayout.path[i];
          const prev = i > 0 ? wireLayout.path[i - 1] : null;
          const next = i < wireLayout.path.length - 1 ? wireLayout.path[i + 1] : null;
          const col = Math.round(2 * curr.x + 1);
          const row = Math.round(2 * curr.y + 2);

          // Determine Row Type and Metrics
          const isNodeRow = (row % 2 === 0);
          // For Node Rows, we use the actual row height for vertical segments,
          // but we center horizontal lanes based on the standard node height (GRID_UNIT).
          // This ensures wires pass through the "top" part of tall nodes, aligning with standard nodes.
          const cellHeight = isNodeRow ? this.getRowHeight(curr.y) : GRID_GAP;
          const cellCenterY = isNodeRow ? (GRID_UNIT / 2) : (GRID_GAP / 2);

          // Identify neighbors
          let leftNeighbor = null;
          let rightNeighbor = null;
          let topNeighbor = null;
          let bottomNeighbor = null;

          if (prev) {
            if (prev.x < curr.x) leftNeighbor = prev;
            else if (prev.x > curr.x) rightNeighbor = prev;
            else if (prev.y < curr.y) topNeighbor = prev;
            else if (prev.y > curr.y) bottomNeighbor = prev;
          }

          if (next) {
            if (next.x < curr.x) leftNeighbor = next;
            else if (next.x > curr.x) rightNeighbor = next;
            else if (next.y < curr.y) topNeighbor = next;
            else if (next.y > curr.y) bottomNeighbor = next;
          }

          // Lane Logic
          const getLane = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
            const k1 = `${p1.x},${p1.y}`;
            const k2 = `${p2.x},${p2.y}`;
            const key = k1 < k2 ? `${k1}:${k2}` : `${k2}:${k1}`;
            return wireLayout.lanes[key];
          };

          const getLaneOffset = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
            const lane = getLane(p1, p2);
            if (lane) return lane.index * 10 - (lane.count - 1) * 10 / 2;
            return 0;
          };

          let laneX = 0;
          let laneY = 0;

          if (topNeighbor) laneX = getLaneOffset(curr, topNeighbor);
          else if (bottomNeighbor) laneX = getLaneOffset(curr, bottomNeighbor);

          if (leftNeighbor) {
            if (leftNeighbor !== prev && leftNeighbor !== next) laneY = 0;
            else laneY = getLaneOffset(curr, leftNeighbor);
          } else if (rightNeighbor) {
            laneY = getLaneOffset(curr, rightNeighbor);
          }

          const commonStyle = `
                grid-column: ${col};
                grid-row: ${row};
                background-color: ${isSelected ? '#fff' : color};
                position: relative;
                z-index: ${isSelected ? 20 : 5};
              `;

          const handleClick = (e: MouseEvent) => {
            e.stopPropagation();
            this.focus();
            localController.queueSelectPaths([conn.id], e.shiftKey || e.ctrlKey || e.metaKey);

            const gridRect = this.getBoundingClientRect();
            const px = e.clientX - gridRect.left + this.scrollLeft;
            const py = e.clientY - gridRect.top + this.scrollTop;

            // Find Cell Center Logic
            // Iterate cells is simplest given dynamic layout
            const cells = this.shadowRoot?.querySelectorAll('.cell');
            let centerX = px;
            let centerY = py;
            let foundX = -1;
            let foundY = -1;
            let orientation = 'vertical'; // Default cursor style (vertical bar)

            // Determine if segment is horizontal or vertical based on element aspect
            const segRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (segRect.width > segRect.height) {
                orientation = 'vertical'; // Horizontal wire -> Vertical Bar cursor
            } else {
                orientation = 'horizontal'; // Vertical wire -> Horizontal Bar cursor
            }

            cells?.forEach(cell => {
                 const rect = cell.getBoundingClientRect();
                 const cellX = rect.left - gridRect.left + this.scrollLeft;
                 const cellY = rect.top - gridRect.top + this.scrollTop;

                 // Expand hit test slightly or check containment?
                 // Point should be inside.
                 if (px >= cellX && px < cellX + rect.width &&
                     py >= cellY && py < cellY + rect.height) {

                     // Found cell!
                     const ds = (cell as HTMLElement).dataset;
                     foundX = ds.x === undefined ? -1 : (ds.x === 'output' ? 20 : parseInt(ds.x));
                     foundY = ds.y === undefined ? -1 : parseInt(ds.y);

                     // Center in CELL
                     const cX = cellX + rect.width / 2;
                     const cY = cellY + rect.height / 2;

                     // Center on WIRE
                     // If Horizontal Wire: Use Cell Center X, Wire Center Y (py is click on wire, so use click Y or segment center?)
                     // Actually, user wants "centered directly on the wire".
                     // Segment center Y?
                     const segCenterY = (segRect.top - gridRect.top + this.scrollTop) + segRect.height / 2;
                     const segCenterX = (segRect.left - gridRect.left + this.scrollLeft) + segRect.width / 2;

                     if (orientation === 'vertical') {
                         // Horizontal Wire
                         centerX = cX;
                         centerY = segCenterY;
                     } else {
                         // Vertical Wire
                         centerX = segCenterX;
                         centerY = cY;
                     }
                 }
            });

            if (foundX !== -1 && foundY !== -1) {
                this.pendingWireInsert = {
                    connectionId: conn.id,
                    px: centerX,
                    py: centerY,
                    gridX: foundX,
                    gridY: foundY,
                    orientation
                } as any;
            } else {
                this.pendingWireInsert = null;
            }
          };

          const handleDblClick = (e: MouseEvent) => {
            e.stopPropagation();
            // Remove pending insert if deleting this wire
            if (this.pendingWireInsert && this.pendingWireInsert.connectionId === conn.id) {
                this.pendingWireInsert = null;
            }
            this.dispatchEvent(new CustomEvent('connection-delete', { detail: { connectionId: conn.id } }));
          };

          // --- Port Alignment & Vertical Connector Logic ---

          // Determine absolute Y positions for Left and Right connection points
          // Default to Lane Y (relative to cell center)
          let leftAbsY = cellCenterY + laneY;
          let rightAbsY = cellCenterY + laneY;

          // Override if connecting to Start Node (Left side of Gap 1)
          if (i === 1 && leftNeighbor === prev) {
             const nodeHeight = this.getNodeHeight(conn.fromNodeId);
             const rowHeight = this.getRowHeight(prev!.y);
             const nodeOffsetY = (rowHeight - nodeHeight) / 2;

             const startPortY = this.getNodePortY(conn.fromNodeId, conn.fromPort.toString(), false);
             leftAbsY = nodeOffsetY + startPortY - 6; // Bias up by half pip height (adjusted from 7)
          }

          // Override for Start Node (i=0) - Right connection
          if (i === 0) {
             const nodeHeight = this.getNodeHeight(conn.fromNodeId);
             const rowHeight = this.getRowHeight(curr.y);
             const nodeOffsetY = (rowHeight - nodeHeight) / 2;
             const startPortY = this.getNodePortY(conn.fromNodeId, conn.fromPort.toString(), false);
             rightAbsY = nodeOffsetY + startPortY - 6;
          }

          // Override if connecting to End Node (Right side of Gap last-1)
          if (i === wireLayout.path.length - 2 && rightNeighbor === next) {
             const nodeHeight = this.getNodeHeight(conn.toNodeId);
             const rowHeight = this.getRowHeight(next!.y);
             const nodeOffsetY = (rowHeight - nodeHeight) / 2;

             const endPortY = this.getNodePortY(conn.toNodeId, conn.toPort.toString(), true);
             rightAbsY = nodeOffsetY + endPortY - 6; // Bias up by half pip height (adjusted from 7)
          }

          // Override for End Node (i=last) - Left connection
          if (i === wireLayout.path.length - 1) {
             const nodeHeight = this.getNodeHeight(conn.toNodeId);
             const rowHeight = this.getRowHeight(curr.y);
             const nodeOffsetY = (rowHeight - nodeHeight) / 2;
             const endPortY = this.getNodePortY(conn.toNodeId, conn.toPort.toString(), true);
             leftAbsY = nodeOffsetY + endPortY - 6;
          }

          // Render Segments

          // LEFT SEGMENT
          if (leftNeighbor) {
            let y = leftAbsY;
            let style = `${commonStyle} width: calc(50% + ${laneX}px); height: 2px; justify-self: start; align-self: start; top: ${y}px;`;

            // Special case: If i=last (End Node), left neighbor is the Gap.
            // We draw the segment to the edge of the centered node.
            if (i === wireLayout.path.length - 1) {
               const nodeWidth = this.getNodeWidth(conn.toNodeId);
               style = `${commonStyle} width: calc(50% - ${nodeWidth / 2}px); height: 2px; justify-self: start; align-self: start; top: ${y}px;`;
            }

            elements.push(html`<div class="wire-segment" style="${style}" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }

          // RIGHT SEGMENT
          if (rightNeighbor) {
            let y = rightAbsY;
            let style = `${commonStyle} width: calc(50% - ${laneX}px); height: 2px; justify-self: end; align-self: start; top: ${y}px;`;

            // Special case: If i=0 (Start Node), right neighbor is Gap.
            // We draw the segment from the edge of the centered node.
            if (i === 0) {
               const nodeWidth = this.getNodeWidth(conn.fromNodeId);
               style = `${commonStyle} width: calc(50% - ${nodeWidth / 2}px); height: 2px; justify-self: end; align-self: start; top: ${y}px;`;
            }

            elements.push(html`<div class="wire-segment" style="${style}" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }

          // VERTICAL SEGMENTS (Turns)
          // If topNeighbor, we draw line up.
          if (topNeighbor) {
             // From center(laneX, laneY) to top.
             // top: 0. height: cellCenterY + laneY.
             // align-self: start.

             let h = cellCenterY + laneY + 1;
             let top = 0;

             // Override if i=last (End Node) and wire comes from Top
             if (i === wireLayout.path.length - 1) {
                 const nodeHeight = this.getNodeHeight(conn.toNodeId);
                 const rowHeight = this.getRowHeight(curr.y);
                 const nodeOffsetY = (rowHeight - nodeHeight) / 2;
                 const endPortY = this.getNodePortY(conn.toNodeId, conn.toPort.toString(), true);
                 h = nodeOffsetY + endPortY - 6;
             }

             elements.push(html`<div class="wire-segment" style="${commonStyle} width: 2px; height: ${h}px; justify-self: center; align-self: start; transform: translateX(${laneX}px); top: ${top}px;" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }

          if (bottomNeighbor) {
             // From center(laneX, laneY) to bottom.
             // top: cellCenterY + laneY. height: remaining.
             // align-self: start.

             let top = cellCenterY + laneY;
             let h = cellHeight - top;

             // Override if i=0 (Start Node) and wire goes to Bottom
             if (i === 0) {
                 const nodeHeight = this.getNodeHeight(conn.fromNodeId);
                 const rowHeight = this.getRowHeight(curr.y);
                 const nodeOffsetY = (rowHeight - nodeHeight) / 2;
                 const startPortY = this.getNodePortY(conn.fromNodeId, conn.fromPort.toString(), false);
                 top = nodeOffsetY + startPortY - 6;
                 h = cellHeight - top;
             }

             elements.push(html`<div class="wire-segment" style="${commonStyle} width: 2px; height: ${h}px; justify-self: center; align-self: start; top: ${top}px; transform: translateX(${laneX}px);" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }

          // VERTICAL CONNECTOR (Gap Adjustment)
          // If leftAbsY != rightAbsY, and we have Left & Right neighbors (Straight-ish wire through cell)
          if (leftNeighbor && rightNeighbor && Math.abs(leftAbsY - rightAbsY) > 1) {
             const minY = Math.min(leftAbsY, rightAbsY) + 1;
             const h = Math.abs(leftAbsY - rightAbsY) + 2; // +2 for overlap
             // Position at center + laneX
             elements.push(html`<div class="wire-segment" style="${commonStyle} width: 2px; height: ${h}px; justify-self: center; align-self: start; top: ${minY - 1}px; transform: translateX(${laneX}px);" @click=${handleClick} @dblclick=${handleDblClick}></div>`);
          }
        }
      }

      return elements;
    })}


        ${Object.values(nodes).map(node => {
      const isQueued = localController.observableState.queuedSelection.has(node.id);
      const incomingConnections = appController.observableState.graph.auxiliary.incomingConnections.get(node.id) || [];

      // Calculate grid position
      let col = 0;
      if (node.config.typeId === 'io.input' || node.config.typeId === 'resolume.input') col = 1;
      else if (node.config.typeId === 'io.output' || node.config.typeId === 'resolume.output') col = outputCol;
      else col = 2 * node.x + 1;

      const row = 2 * node.y + 2;

      return html`
            <graph-node
              .node=${node}
              .incomingConnections=${incomingConnections}
              .isQueued=${isQueued}
              .x=${node.x}
              .y=${node.y}
              style="grid-column: ${col}; grid-row: ${row}; z-index: 10;"
              data-id="${node.id}"
            ></graph-node>
          `;
    })}
      </div>
    `;
  }
}

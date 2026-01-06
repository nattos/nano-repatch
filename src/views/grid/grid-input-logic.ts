import { AppController } from '../../builder/state';
import { LocalController } from '../../builder/local-state';
import { defaultNodeRepository } from '../../structor/repository';
import { GridPopupManager } from './popup-manager';
import { SelectionInteraction } from './selection-interaction';
import { RuntimeManager } from '../../runtime/manager';
import { PointerDragOp } from '../../utils/pointer-drag-op';

export interface GridInputHost {
  element: HTMLElement;
  getScrollState(): { scrollLeft: number, scrollTop: number };
  getBoundingClientRect(): DOMRect;
  closePopup(): void;
  // ...
}

export class GridInputLogic {
  constructor(
    private host: GridInputHost,
    private appController: AppController,
    private localController: LocalController,
    private runtimeManager: RuntimeManager,
    private selectionManager: SelectionInteraction,
    private popupManager: GridPopupManager
  ) { }

  handlePointerDown(e: PointerEvent) {
    // If popup is open, let host handle closing via focus/blur or specific logic?
    // GraphGrid logic was: check if click outside popup.
    // This is UI logic.
    this.host.closePopup();

    this.runtimeManager.resumeAudio();

    const path = e.composedPath();
    const isNode = path.some(el => (el as Element).tagName === 'GRAPH-NODE');
    const isConnection = path.some(el => (el as Element).tagName === 'GRAPH-CONNECTION');
    const isWire = path.some(el => (el as Element).classList?.contains('wire-segment'));

    if (isNode || isConnection || isWire) return;

    // Region Interaction
    const regionBox = path.find(el => (el as Element).classList?.contains('region-box')) as HTMLElement;
    const borderRail = path.find(el => (el as Element).classList?.contains('border-rail')) as HTMLElement;
    const resizeHandle = path.find(el => (el as Element).classList?.contains('resize-handle')) as HTMLElement;

    // Helper to select region
    const selectRegion = (nodeId: string, ev: PointerEvent) => {
      const regionId = `region-${nodeId}`;
      if (!this.localController.observableState.selection.has(regionId)) {
        if (!ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
          this.localController.queueSelectPaths([regionId], false); // Exclusive
        } else {
          this.localController.queueSelectPaths([regionId], true); // Additive
        }
      }
    };

    // Shared Resize Logic
    if (resizeHandle || borderRail) {
      const target = (resizeHandle || borderRail);
      const nodeId = target.dataset.nodeId!;
      // Handle Type: 'n', 's', 'e', 'w' for rails; 'e', 's', 'se' for handles
      // We can normalize checks.
      const type = target.dataset.handle || target.dataset.rail!;

      const node = this.appController.observableState.graph.inner.nodes[nodeId];
      if (!node) return;

      selectRegion(nodeId, e);

      const def = defaultNodeRepository.getNodeType(node.config.typeId);
      const region = def?.getRegion ? def.getRegion(node.config) : { width: 1, height: 1, x: 0, y: 0 };

      const startW = region.width;
      const startH = region.height;
      const startRegionX = region.x || 0;
      const startRegionY = region.y || 0;

      const startX = e.clientX;
      const startY = e.clientY;

      new PointerDragOp(e, this.host.element, {
        move: (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;

          const gridDeltaX = Math.round(dx / 96);
          const gridDeltaY = Math.round(dy / 48);

          let newW = startW;
          let newH = startH;
          let newX = startRegionX;
          let newY = startRegionY;

          // Width Resizing
          if (type === 'e' || type === 'se') {
            newW = Math.max(1, startW + gridDeltaX);
          }
          if (type === 'w') {
            // Clamping Logic
            // 1. Min Size: startW - delta >= 1  => delta <= startW - 1
            // 2. Boundary: node.x + startRegionX + delta >= 0 => delta >= -(node.x + startRegionX)

            const maxDelta = startW - 1;
            const minDelta = -(node.x + startRegionX);
            const clampedDelta = Math.min(Math.max(gridDeltaX, minDelta), maxDelta);

            newW = startW - clampedDelta;
            newX = startRegionX + clampedDelta;
          }

          // Height Resizing
          if (type === 's' || type === 'se') {
            newH = Math.max(1, startH + gridDeltaY);
          }
          if (type === 'n') {
            // Clamping Logic
            // 1. Min Size: startH - delta >= 1 => delta <= startH - 1
            // 2. Boundary: node.y + startRegionY + delta >= 0 => delta >= -(node.y + startRegionY)

            const maxDelta = startH - 1;
            const minDelta = -(node.y + startRegionY);
            const clampedDelta = Math.min(Math.max(gridDeltaY, minDelta), maxDelta);

            newH = startH - clampedDelta;
            newY = startRegionY + clampedDelta;
          }

          const changes: any = {};
          if (newW !== node.config.width) changes.width = newW;
          if (newH !== node.config.height) changes.height = newH;
          if (newX !== node.config.regionX) changes.regionX = newX;
          if (newY !== node.config.regionY) changes.regionY = newY;

          if (Object.keys(changes).length > 0) {
            this.appController.setNodeConfig(nodeId, changes, { skipHistory: true });
          }
        },
        accept: () => {
          const finalNode = this.appController.observableState.graph.inner.nodes[nodeId];
          if (finalNode) {
            const startConfig = {
              width: startW,
              height: startH,
              regionX: startRegionX,
              regionY: startRegionY
            };
            const finalConfig = {
              width: finalNode.config.width,
              height: finalNode.config.height,
              regionX: finalNode.config.regionX || 0,
              regionY: finalNode.config.regionY || 0
            };

            if (finalConfig.width !== startConfig.width ||
              finalConfig.height !== startConfig.height ||
              finalConfig.regionX !== startConfig.regionX ||
              finalConfig.regionY !== startConfig.regionY) {
              this.appController.commitConfigHistory(nodeId, startConfig, finalConfig);
            }
          }
        }
      });
      return;
    }

    if (regionBox) {
      // If we are here, pointer-events was auto, meaning it IS selected.
      const nodeId = regionBox.dataset.regionNodeId!;

      // Move Logic (Offset)
      const node = this.appController.observableState.graph.inner.nodes[nodeId];
      if (!node) return;

      const def = defaultNodeRepository.getNodeType(node.config.typeId);
      const region = def?.getRegion ? def.getRegion(node.config) : { x: 0, y: 0 };

      const startRegionX = region.x || 0;
      const startRegionY = region.y || 0;
      const startX = e.clientX;
      const startY = e.clientY;

      const startConfig = { regionX: startRegionX, regionY: startRegionY };

      new PointerDragOp(e, this.host.element, {
        move: (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;

          const gridDeltaX = Math.round(dx / 96);
          const gridDeltaY = Math.round(dy / 48);

          const newRegionX = startRegionX + gridDeltaX;
          const newRegionY = startRegionY + gridDeltaY;

          // Check BOUNDARY (absolute pos >= 0)
          if ((node.x + newRegionX) < 0 || (node.y + newRegionY) < 0) {
            return;
          }

          if (newRegionX !== node.config.regionX || newRegionY !== node.config.regionY) {
            this.appController.setNodeConfig(nodeId, { regionX: newRegionX, regionY: newRegionY }, { skipHistory: true });
          }
        },
        accept: () => {
          const finalNode = this.appController.observableState.graph.inner.nodes[nodeId];
          if (finalNode) {
            const finalConfig = {
              regionX: finalNode.config.regionX || 0,
              regionY: finalNode.config.regionY || 0
            };
            if (finalConfig.regionX !== startConfig.regionX ||
              finalConfig.regionY !== startConfig.regionY) {
              this.appController.commitConfigHistory(nodeId, startConfig, finalConfig);
            }
          }
        }
      });

      return;
    }

    this.selectionManager.start(e);
  }

  handleDblClick(e: MouseEvent) {
    const path = e.composedPath();
    const target = path[0] as HTMLElement;

    // Check for cell click (Creation)
    if (target.classList.contains('cell')) {
      // Check if it's a node cell
      if (target.classList.contains('node-cell')) {
        const rawX = target.dataset.x;
        const gridY = parseInt(target.dataset.y || '0');

        let initialValue = 'util.hub';
        let gridX = 0;

        if (rawX === 'output') {
          initialValue = 'io.output';
          gridX = 20; // Default output col heuristic (should use actual layout context but 20 is legacy fallback)
        } else if (rawX === 'input') {
          initialValue = 'io.input';
          gridX = 0;
        } else {
          gridX = parseInt(rawX || '0');
        }

        // Check if a node already exists at this location
        const nodes = Object.values(this.appController.observableState.graph.inner.nodes);
        const occupied = nodes.some(n => n.x === gridX && n.y === gridY);

        if (occupied) return;

        // Calculate visual position for popup
        const rect = target.getBoundingClientRect();
        const parentRect = this.host.getBoundingClientRect();
        const { scrollLeft, scrollTop } = this.host.getScrollState();

        const popupX = rect.left - parentRect.left + scrollLeft;
        const popupY = rect.top - parentRect.top + scrollTop - 40;

        this.popupManager.startCreation(popupX, popupY, gridX, gridY, initialValue);
      }
      return;
    }

    // Check for Node Click (Deletion)
    // Find closest graph-node
    const nodeElement = path.find(el => (el as Element).nodeName === 'GRAPH-NODE') as HTMLElement;

    if (nodeElement) {
      const id = nodeElement.getAttribute('data-id') || nodeElement.dataset?.id;
      if (id) {
        this.handleNodeDeletion(id);
      }
    }
  }

  private handleNodeDeletion(id: string) {
    // Group Deletion Logic
    const lastGroup = this.localController.observableState.lastGroupSelection;
    if (lastGroup && lastGroup.has(id)) {
      const nodesToDelete = Array.from(lastGroup).filter(itemId => itemId.startsWith('node-'));
      this.appController.transaction(() => {
        nodesToDelete.forEach(nid => this.appController.deleteNode(nid));
      });
      this.localController.setLastGroupSelection(null);
      return;
    }

    // Splice Deletion Logic
    const node = this.appController.observableState.graph.inner.nodes[id];
    if (node) {
      const connections = Object.values(this.appController.observableState.graph.inner.connections);
      const nodeType = defaultNodeRepository.getNodeType(node.config.typeId);

      const firstInputName = nodeType?.inputs?.[0]?.name;
      const firstOutputName = nodeType?.outputs?.[0]?.name;

      if (firstInputName && firstOutputName) {
        const inputConns = connections.filter(c => c.toNodeId === id && c.toPort === firstInputName);
        const outputConns = connections.filter(c => c.fromNodeId === id && c.fromPort === firstOutputName);

        if (inputConns.length === 1 && outputConns.length === 1) {
          const inConn = inputConns[0];
          const outConn = outputConns[0];

          this.appController.transaction((c) => {
            c.deleteNode(id);
            c.createConnection(inConn.fromNodeId, inConn.fromPort, outConn.toNodeId, outConn.toPort);
          });
          return;
        }
      }
    }

    this.appController.deleteNode(id);
  }
}

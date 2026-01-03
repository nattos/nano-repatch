import { AppController } from '../../builder/state';
import { LocalController } from '../../builder/local-state';
import { defaultNodeRepository } from '../../structor/repository';
import { GridPopupManager } from './popup-manager';
import { SelectionInteraction } from './selection-interaction';
import { RuntimeManager } from '../../runtime/manager';

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

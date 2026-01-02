import { PointerDragOp } from '../../utils/pointer-drag-op';

export interface NodeElement extends HTMLElement {
  dataset: DOMStringMap;
}

export interface SelectionHost {
  element: HTMLElement; // The checking element (grid)
  getScrollState(): { scrollLeft: number, scrollTop: number };
  getNodes(): NodeElement[] | NodeListOf<NodeElement>;
  setSelectionBox(box: { x: number, y: number, w: number, h: number } | null): void;
  onSelectionChange(selectedIds: string[], isAdditive: boolean): void;
}

export class SelectionInteraction {
  private isAdditive = false;

  constructor(private host: SelectionHost) { }

  start(e: PointerEvent) {
    const rect = this.host.element.getBoundingClientRect();
    const { scrollLeft, scrollTop } = this.host.getScrollState();

    const startX = e.clientX - rect.left + scrollLeft;
    const startY = e.clientY - rect.top + scrollTop;

    this.isAdditive = !!(e.shiftKey || e.ctrlKey || e.metaKey);

    let lastSelectedIdsStr = '';

    new PointerDragOp(e, this.host.element, {
      move: (e, delta) => {
        const { scrollLeft, scrollTop } = this.host.getScrollState();
        const currentX = e.clientX - rect.left + scrollLeft;
        const currentY = e.clientY - rect.top + scrollTop;

        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);

        this.host.setSelectionBox({ x, y, w, h });

        const selectedIds: string[] = [];
        const nodeElements = this.host.getNodes();

        nodeElements.forEach(el => {
          const nodeRect = el.getBoundingClientRect();
          const nodeX = nodeRect.left - rect.left + scrollLeft;
          const nodeY = nodeRect.top - rect.top + scrollTop;

          if (x < nodeX + nodeRect.width && x + w > nodeX &&
            y < nodeY + nodeRect.height && y + h > nodeY) {
            const id = el.dataset.id;
            if (id) selectedIds.push(id);
          }
        });

        selectedIds.sort();
        const currentSelectedIdsStr = selectedIds.join(',');
        if (currentSelectedIdsStr !== lastSelectedIdsStr) {
          this.host.onSelectionChange(selectedIds, this.isAdditive);
          lastSelectedIdsStr = currentSelectedIdsStr;
        }
      },
      accept: () => {
        this.host.setSelectionBox(null);
      },
      cancel: () => {
        this.host.setSelectionBox(null);
        this.host.onSelectionChange([], false);
      }
    });
  }
}

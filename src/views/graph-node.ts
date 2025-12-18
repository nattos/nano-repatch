import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { reaction } from 'mobx';
import { GridNode, LongEdit, AppController } from '../builder/state';
import { appController, localController, runtimeManager } from '../builder/controllers';
import { cssColorFromHash } from '../utils/layout-utils';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { defaultNodeRepository, PortHint, GraphNodeRenderHandlers, InspectorChangeHandler } from '../structor/repository'; // Import repository
import '../structor/repository.ui'; // Import UI repository side-effects
import { parseFloatOr } from '../utils/utils';
import { getNodeVisualState, shouldShowInputEditor } from '../utils/node-width-utils';
import '../components/smart-input';
import './scalar-slider';
import { NodeCatalog } from '../structor/node-catalog';
import './graph-port';
import { globalStyles } from '../styles';
import { formatValue } from './formatters';
import {
  NODE_WIDTH_NORMAL,
  NODE_CONTENT_WIDTH,
  NODE_WIDTH_COMPRESSED,
  NODE_WIDTH_MINIMAL,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  NODE_PADDING_X,
  NODE_PADDING_Y,
  SLIDER_LABEL_WIDTH,
  SLIDER_HEIGHT,
  PIP_OFFSET_X,
  LABEL_PADDING_X,
  NODE_BORDER_WIDTH
} from '../constants';


@customElement('graph-node')
export class GraphNode extends MobxLitElement {
  // RENDER PLAN:
  // 1. Get NodeType from repository using node.config.typeId.
  // 2. Render input and output ports based on NodeType.inputs and NodeType.outputs.
  //    - Position them dynamically around the node.
  //    - The `data-port` attribute on the port element will be the PortHint.name.
  // 3. For "virtual inputs" (inputs with `defaultValue`):
  //    - Check if there's an incoming connection for that port.
  //    - If not, render an input control on the node (e.g., a slider for range, number input otherwise).
  //    - When this control is changed, it should update the node's config.
  //      `appController.setNodeConfig(this.node.id, { values: { min: 0.5 } })`
  // 4. Update port connection logic:
  //    - `handlePortClick` should use the `PortHint.name` from `data-port`.
  //    - When creating a connection, the `from.port` and `to.port` will be the correct names.

  @property({ attribute: false })
  node!: GridNode;

  @property({ attribute: false })
  incomingConnections: string[] = [];

  @property({ type: Boolean })
  isQueued = false;

  @property({ type: Number })
  x = 0;

  @property({ type: Number })
  y = 0;

  private catalog = new NodeCatalog(defaultNodeRepository);

  @state()
  private loadedBodyRenderer: ((node: GridNode, handlers: GraphNodeRenderHandlers) => unknown) | null = null;

  @state()
  private loadedInspectorRenderer: ((node: GridNode, onchange: InspectorChangeHandler) => unknown) | null = null;

  @state()
  private loadedInputEditorRenderer: ((node: GridNode, portName: string, handlers: GraphNodeRenderHandlers) => unknown) | null = null;

  private hasRequestedBodyLoad = false;
  private hasRequestedInspectorLoad = false;
  private hasRequestedInputEditorLoad = false;

  @state()
  private editingField: 'name' | 'type' | null = null;

  private typeLongEdit: LongEdit | null = null;
  private sliderLongEdit: LongEdit | null = null;
  private activeSliderPort: string | null = null;



  static readonly styles = [
    ...globalStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      background-color: var(--node-bg);
      border-radius: 10px;
      width: 120px; /* Adjusted width */
      min-height: 80px;
      color: var(--text-color);
      cursor: grab;
      position: relative;
      border: 2px solid transparent;
      transition: border-color 0.2s;
      box-sizing: border-box;
      box-sizing: border-box;
      /* place-self: start; Removed to allow grid alignment */
      /* padding: 10px; Removed padding to allow full control of node size */
      transition: width 0.2s, height 0.2s, border-radius 0.2s;
    }



    :host([data-state="normal"]) {
      width: ${NODE_WIDTH_NORMAL}px;
    }

    :host([data-state="compressed"]) {
      width: ${NODE_WIDTH_COMPRESSED}px;
    }

    :host([data-state="minimal"]) {
      width: ${NODE_WIDTH_MINIMAL}px;
      height: ${NODE_WIDTH_MINIMAL}px;
      border-radius: 50%;
      min-height: ${NODE_WIDTH_MINIMAL}px;
    }

    :host([data-state="minimal"]) .node {
      border-radius: 50%;
    }

    :host([data-state="minimal"]) .node-title {
      font-size: 0.7em;
      text-align: center;
      width: 100%;
      height: 100%;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 0;
      overflow: visible; /* Allow edit box to show */
      white-space: normal; /* Allow wrapping if needed, though usually short */
    }

    :host([data-state="minimal"]) smart-input {
      text-align: left;
      font-size: 14px;
      font-weight: normal;
    }

    :host([data-state="minimal"]) .editable-label-wrapper.name {
      font-weight: bold;
      overflow: visible;
      justify-content: center;
    }

    :host([data-state="minimal"]) .editable-label-wrapper.type {
      font-size: 0.8em;
      opacity: 0.7;
      overflow: visible;
      justify-content: center;
    }

    .node {
      position: absolute;
      background-color: var(--node-bg);
      border-radius: 8px;
      /* "Clear Gel" shadow: darker, tighter drop shadow + subtle rim light */
      box-shadow: 0 4px 15px rgba(0,0,0,0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      display: flex;
      flex-direction: column;
      /* overflow: hidden; */
      user-select: none;
      border: 1px solid var(--node-border);
      border-left: ${NODE_BORDER_WIDTH}px solid var(--node-accent-color, var(--node-border));
      transition: box-shadow 0.2s, border-color 0.2s;
      box-sizing: border-box; /* Ensure borders are included in width */
    }



    :host([selected]) {
      border-color: var(--accent-color);
      box-shadow: 0 0 10px var(--selection-color);
    }

    .node-main-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 5px 0;
    }

    .node-title {
      font-weight: bold;
      margin: 2px 0;
      width: calc(100% - 19px);
      display: flex;
      align-items: baseline;
      gap: 6px;
      white-space: nowrap;
      white-space: nowrap;
      white-space: nowrap;
      overflow: hidden;
      padding: 0 var(--node-padding-x); /* Align with port labels */
      cursor: crosshair; /* Hint at interaction */
    }

    .node-title.editing {
      overflow: visible;
    }

    .editable-label-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .editable-label-wrapper.name {
      flex-grow: 1;
      overflow: hidden;
      min-width: 30px;
    }
    .editable-label-wrapper.name.editing {
      overflow: visible;
    }

    .editable-label-wrapper.type {
      flex-shrink: 0;
    }
    .editable-label-wrapper.type.editing {
      overflow: visible;
    }

    .node-type-id {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7em;
      color: var(--text-muted, #888);
      font-weight: normal;
      flex-shrink: 0;
    }

    .ports-wrapper {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      justify-content: space-between;
      pointer-events: none; /* Allow clicks to pass through to node-main-content */
      z-index: 10; /* Ensure ports render above custom editors */
    }

    .inputs, .outputs {
      display: flex;
      flex-direction: column;
      justify-content: flex-start; /* Stack from top */
      padding: 5px 0;
      pointer-events: all; /* Re-enable pointer events for ports */
      gap: 0; /* No gap, use fixed height */
      top: 0px;
    }

    .inputs {
      align-items: flex-start;
      position: relative;
      left: ${PIP_OFFSET_X}px; /* Move pips out to hang off node */
    }

    .outputs {
      align-items: flex-end;
      position: relative;
      right: ${PIP_OFFSET_X}px; /* Move pips out */
    }

    .virtual-inputs-container {
      position: absolute;
      top: 0;
      left: calc(var(--node-padding-x) - ${NODE_BORDER_WIDTH}px - 1px);
      width: ${NODE_CONTENT_WIDTH}px;
      display: flex;
      flex-direction: column;
      pointer-events: none;
      z-index: 5;
    }

    .virtual-input-field-wrapper {
      display: flex;
      flex-direction: row; /* Horizontal layout for labels + slider */
      align-items: center;
      width: 100%;
      height: var(--row-height); /* Match port height */
      justify-content: space-between;
      pointer-events: auto;
    }

    .slider-label {
      width: ${SLIDER_LABEL_WIDTH}px;
      font-size: 0.7em;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
      box-sizing: border-box;
    }

    .slider-label:first-child {
      text-align: left;
      padding-left: ${LABEL_PADDING_X}px;
    }

    .slider-label:last-child {
      text-align: right;
      padding-right: ${LABEL_PADDING_X}px;
    }

    .virtual-input-field {
      flex-grow: 1; /* Fill remaining space */
      width: auto; /* Let flex handle width */
      padding: 0;
      margin: 0 ${LABEL_PADDING_X}px;
      /* height: ${ROW_HEIGHT}px; Removed to allow slider to be 22px */
    }




    .debug-chip-wrapper {
      position: absolute;
      left: 100%; /* Position to the right of the port (outside) */
      margin-left: 8px;
      pointer-events: none;
      z-index: 10;
      white-space: nowrap;
    }

    /* Styles for chips returned by formatValue */
    .chip {
      display: inline-flex;
      align-items: center;
      background: rgba(0, 0, 0, 0.7);
      color: #ddd;
      padding: 1px 4px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      border: 1px solid #444;
    }

    .chip.vector {
      background: rgba(42, 63, 74, 0.8);
      color: #8dc1e3;
      border-color: #3a5f7a;
    }

    .chip.struct {
      background: rgba(58, 42, 74, 0.8);
      color: #c18de3;
      border-color: #5f3a7a;
    }

    .chip.midi {
      background: rgba(74, 58, 42, 0.8);
      color: #e3c18d;
      border-color: #7a5f3a;
    }

    .chip.midi-stream {
      background: rgba(42, 74, 58, 0.8);
      color: #8de3c1;
      border-color: #3a7a5f;
    }

    .chip.sequence {
      background: rgba(50, 50, 50, 0.8);
      color: #aaa;
      border-color: #555;
    }
  `];

  private renderDebugValue(portName: string) {
    if (!localController.observableState.localSettings.showDebugValues) return null;

    const output = runtimeManager.outputs.get(this.node.id);
    if (!output) return null;

    let value: any = undefined;
    let type: any = undefined;

    // Get Node Type for metadata
    const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);

    // Check fields first
    if (output.fields && portName in output.fields) {
      value = output.fields[portName];
      if (nodeType && nodeType.outputs) {
        const port = nodeType.outputs.find(p => p.name === portName);
        if (port) type = port.type;
      }
    }
    // Then check untagged if it's the default output (empty string name)
    else if (portName === '' && output.untagged && output.untagged.length > 0) {
      value = output.untagged[0];
      // Type for untagged?
    }

    if (value === undefined) return null;

    // Use shared formatter
    return html`<div class="debug-chip-wrapper">${formatValue(value, type)}</div>`;
  }

  private handlePointerUp(e: PointerEvent) {
    // Check if we are dropping a connection onto the node header/body (not specific port)
    const { inflightPortConnectionOperation } = localController.observableState;
    if (inflightPortConnectionOperation && inflightPortConnectionOperation.nodeId !== this.node.id) {
      // Auto-connect logic
      // If dragging Output -> Connect to First Input
      // If dragging Input -> Connect to First Output

      const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
      let targetPortName: string | null = null;
      let targetPortType: 'in' | 'out' | null = null;

      if (inflightPortConnectionOperation.type === 'out') {
        // Connect to Input
        // Find first compatible input? Or just first input.
        // For now, first input.
        // Verify dynamic ports?
        // Use inferred types if available (handled in render, but logic should use same source).
        // Let's use nodeType inputs for now, or check inferred.
        // Accessing inferred inputs is safer for dynamic nodes.
        const inferredType = localController.observableState.inferredNodeTypes.get(this.node.id);
        // But inferred inputs only show connected ones usually?
        // Actually, inferred inputs logic in render merges static + dynamic.
        // Let's use the static definition first, it's safer for "first port".
        const inputs = nodeType?.inputs || [];
        if (inputs.length > 0) {
          targetPortName = inputs[0].name;
          targetPortType = 'in';
        }
      } else {
        // Connect to Output
        const outputs = nodeType?.outputs || [];
        if (outputs.length > 0) {
          targetPortName = outputs[0].name;
          targetPortType = 'out';
        }
      }

      if (targetPortName && targetPortType) {
        e.stopPropagation(); // Handle it!

        if (inflightPortConnectionOperation.type === 'out') {
          // Dragged Out -> In
          appController.createConnection(
            inflightPortConnectionOperation.nodeId,
            inflightPortConnectionOperation.port,
            this.node.id,
            targetPortName
          );
        } else {
          // Dragged In -> Out (Reverse connection)
          // inflight (Input) is the Destination
          // this.node (Output) is the Source
          appController.createConnection(
            this.node.id,
            targetPortName,
            inflightPortConnectionOperation.nodeId,
            inflightPortConnectionOperation.port
          );
        }

        localController.setInflightPortConnectionOperation(null);
        return;
      }
    }
  }

  private handlePointerDown(e: PointerEvent) {
    // Ignore if clicking on a port or virtual input field
    // We need to check composed path because the target might be inside the shadow DOM of the input
    const path = e.composedPath();
    const isPort = path.some(el => (el as HTMLElement).tagName?.toLowerCase() === 'graph-port');
    const isInteractiveContent = path.some(el => (el as HTMLElement).classList?.contains('virtual-inputs-container'));

    if (isPort || isInteractiveContent) {
      return;
    }

    // If the node is not selected, select it (replacing current selection)
    if (!localController.observableState.selection.has(this.node.id)) {
      localController.queueSelectPaths([this.node.id], e.shiftKey || e.ctrlKey || e.metaKey);
    }

    // Track if a drag actually occurred
    let dragOccurred = false;

    new PointerDragOp(e, this, {
      move: (e, delta) => {
        dragOccurred = true;
        this.style.transform = `translate(${delta[0]}px, ${delta[1]}px)`;
      },
      accept: (e, delta) => this.handleDragAccept(e, delta)
    });
  }

  private handleDragAccept(e: MouseEvent, delta: [number, number]) {
    // Calculate Grid Delta using Metrics (Variable Width/Height)
    const metrics = localController.observableState.gridMetrics;
    const GRID_GAP = 16; // from constants

    // --- Calculate DX ---
    let dx = 0;
    let pixelAccum = 0;
    const targetPixelX = delta[0];

    if (targetPixelX > 0) {
      // Dragging Right
      let col = this.node.x;
      while (true) {
        // Width of current column + Gap
        const width = (metrics.columnWidths.get(col) || 80) + GRID_GAP;
        if (pixelAccum + (width / 2) > targetPixelX) break; // Snap point
        pixelAccum += width;
        dx++;
        col++;
        // Safety break
        if (dx > 50) break;
      }
    } else if (targetPixelX < 0) {
      // Dragging Left
      let col = this.node.x;
      while (true) {
        // Width of PREVIOUS column + Gap (traversing left)
        const prevCol = col - 1;
        const width = (metrics.columnWidths.get(prevCol) || 80) + GRID_GAP;
        if (pixelAccum - (width / 2) < targetPixelX) break; // Snap point (negative)
        pixelAccum -= width;
        dx--;
        col--;
        if (dx < -50) break;
      }
    }

    // --- Calculate DY ---
    let dy = 0;
    pixelAccum = 0;
    const targetPixelY = delta[1];

    if (targetPixelY > 0) {
      // Dragging Down
      let row = this.node.y;
      while (true) {
        const height = (metrics.rows.get(row) || 80) + GRID_GAP;
        if (pixelAccum + (height / 2) > targetPixelY) break;
        pixelAccum += height;
        dy++;
        row++;
        if (dy > 50) break;
      }
    } else if (targetPixelY < 0) {
      // Dragging Up
      let row = this.node.y;
      while (true) {
        const prevRow = row - 1;
        const height = (metrics.rows.get(prevRow) || 80) + GRID_GAP;
        if (pixelAccum - (height / 2) < targetPixelY) break;
        pixelAccum -= height;
        dy--;
        row--;
        if (dy < -50) break;
      }
    }

    const selectedNodeIds = Array.from(localController.observableState.selection.keys())
      .filter(id => id.startsWith('node-'));

    const { dx: constrainedDx, dy: constrainedDy } = appController.calculateConstrainedMove(selectedNodeIds, dx, dy);

    appController.moveNodes(selectedNodeIds, constrainedDx, constrainedDy);

    this.style.transform = '';

    this.dataset.dragged = 'true';
    setTimeout(() => {
      delete this.dataset.dragged;
    }, 0);
  }



  private handleClick(e: MouseEvent) {
    // Check if we clicked on an interactive element (port, input, etc)
    const path = e.composedPath();
    const isInteractive = path.some(el => {
      const element = el as HTMLElement;
      if (!element.classList) return false;
      return element.tagName?.toLowerCase() === 'graph-port' ||
        element.classList.contains('virtual-inputs-container') ||
        element.tagName?.toLowerCase() === 'input' ||
        element.tagName?.toLowerCase() === 'select' ||
        element.tagName?.toLowerCase() === 'smart-input' ||
        element.tagName?.toLowerCase() === 'scalar-slider';
    });

    if (isInteractive) return;

    if (this.dataset.dragged) {
      return;
    }

    // Check if this node is part of the current selection, and if that selection is a group
    const currentSelection = localController.observableState.selection;
    const isSelected = currentSelection.has(this.node.id);
    const nodeSelectionCount = Array.from(currentSelection.keys()).filter(k => k.startsWith('node-')).length;

    if (isSelected && nodeSelectionCount > 1) {
      // We are clicking on a node that is part of a group selection.
      // We want to narrow the selection to just this node (default behavior),
      // BUT we want to remember the group selection for a potential double click.
      localController.setLastGroupSelection(new Set(currentSelection.keys()));
    } else if (e.detail === 1) { // Only clear on single click
      // Clicking a single node or something else: clear the group memory.
      localController.setLastGroupSelection(null);
    }

    localController.queueSelectPaths([this.node.id], e.shiftKey || e.ctrlKey || e.metaKey);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('pointerup', this.handlePointerUp);
    this.addEventListener('click', this.handleClick as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('pointerup', this.handlePointerUp);
    this.removeEventListener('click', this.handleClick as EventListener);
  }

  private handleTypeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    appController.setNodeConfig(this.node.id, { typeId: target.value });
  }

  private handleSmartTypeChange(e: CustomEvent) {
    const typeId = e.detail;

    if (this.typeLongEdit) {
      this.typeLongEdit.applyAgain((c: AppController) => {
        c.setNodeConfig(this.node.id, { typeId });
      });
      this.typeLongEdit.accept();
      this.typeLongEdit = null;
    } else {
      appController.setNodeConfig(this.node.id, { typeId });
    }
  }

  private handleSmartTypePreview(e: CustomEvent) {
    const typeId = e.detail;

    if (!this.typeLongEdit) {
      this.typeLongEdit = appController.beginLongEdit({
        apply: (c: AppController) => {
          c.setNodeConfig(this.node.id, { typeId });
        },
        cancel: () => {
          this.typeLongEdit = null;
        }
      });
    } else {
      this.typeLongEdit.applyAgain((c: AppController) => {
        c.setNodeConfig(this.node.id, { typeId });
      });
    }
  }

  private handleSmartTypeCancel(e: CustomEvent) {
    if (this.typeLongEdit) {
      this.typeLongEdit.cancel();
      this.typeLongEdit = null;
    }
    this.editingField = null;
  }

  private handleNameChange(e: Event) {
    const target = e.target as HTMLInputElement;
    appController.setNodeConfig(this.node.id, { name: target.value });
  }

  /*
   * Handles updates from virtual inputs (sliders/fields).
   *
   * @param e - The event (InputEvent or ChangeEvent).
   * @param portName - The name of the input port.
   *
   * STRATEGY FOR UNDO HISTORY:
   * 1. 'input' Event (Live update):
   *    - Starts or continues a "Long Edit" transaction via `appController.beginLongEdit`.
   *    - Updates the state but does NOT push to undo history stack yet.
   *
   * 2. 'change' Event (Commit):
   *    - Ends the "Long Edit" transaction.
   *    - Pushes the final state to the undo history stack.
   *
   * This prevents dragging a slider from creating hundreds of undo steps.
   */
  private handleVirtualInputChange(e: Event, portName: string) {
    const target = e.target as HTMLInputElement;
    const value = parseFloatOr(target.value) ?? 0;

    if (e.type === 'input') {
      if (!this.sliderLongEdit || this.activeSliderPort !== portName) {
        if (this.sliderLongEdit) this.sliderLongEdit.cancel(); // Cancel previous if switching ports (unlikely)

        this.activeSliderPort = portName;
        this.sliderLongEdit = appController.beginLongEdit({
          apply: (c: AppController) => {
            const latestNode = c.getState().graph.inner.nodes[this.node.id];
            if (!latestNode) return;
            c.setNodeConfig(this.node.id, { values: { ...(latestNode.config.values || {}), [portName]: value } });
          },
          cancel: () => {
            this.sliderLongEdit = null;
            this.activeSliderPort = null;
          }
        });
      } else {
        this.sliderLongEdit.applyAgain((c: AppController) => {
          const latestNode = c.getState().graph.inner.nodes[this.node.id];
          if (!latestNode) return;
          c.setNodeConfig(this.node.id, { values: { ...(latestNode.config.values || {}), [portName]: value } });
        });
      }
    } else if (e.type === 'change') {
      // Commit
      if (this.sliderLongEdit) {
        this.sliderLongEdit.accept();
        this.sliderLongEdit = null;
        this.activeSliderPort = null;
      } else {
        // Direct set if no long edit active (e.g. clicked, not dragged)
        const latestNode = appController.getState().graph.inner.nodes[this.node.id];
        if (latestNode) {
          appController.setNodeConfig(this.node.id, { values: { ...(latestNode.config.values || {}), [portName]: value } });
        }
      }
    }
  }

  private handleDoubleClick(field: 'name' | 'type', e: MouseEvent) {
    e.stopPropagation();
    this.editingField = field;
  }

  private handleEditCommit(field: 'name' | 'type', e: CustomEvent) {
    const value = e.detail;
    if (field === 'name') {
      appController.setNodeConfig(this.node.id, { name: value });
    } else {
      appController.setNodeConfig(this.node.id, { typeId: value });
    }
    this.editingField = null;
  }

  private handleEditCancel() {
    this.editingField = null;
  }

  renderInspectorContent() {
    const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
    const onchange = (config: object) => appController.setNodeConfig(this.node.id, config);

    return html`
      <h3>Inspector</h3>
      <div class="field">
        <label>Name:</label>
        <input type="text" .value=${this.node.config.name || ''} @change=${this.handleNameChange.bind(this)} />
      </div>
      <div class="field">
        <label>Type:</label>
        <smart-input
            .catalog=${this.catalog}
            .value=${this.node.config.typeId}
            @commit=${this.handleSmartTypeChange.bind(this)}
            @preview-type=${this.handleSmartTypePreview.bind(this)}
            @cancel=${this.handleSmartTypeCancel.bind(this)}
        ></smart-input>
      </div>
      ${nodeType?.renderInspector ? nodeType.renderInspector(this.node, onchange) : ''}
    `;
  }



  private currentTypeId: string | null = null;

  private async loadUI() {
    const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
    if (!nodeType || !nodeType.ui) return;

    if (nodeType.ui.body && !this.loadedBodyRenderer && !this.hasRequestedBodyLoad) {
      this.hasRequestedBodyLoad = true;
      try {
        const renderer = await nodeType.ui.body();
        this.loadedBodyRenderer = renderer;
        // Cache it on the nodeType so we don't reload for every instance?
        // Ideally yes, but for now per-instance state is safer for HMR.
        // Actually, we should cache it on the nodeType to avoid re-fetching.
        if (!nodeType.renderBody) {
          nodeType.renderBody = renderer;
        }
      } catch (e) {
        console.error('Failed to load body renderer', e);
      }
    }

    if (nodeType.ui.body && !this.loadedBodyRenderer && !this.hasRequestedBodyLoad) {
      this.hasRequestedBodyLoad = true;
      try {
        const renderer = await nodeType.ui.body();
        this.loadedBodyRenderer = renderer;
        if (!nodeType.renderBody) {
          nodeType.renderBody = renderer;
        }
      } catch (e) {
        console.error('Failed to load body renderer', e);
      }
    }

    if (nodeType.ui.getBodyHeight && !nodeType.getBodyHeight) {
      try {
        const getter = await nodeType.ui.getBodyHeight();
        nodeType.getBodyHeight = getter;
      } catch (e) {
        console.error('Failed to load getBodyHeight', e);
      }
    }

    if (nodeType.ui.inspector && !this.loadedInspectorRenderer && !this.hasRequestedInspectorLoad) {
      this.hasRequestedInspectorLoad = true;
      try {
        if (typeof nodeType.ui.inspector === 'function') {
          const renderer = await nodeType.ui.inspector();
          this.loadedInspectorRenderer = renderer;
          if (!nodeType.renderInspector) {
            nodeType.renderInspector = renderer;
          }
        } else {
          // It's a GenericInspector config object
          const { createGenericInspector } = await import('./inspector/generic-inspector');
          const inspectorConfig = nodeType.ui.inspector as any;
          const renderer = createGenericInspector(inspectorConfig.fields);
          this.loadedInspectorRenderer = renderer;
          if (!nodeType.renderInspector) {
            nodeType.renderInspector = renderer;
          }
        }
      } catch (e) {
        console.error('Failed to load inspector renderer', e);
      }
    }

    // Input editor loading...
    if (nodeType.ui.inputEditor && !this.loadedInputEditorRenderer && !this.hasRequestedInputEditorLoad) {
      this.hasRequestedInputEditorLoad = true;
      try {
        const renderer = await nodeType.ui.inputEditor();
        this.loadedInputEditorRenderer = renderer;
        if (!nodeType.renderInputEditor) {
          nodeType.renderInputEditor = renderer;
        }
        if (nodeType.ui.getInputEditorHeight) {
          const heightFn = await nodeType.ui.getInputEditorHeight();
          if (!nodeType.getInputEditorHeight) {
            nodeType.getInputEditorHeight = heightFn;
          }
        }
      } catch (e) {
        console.error('Failed to load input editor renderer', e);
      }
    }

    this.requestUpdate();
  }


  updated(changedProperties: Map<string, any>) {
    if (this.node && this.node.config.typeId !== this.currentTypeId) {
      this.currentTypeId = this.node.config.typeId;

      // Reset loaded renderers
      this.loadedBodyRenderer = null;
      this.loadedInspectorRenderer = null;
      this.loadedInputEditorRenderer = null;
      this.hasRequestedBodyLoad = false;
      this.hasRequestedInspectorLoad = false;
      this.hasRequestedInputEditorLoad = false;

      this.loadUI();
    }

    if (this.node) {
      this.dataset.id = this.node.id;

      // Re-calculate state for host attribute
      // Re-calculate state for host attribute
      const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
      const effectiveType = localController.observableState.effectiveNodeTypes.get(this.node.id);

      let inputs: PortHint[] = [];
      let outputs: PortHint[] = [];

      if (effectiveType) {
        inputs = effectiveType.inputs;
        outputs = effectiveType.outputs;
      } else if (nodeType) {
        inputs = [...(nodeType.inputs || [])];
        outputs = [...(nodeType.outputs || [])];
      }

      // Use passed property or fallback to store (though prop should be primary)
      const incomingConnections = this.incomingConnections || appController.observableState.graph.auxiliary.incomingConnections.get(this.node.id) || [];

      const connectedPorts = new Set(incomingConnections.map(connId => {
        const conn = appController.observableState.graph.inner.connections[connId];
        return conn ? conn.toPort : null;
      }).filter(port => port !== null));

      const hasCustomBody = !!(nodeType?.renderBody || this.loadedBodyRenderer);

      let state = 'normal';
      // Use shared utility
      // connectedPorts is Set<string> effectively
      state = getNodeVisualState(inputs, outputs, connectedPorts as Set<string>, hasCustomBody);


      this.dataset.state = state;

      // Compute Height
      // Constants imported from ../constants

      let totalInputHeight = 0;
      inputs.forEach(input => {
        const isConnected = connectedPorts.has(input.name);
        let height = ROW_HEIGHT;
        if (shouldShowInputEditor(input, isConnected)) {
          const customHeight = nodeType?.getInputEditorHeight?.(this.node, input.name);
          if (customHeight) {
            height = Math.max(ROW_HEIGHT, customHeight);
          }
        }
        totalInputHeight += height;
      });

      const totalOutputHeight = outputs.length * ROW_HEIGHT;
      const bodyHeight = nodeType?.getBodyHeight?.(this.node) || 0;

      // Ensure at least one row height if no ports
      const portsHeight = Math.max(totalInputHeight, totalOutputHeight, ROW_HEIGHT);

      let computedHeight = HEADER_HEIGHT + portsHeight + NODE_PADDING_Y + bodyHeight;

      // For minimal state, force 80px
      if (state === 'minimal') {
        computedHeight = 80;
      }

      this.style.height = `${computedHeight}px`;

      // If nodeType is missing, it might be loaded later. Retry update.
      if (!nodeType) {
        setTimeout(() => this.requestUpdate(), 200);
      }
    }
  }

  render() {
    const { selection, inflightPortConnectionOperation, queuedSelection } = localController.observableState;
    const isSelected = selection.has(this.node.id);

    if (this.isQueued) {
      // It will be promoted in defineSelectable called below
    }

    const connectingPort = inflightPortConnectionOperation && inflightPortConnectionOperation.nodeId === this.node.id ? inflightPortConnectionOperation : null;

    this.toggleAttribute('selected', isSelected);

    localController.defineSelectable({
      path: this.node.id,
      renderInspectorContent: () => this.renderInspectorContent()
    });

    const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
    const effectiveType = localController.observableState.effectiveNodeTypes.get(this.node.id);

    let inputs: PortHint[] = [];
    let outputs: PortHint[] = [];
    let displayName = this.node.config.typeId;

    if (effectiveType) {
      inputs = effectiveType.inputs;
      outputs = effectiveType.outputs;
      displayName = nodeType?.displayName || this.node.config.typeId;
    } else if (nodeType) {
      inputs = [...(nodeType.inputs || [])];
      outputs = [...(nodeType.outputs || [])];
      displayName = nodeType.displayName || this.node.config.typeId;
    }

    // Get current incoming connections to this node
    const incomingConnections = appController.observableState.graph.auxiliary.incomingConnections.get(this.node.id) || [];
    const connectedPorts = new Set(incomingConnections.map(connId => {
      const conn = appController.observableState.graph.inner.connections[connId];
      return conn ? conn.toPort : null;
    }).filter(port => port !== null));

    const isQueued = this.isQueued;
    const typeColor = cssColorFromHash(this.node.config.typeId);

    // Determine State (Logic duplicated from updated() for render consistency)
    const hasCustomBody = !!(nodeType?.renderBody || this.loadedBodyRenderer);
    const state = getNodeVisualState(inputs, outputs, connectedPorts as Set<string>, hasCustomBody);

    // Reflect state to host for styling
    this.dataset.state = state;

    // Compute Layout
    // Constants imported from ../constants

    let currentInputY = HEADER_HEIGHT;
    const inputElements: any[] = [];
    const virtualInputElements: any[] = [];



    inputs.forEach((input, index) => {
      const isConnected = connectedPorts.has(input.name);
      let height = ROW_HEIGHT;

      // Render Port
      inputElements.push(html`
        <div class="port-wrapper" style="top: ${currentInputY}px; position: absolute; left: 0; height: ${ROW_HEIGHT}px;">
          <graph-port
            .nodeId=${this.node.id}
            .name=${input.name}
            type="in"
            .description=${input.description || ''}
            ?hideLabel="${this.shouldHideLabel(input.name, 'in', outputs, inputs, connectedPorts)}"
          ></graph-port>
        </div>
      `);

      // Render Editor (if disconnected)
      if (shouldShowInputEditor(input, isConnected)) {
        const customHeight = nodeType?.getInputEditorHeight?.(this.node, input.name);
        if (customHeight) {
          height = Math.max(ROW_HEIGHT, customHeight);
        }

        let editorContent;
        if (nodeType?.renderInputEditor) {
          editorContent = nodeType.renderInputEditor(this.node, input.name, { handleVirtualInputChange: this.handleVirtualInputChange.bind(this) });
        }

        // Fallback to default editor if no custom editor or it returned nothing
        if (!editorContent) {
          let configValue = this.node.config.values && this.node.config.values[input.name];

          // Fallback: Check top-level config for legacy/misconfigured nodes (e.g. data.float might have 'value' at top level)
          if (configValue === undefined && (this.node.config as any)[input.name] !== undefined) {
            configValue = (this.node.config as any)[input.name];
          }

          const currentValue = configValue !== undefined
            ? configValue
            : (input.defaultValue !== undefined ? input.defaultValue : ((input.type as any).defaultValue !== undefined ? (input.type as any).defaultValue : ''));

          // Always show default editor if no custom editor is provided
          const isNumber = input.type.kind === 'atomic' && input.type.type === 'number';

          // Find corresponding output name for the right label
          const outputName = outputs[index]?.name || '';

          // Note: Order matters. `.value` must be last, otherwise it will get the wrong
          // min, max, and step clamping and quantization applied.
          editorContent = html`
                <div class="virtual-input-field-wrapper" style="height: var(--row-height);">
                  <div class="slider-label" title="${input.name}">${input.name}</div>
                  ${isNumber ? html`
                          <scalar-slider
                            .min=${input.range?.[0] ?? 0}
                            .max=${input.range?.[1] ?? 1}
                            .step=${input.step ?? (input.range ? (input.range[1] - input.range[0]) / 100 : 0.01)}
                            .value=${currentValue}
                            .defaultValue=${input.defaultValue ?? Math.max(input.range?.[0] ?? 0, Math.min(input.range?.[1] ?? 1, 0))}
                            @input=${(e: CustomEvent) => this.handleVirtualInputChange(e, input.name)}
                            @change=${(e: CustomEvent) => this.handleVirtualInputChange(e, input.name)}
                            id="${this.node.id}-${input.name}-virtual-input"
                            class="virtual-input-field"
                            title="${input.description}"
                          ></scalar-slider>
                        `
              : (input.type.kind === 'atomic' && input.type.type === 'string') ? html`
                          <input
                            id="${this.node.id}-${input.name}-virtual-input"
                            type="text"
                            .value=${currentValue.toString()}
                            @input=${(e: Event) => this.handleVirtualInputChange(e, input.name)}
                            @change=${(e: Event) => this.handleVirtualInputChange(e, input.name)}
                            class="virtual-input-field"
                            title="${input.description}"
                          />
                        ` : html`
                          <div class="virtual-input-field" style="color: var(--text-muted); font-size: 10px; padding: 0 5px;">
                            ${(input.type as any).hint || (input.type.kind === 'atomic' ? input.type.type : input.type.kind)}
                          </div>
                        `}
                    <div class="slider-label" title="${outputName}">${outputName}</div>
                  </div>
          `;
        }

        if (editorContent) {
          virtualInputElements.push(html`
            <div style="top: ${currentInputY}px; position: absolute; width: 100%; height: ${height}px; display: flex; align-items: center;">
              ${editorContent}
            </div>
          `);
        }
      }

      currentInputY += height;
    });

    const style = `transform: translate(0, 0); width: 100%; height: 100%; --node-accent-color: ${typeColor};`;

    return html`
      <div
        class="node ${isSelected ? 'selected' : ''} ${isQueued ? 'queued' : ''}"
        style="${style}"
        data-state="${state}"
      >
        <div class="ports-wrapper">
          <div class="inputs">
            ${inputElements}
          </div>
          <div class="outputs">
            ${this.renderOutputs(outputs, inputs, connectedPorts)}
          </div>
        </div>
        <div class="node-main-content">
          <div class="node-title ${this.editingField ? 'editing' : ''}">
            <div class="editable-label-wrapper name ${this.editingField === 'name' ? 'editing' : ''}">
              <span
                @dblclick=${(e: MouseEvent) => this.handleDoubleClick('name', e)}
                style="display: block; overflow: hidden; text-overflow: ellipsis; visibility: ${this.editingField === 'name' ? 'hidden' : 'visible'};"
              >
                ${this.node.config.name || displayName}
              </span>
              ${this.editingField === 'name' ? html`
                <smart-input
                  .value=${this.node.config.name || displayName}
                  .autofocus=${true}
                  @commit=${(e: CustomEvent) => this.handleEditCommit('name', e)}
                  @cancel=${this.handleEditCancel}
                  style="position: absolute; top: -6px; left: -8px; min-width: 150px; min-height: 24px; width: calc(100% + 8px); height: calc(100% + 4px); z-index: 100;"
                ></smart-input>
              ` : ''}
            </div>

            <div class="editable-label-wrapper type ${this.editingField === 'type' ? 'editing' : ''}">
              <span
                class="node-type-id"
                @dblclick=${(e: MouseEvent) => this.handleDoubleClick('type', e)}
                style="visibility: ${this.editingField === 'type' ? 'hidden' : 'visible'};"
              >
                ${this.node.config.typeId}
              </span>
              ${this.editingField === 'type' ? html`
                <smart-input
                  .catalog=${this.catalog}
                  .value=${this.node.config.typeId}
                  .autofocus=${true}
                  @commit=${(e: CustomEvent) => this.handleEditCommit('type', e)}
                  @preview-type=${this.handleSmartTypePreview.bind(this)}
                  @cancel=${this.handleEditCancel}
                  style="position: absolute; top: -6px; left: -8px; min-width: 150px; min-height: 24px; width: calc(100% + 8px); height: calc(100% + 4px); z-index: 100;"
                ></smart-input>
              ` : ''}
            </div>
          </div>
          <div class="virtual-inputs-container">
            ${virtualInputElements}
            <div style="top: ${currentInputY}px; position: absolute; width: 100%; height: ${nodeType?.getBodyHeight?.(this.node) || 0}px; pointer-events: auto; touch-action: none;">
              ${nodeType?.renderBody?.(this.node, { handleVirtualInputChange: this.handleVirtualInputChange.bind(this) }) || ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderOutputs(outputs: PortHint[], inputs: PortHint[], connectedPorts: Set<any>) {
    return outputs.map((output, index) => {
      return html`
            <div class="port-wrapper" style="top: ${HEADER_HEIGHT + index * ROW_HEIGHT}px; position: absolute; right: 0;">
              ${this.renderDebugValue(output.name)}
              <graph-port
                .nodeId=${this.node.id}
                .name=${output.name}
                type="out"
                .description=${output.description || ''}
                ?hideLabel="${this.shouldHideLabel(output.name, 'out', outputs, inputs, connectedPorts)}"
              ></graph-port>
            </div>
          `;
    });
  }

  private shouldHideLabel(portName: string, type: 'in' | 'out', outputs: PortHint[], inputs: PortHint[], connectedPorts: Set<any>): boolean {
    if (type === 'in') {
      const input = inputs.find(i => i.name === portName);
      if (input) {
        if (input.suppressLabel) return true;
        const isConnected = connectedPorts.has(input.name);
        if (shouldShowInputEditor(input, isConnected)) {
          // If we are showing an editor, we hide the label
          return true;
        }
      }
    }

    if (type === 'out') {
      const output = outputs.find(o => o.name === portName);
      if (output && output.suppressLabel) return true;

      const outputIndex = outputs.findIndex(o => o.name === portName);
      if (outputIndex !== -1 && outputIndex < inputs.length) {
        const input = inputs[outputIndex];
        const isConnected = connectedPorts.has(input.name);
        if (shouldShowInputEditor(input, isConnected)) {
          // Corresponding input has an editor, so hide output label too
          return true;
        }
      }
    }
    return false;
  }
}

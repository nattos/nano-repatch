import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { reaction } from 'mobx';
import { GridNode } from '../builder/state';
import { appController, localController, runtimeManager } from '../builder/controllers';
import { cssColorFromHash } from '../utils/layout-utils';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { defaultNodeRepository, PortHint } from '../structor/repository'; // Import repository
import { parseFloatOr } from '../utils/utils';
import '../components/smart-input';
import { NodeCatalog } from '../structor/node-catalog';
import './graph-port';


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

  @property({ type: Boolean })
  isQueued = false;

  @property({ type: Number })
  x = 0;

  @property({ type: Number })
  y = 0;

  private catalog = new NodeCatalog(defaultNodeRepository);

  @state()
  private editingField: 'name' | 'type' | null = null;



  static readonly styles = css`
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
      align-self: center;
      /* padding: 10px; Removed padding to allow full control of node size */
      transition: width 0.2s, height 0.2s, border-radius 0.2s;
    }



    :host([data-state="normal"]) {
      width: 240px;
    }

    :host([data-state="compressed"]) {
      width: 100px;
    }

    :host([data-state="minimal"]) {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      min-height: 80px;
    }

    :host([data-state="minimal"]) .node {
      border-radius: 50%;
    }

    :host([data-state="minimal"]) .node-title {
      font-size: 0.7em;
      text-align: center;
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node {
      position: absolute;
      background: var(--bg-color);
      border-radius: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      /* overflow: hidden; */
      user-select: none;
      border: 1px solid var(--node-border);
      border-left: 4px solid var(--node-accent-color, var(--node-border));
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
      overflow: hidden;
      padding: 0 17px; /* Align with port labels */
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
    }

    .inputs {
      align-items: flex-start;
      position: relative;
      left: -9px; /* Move pips out to hang off node */
      top: 2px; /* Adjust vertical alignment */
    }

    .outputs {
      align-items: flex-end;
      position: relative;
      right: -9px; /* Move pips out */
      top: 2px; /* Adjust vertical alignment */
    }

    .virtual-inputs-container {
      position: absolute;
      top: 0;
      left: 6px;
      width: 220px;
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
      height: 24px; /* Match port height */
      justify-content: space-between;
      pointer-events: auto;
    }

    .slider-label {
      width: 38px;
      font-size: 0.7em;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }

    .slider-label:first-child {
      text-align: left;
      padding-left: 5px;
    }

    .slider-label:last-child {
      text-align: left;
      padding-left: 4px;
    }

    .virtual-input-field {
      flex-grow: 1; /* Fill remaining space */
      width: auto; /* Let flex handle width */
      padding: 0;
      margin: 0 5px;
      height: 16px; /* Standard slider height */
      /* border-radius: 3px; */
      /* border: 1px solid var(--border-color); */
      /* background-color: var(--input-bg); */
      /* color: var(--text-color); */
      /* font-size: 0.8em; */
      /* box-sizing: border-box; */
      cursor: pointer;
    }




    .debug-chip {
      position: absolute;
      left: 100%; /* Position to the right of the port (outside) */
      margin-left: 8px;
      background: rgba(0, 0, 0, 0.7);
      color: #ddd;
      padding: 1px 4px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      pointer-events: none;
      white-space: nowrap;
      z-index: 10;
      border: 1px solid #444;
    }

    .debug-chip.vector {
      color: #8dc1e3;
      border-color: #3a5f7a;
      background: rgba(42, 63, 74, 0.8);
    }

    .debug-chip.struct {
      color: #c18de3;
      border-color: #5f3a7a;
      background: rgba(58, 42, 74, 0.8);
    }
  `;

  private renderDebugValue(portName: string) {
    if (!localController.observableState.showDebugValues) return null;

    const output = runtimeManager.outputs.get(this.node.id);
    if (!output) return null;

    let value: any = undefined;

    // Check fields first
    if (output.fields && portName in output.fields) {
      value = output.fields[portName];
    }
    // Then check untagged if it's the default output (empty string name)
    else if (portName === '' && output.untagged && output.untagged.length > 0) {
      value = output.untagged[0];
    }

    if (value === undefined) return null;

    let displayValue = '';
    let isStruct = false;
    let isVector = false;

    if (typeof value === 'number') {
      displayValue = value.toFixed(2);
    } else if (typeof value === 'string') {
      displayValue = `"${value.length > 10 ? value.substring(0, 8) + '..' : value}"`;
    } else if (Array.isArray(value)) {
      displayValue = `vec(${value.length})`;
      isVector = true;
    } else if (typeof value === 'object' && value !== null) {
      displayValue = 'struct';
      isStruct = true;
    } else {
      displayValue = String(value);
    }

    const classes = ['debug-chip'];
    if (isVector) classes.push('vector');
    if (isStruct) classes.push('struct');

    return html`<div class="${classes.join(' ')}">${displayValue}</div>`;
  }

  private handlePointerDown(e: PointerEvent) {
    // Ignore if clicking on a port or virtual input field
    // We need to check composed path because the target might be inside the shadow DOM of the input
    const path = e.composedPath();
    const isInput = path.some(el => (el as HTMLElement).classList?.contains('virtual-input-field'));
    const isPort = path.some(el => (el as HTMLElement).tagName?.toLowerCase() === 'graph-port');

    if (isInput || isPort) {
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
      accept: (e, delta) => {
        let dx = Math.round(delta[0] / 110);
        let dy = Math.round(delta[1] / 110);

        const selectedNodeIds = Array.from(localController.observableState.selection.keys())
          .filter(id => id.startsWith('node-'));

        const { dx: constrainedDx, dy: constrainedDy } = appController.calculateConstrainedMove(selectedNodeIds, dx, dy);

        appController.moveNodes(selectedNodeIds, constrainedDx, constrainedDy);

        this.style.transform = '';
      },
      cancel: () => {
        this.style.transform = '';
      },
      complete: () => {
        // If drag occurred, we set a flag on the element to prevent the click handler
        // from changing selection.
        if (dragOccurred) {
          this.dataset.dragged = 'true';
          // Clear the flag after a short timeout to allow the click event to process (and ignore)
          setTimeout(() => {
            delete this.dataset.dragged;
          }, 0);
        }
      }
    });
  }


  private handleClick(e: MouseEvent) {
    if (this.dataset.dragged) {
      return;
    }
    localController.queueSelectPaths([this.node.id], e.shiftKey || e.ctrlKey || e.metaKey);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('click', this.handleClick as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('click', this.handleClick as EventListener);
  }

  private handleTypeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    appController.setNodeConfig(this.node.id, { typeId: target.value });
  }

  private handleSmartTypeChange(e: CustomEvent) {
    const typeId = e.detail;
    appController.setNodeConfig(this.node.id, { typeId });
  }

  private handleNameChange(e: Event) {
    const target = e.target as HTMLInputElement;
    appController.setNodeConfig(this.node.id, { name: target.value });
  }

  private handleVirtualInputChange(e: Event, portName: string) {
    const target = e.target as HTMLInputElement;
    const value = parseFloatOr(target.value) ?? 0;
    // Store virtual input values in a dedicated 'values' config object
    appController.setNodeConfig(this.node.id, { values: { ...(this.node.config.values || {}), [portName]: value } });
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
        ></smart-input>
      </div>
      ${nodeType?.renderInspector ? nodeType.renderInspector(this.node, onchange) : ''}
    `;
  }

  updated() {
    if (this.node) {
      this.dataset.id = this.node.id;

      // Re-calculate state for host attribute
      const nodeType = defaultNodeRepository.getNodeType(this.node.config.typeId);
      let inputs: PortHint[] = [];
      let outputs: PortHint[] = [];

      if (nodeType) {
        const dynamicInfo = nodeType.getPorts?.(this.node, localController.observableState.loadedSubgraphs);
        if (dynamicInfo) {
          inputs = dynamicInfo.inputs;
          outputs = dynamicInfo.outputs;
        } else {
          inputs = nodeType.inputs || [];
          outputs = nodeType.outputs || [];
        }
      }

      const incomingConnections = appController.observableState.graph.auxiliary.incomingConnections.get(this.node.id) || [];
      const connectedPorts = new Set(incomingConnections.map(connId => {
        const conn = appController.observableState.graph.inner.connections[connId];
        return conn ? conn.toPort : null;
      }).filter(port => port !== null));

      let hasVisibleSliders = false;
      inputs.forEach(input => {
        const isConnected = connectedPorts.has(input.name);
        if (!isConnected) {
          hasVisibleSliders = true;
        }
      });

      let state = 'normal';
      if (!hasVisibleSliders) {
        if (inputs.length <= 1 && outputs.length <= 1) {
          state = 'minimal';
        } else if (inputs.length <= 3 && outputs.length <= 3) {
          state = 'compressed';
        }
      }

      this.dataset.state = state;

      // Compute Height
      const ROW_HEIGHT = 24;
      const HEADER_HEIGHT = 25;
      const PADDING = 7;

      let totalInputHeight = 0;
      inputs.forEach(input => {
        const isConnected = connectedPorts.has(input.name);
        let height = ROW_HEIGHT;
        if (!isConnected) {
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

      let computedHeight = HEADER_HEIGHT + portsHeight + PADDING + bodyHeight;

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
    let inputs: PortHint[] = [];
    let outputs: PortHint[] = [];
    let displayName = this.node.config.typeId;

    if (nodeType) {
      const dynamicInfo = nodeType.getPorts?.(this.node, localController.observableState.loadedSubgraphs);
      if (dynamicInfo) {
        inputs = dynamicInfo.inputs;
        outputs = dynamicInfo.outputs;
        displayName = dynamicInfo.displayName || nodeType.displayName;
      } else {
        inputs = nodeType.inputs || [];
        outputs = nodeType.outputs || [];
        displayName = nodeType.displayName;
      }
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
    let hasVisibleSliders = false;
    inputs.forEach(input => {
      const isConnected = connectedPorts.has(input.name);
      if (!isConnected) {
        hasVisibleSliders = true;
      }
    });

    let state = 'normal';
    if (!hasVisibleSliders) {
      if (inputs.length <= 1 && outputs.length <= 1) {
        state = 'minimal';
      } else if (inputs.length <= 3 && outputs.length <= 3) {
        state = 'compressed';
      }
    }

    // Compute Layout
    const ROW_HEIGHT = 24;
    const HEADER_HEIGHT = 25;

    let currentInputY = HEADER_HEIGHT;
    const inputElements: any[] = [];
    const virtualInputElements: any[] = [];

    // Helper to check if a port label should be hidden
    const shouldHideLabel = (portName: string, type: 'in' | 'out') => {
      // If it's an input and has a custom editor (or default slider), hide the label
      // because the editor will render it.
      if (type === 'in') {
        const input = inputs.find(i => i.name === portName);
        if (input) {
          const isConnected = connectedPorts.has(input.name);
          if (!isConnected) {
            // If disconnected, we show an editor.
            // For now, assume ALL editors want to hide labels if they are active.
            return true;
          }
        }
      }

      // If it's an output, check if the corresponding input (same row) has an editor
      if (type === 'out') {
        const outputIndex = outputs.findIndex(o => o.name === portName);
        if (outputIndex !== -1 && outputIndex < inputs.length) {
          const input = inputs[outputIndex];
          const isConnected = connectedPorts.has(input.name);
          if (!isConnected) {
            // Corresponding input has an editor, so hide output label too
            return true;
          }
        }
      }
      return false;
    };

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
            ?hideLabel="${shouldHideLabel(input.name, 'in')}"
          ></graph-port>
        </div>
      `);

      // Render Editor (if disconnected)
      if (!isConnected) {
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
          const currentValue = (this.node.config.values && this.node.config.values[input.name]) !== undefined
            ? this.node.config.values[input.name]
            : input.defaultValue || '';

          // Always show default editor if no custom editor is provided
          const isNumber = input.type.kind === 'atomic' && input.type.type === 'number';

          // Find corresponding output name for the right label
          const outputName = outputs[index]?.name || '';

          editorContent = html`
                <div class="virtual-input-field-wrapper" style="height: 24px;">
                  <div class="slider-label" title="${input.name}">${input.name}</div>
                  <input
                    id="${this.node.id}-${input.name}-virtual-input"
                    type="${isNumber ? 'range' : 'text'}"
                    .value=${currentValue.toString()}
                    .min=${input.range?.[0]?.toString() || '0'}
                    .max=${input.range?.[1]?.toString() || '1'}
                    .step=${isNumber && input.range ? ((input.range[1] - input.range[0]) / 100).toString() : '0.01'}
                    @input=${(e: Event) => this.handleVirtualInputChange(e, input.name)}
                    class="virtual-input-field"
                    title="${input.description}"
                  />
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
            ${outputs.map((output, index) => {
      return html`
                <div class="port-wrapper" style="top: ${HEADER_HEIGHT + index * ROW_HEIGHT}px; position: absolute; right: 0;">
                  ${this.renderDebugValue(output.name)}
                  <graph-port
                    .nodeId=${this.node.id}
                    .name=${output.name}
                    type="out"
                    .description=${output.description || ''}
                    ?hideLabel="${shouldHideLabel(output.name, 'out')}"
                  ></graph-port>
                </div>
              `;
    })}
          </div>
        </div>
        <div class="node-main-content">
          <div class="node-title">
            ${this.editingField === 'name'
        ? html`
                <smart-input
                  .value=${this.node.config.name || displayName}
                  .autofocus=${true}
                  @commit=${(e: CustomEvent) => this.handleEditCommit('name', e)}
                  @cancel=${this.handleEditCancel}
                  style="flex-grow: 1;"
                ></smart-input>
              `
        : html`
                <span @dblclick=${(e: MouseEvent) => this.handleDoubleClick('name', e)} style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis;">
                  ${this.node.config.name || displayName}
                </span>
              `
      }
            ${this.editingField === 'type'
        ? html`
                <smart-input
                  .catalog=${this.catalog}
                  .value=${this.node.config.typeId}
                  .autofocus=${true}
                  @commit=${(e: CustomEvent) => this.handleEditCommit('type', e)}
                  @cancel=${this.handleEditCancel}
                  style="min-width: 100px;"
                ></smart-input>
              `
        : html`
                <span class="node-type-id" @dblclick=${(e: MouseEvent) => this.handleDoubleClick('type', e)}>
                  ${this.node.config.typeId}
                </span>
              `
      }
          </div>
          <div class="virtual-inputs-container">
            ${virtualInputElements}
            ${nodeType?.renderBody?.(this.node, { handleVirtualInputChange: this.handleVirtualInputChange.bind(this) }) || ''}
          </div>
        </div>
      </div>
    `;
  }
}

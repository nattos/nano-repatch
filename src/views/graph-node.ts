import { MobxLitElement } from './mobx-lit-element';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { reaction } from 'mobx';
import { GridNode } from '../builder/state';
import { appController, localController } from '../builder/controllers';
import { PointerDragOp } from '../utils/pointer-drag-op';
import { defaultNodeRepository, PortHint } from '../structor/repository'; // Import repository
import { parseFloatOr } from '../utils/utils';

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

  @state()
  private isHoveringPort: string | null = null;

  static readonly styles = css`
    :host {
      display: flex;
      flex-direction: column;
      background-color: #333;
      border-radius: 10px;
      width: 120px; /* Adjusted width */
      min-height: 80px;
      color: white;
      cursor: grab;
      position: relative;
      border: 2px solid transparent;
      transition: border-color 0.2s;
      box-sizing: border-box;
      padding: 10px; /* Added padding for internal content */
    }

    :host([selected]) {
      border-color: #00aaff;
      box-shadow: 0 0 10px rgba(0, 170, 255, 0.5);
    }

    .node-main-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 5px 0;
    }

    .node-title {
      font-weight: bold;
      margin-bottom: 5px;
      text-align: center;
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
    }

    .inputs, .outputs {
      display: flex;
      flex-direction: column;
      justify-content: space-around; /* Distribute ports evenly */
      padding: 5px 0;
      pointer-events: all; /* Re-enable pointer events for ports */
    }

    .inputs {
      align-items: flex-start;
      margin-left: -15px; /* Move outside */
    }

    .outputs {
      align-items: flex-end;
      margin-right: -15px; /* Move outside */
    }

    .port-wrapper {
      display: flex;
      align-items: center;
      height: 20px; /* Fixed height for port row */
    }

    .port {
      width: 15px;
      height: 15px;
      background-color: #555;
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.2s;
      z-index: 10; /* Ensure ports are above other elements */
    }

    .port:hover {
      background-color: #777;
      transform: scale(1.2);
    }

    .port.connecting {
      background-color: #00ff00;
      box-shadow: 0 0 5px #00ff00;
    }

    .port-label {
      font-size: 0.7em;
      white-space: nowrap;
      color: #ccc;
      margin: 0 5px;
    }

    .virtual-inputs-container {
      margin-top: 10px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .virtual-input-field-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      width: 100%;
    }

    .virtual-input-field-wrapper label {
      font-size: 0.7em;
      color: #ccc;
      margin-bottom: 2px;
    }

    .virtual-input-field {
      width: calc(100% - 10px); /* Account for padding */
      padding: 3px;
      border-radius: 3px;
      border: 1px solid #555;
      background-color: #444;
      color: white;
      font-size: 0.8em;
    }
  `;

  private handlePointerDown(e: PointerEvent) {
    // Ignore if clicking on a port or virtual input field
    // We need to check composed path because the target might be inside the shadow DOM of the input
    const path = e.composedPath();
    const isInput = path.some(el => (el as HTMLElement).classList?.contains('virtual-input-field'));
    const isPort = path.some(el => (el as HTMLElement).classList?.contains('port'));

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

        // Check for pinned nodes in selection
        const state = appController.getState();
        const hasPinned = selectedNodeIds.some(id => {
          const n = state.graph.inner.nodes[id];
          return n && (n.config.typeId === 'input' || n.config.typeId === 'output');
        });

        if (hasPinned) {
          dx = 0; // Lock X axis for pinned nodes
        }

        // Prevent moving normal nodes into pinned area (x < 1)
        // This is harder to check for all nodes efficiently without iterating.
        // But we can check the current node.
        if (!hasPinned && this.node.x + dx < 1) {
          dx = 1 - this.node.x;
        }

        appController.moveNodes(selectedNodeIds, dx, dy);

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

  private handlePortClick(e: MouseEvent) {
    e.stopPropagation(); // Prevent node drag from starting
    const target = e.target as HTMLElement;
    const port = target.dataset.port!;
    const type = target.dataset.type as 'in' | 'out';

    const currentInflightOp = localController.observableState.inflightPortConnectionOperation;

    if (!currentInflightOp) {
      // Start connection
      localController.setInflightPortConnectionOperation({ nodeId: this.node.id, port, type });

      // Select the port to allow cancellation
      const portPath = `port://${this.node.id}/${type}/${port}`;
      const handle = localController.defineSelectable({
        path: portPath,
      });
      handle.select();

      // Watch for deselection to cancel
      const disposer = reaction(
        () => localController.observableState.selection.has(portPath),
        (isSelected) => {
          if (!isSelected) {
            // If we are no longer selected, and the operation is still inflight matching this port, cancel it.
            const current = localController.observableState.inflightPortConnectionOperation;
            if (current && current.nodeId === this.node.id && current.port === port && current.type === type) {
              localController.setInflightPortConnectionOperation(null);
            }
            disposer();
          }
        }
      );

    } else {
      // Complete connection
      if (currentInflightOp.nodeId !== this.node.id && currentInflightOp.type !== type) {
        const from = currentInflightOp.type === 'out' ? currentInflightOp : { nodeId: this.node.id, port, type };
        const to = currentInflightOp.type === 'in' ? currentInflightOp : { nodeId: this.node.id, port, type };

        appController.createConnection(from.nodeId, from.port, to.nodeId, to.port);
      }
      localController.setInflightPortConnectionOperation(null);
      // Clear selection to trigger disposer
      localController.queueSelectPaths([]);
    }
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
        <select .value=${this.node.config.typeId} @change=${this.handleTypeChange.bind(this)}>
          ${Array.from(defaultNodeRepository.getAllNodeTypes()).map(type => html`
            <option value=${type.id}>${type.displayName}</option>
          `)}
        </select>
      </div>
      ${nodeType?.renderInspector ? nodeType.renderInspector(this.node, onchange) : ''}
    `;
  }

  updated() {
    if (this.node) {
      this.dataset.id = this.node.id;
    }
  }

  render() {
    const { selection, inflightPortConnectionOperation, queuedSelection } = localController.observableState;
    const isSelected = selection.has(this.node.id);

    // We need to observe queuedSelection so that if we are queued, we re-render and call defineSelectable to promote ourselves
    // This is now handled by the isQueued prop passed from GraphGrid, but we keep the check here logic-wise
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

    return html`
      <div class="ports-wrapper">
        <div class="inputs">
          ${inputs.map(input => {
      const isConnecting = connectingPort?.type === 'in' && connectingPort?.port === input.name;
      return html`
              <div class="port-wrapper">
                ${input.name ? html`<span class="port-label">${input.name}</span>` : ''}
                <div
                  class="port in-port ${isConnecting ? 'connecting' : ''}"
                  data-port="${input.name}"
                  data-type="in"
                  @click=${this.handlePortClick}
                  title="${input.description}"
                ></div>
              </div>
            `;
    })}
        </div>
        <div class="outputs">
          ${outputs.map(output => {
      const isConnecting = connectingPort?.type === 'out' && connectingPort?.port === output.name;
      return html`
              <div class="port-wrapper">
                <div
                  class="port out-port ${isConnecting ? 'connecting' : ''}"
                  data-port="${output.name}"
                  data-type="out"
                  @click=${this.handlePortClick}
                  title="${output.description}"
                ></div>
                ${output.name !== '0' ? html`<span class="port-label">${output.name}</span>` : ''}
              </div>
            `;
    })}
        </div>
      </div>
      <div class="node-main-content">
        <div class="node-title">${this.node.config.name || displayName}</div>
        <div class="virtual-inputs-container">
          ${inputs.map(input => {
      const isConnected = connectedPorts.has(input.name);
      // Render virtual input field if not connected and has a defaultValue
      if (input.defaultValue !== undefined && !isConnected) {
        const currentValue = (this.node.config.values && this.node.config.values[input.name]) !== undefined
          ? this.node.config.values[input.name]
          : input.defaultValue || '';

        const isNumber = input.type.kind === 'atomic' && input.type.type === 'number';

        return html`
                <div class="virtual-input-field-wrapper">
                  <label for="${this.node.id}-${input.name}-virtual-input">${input.name}:</label>
                  <input
                    id="${this.node.id}-${input.name}-virtual-input"
                    type="${isNumber ? 'range' : 'text'}"
                    .value=${currentValue.toString()}
                    .min=${input.range?.[0]?.toString() || ''}
                    .max=${input.range?.[1]?.toString() || ''}
                    .step=${isNumber && input.range ? ((input.range[1] - input.range[0]) / 100).toString() : ''}
                    @input=${(e: Event) => this.handleVirtualInputChange(e, input.name)}
                    class="virtual-input-field"
                    title="${input.description}"
                  />
                </div>
              `;
      }
      return null;
    })}
    ${nodeType?.renderBody?.(this.node, { handleVirtualInputChange: this.handleVirtualInputChange.bind(this) }) || ''}
        </div>
      </div>
    `;
  }
}

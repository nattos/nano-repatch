import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { PortHint } from '../../structor/repository';
import { shouldShowInputEditor } from '../../utils/node-width-utils';

const HEADER_HEIGHT = 24;
const ROW_HEIGHT = 24;

export function hasIoSlider(nodeTypeId: string, inputs: PortHint[]): boolean {
  if (nodeTypeId !== 'io.input') return false;
  if (inputs.length !== 1) return false;
  const input = inputs[0];
  return input.type.kind === 'atomic' && input.type.type === 'number';
}

export function shouldHideLabel(
  portName: string,
  type: 'in' | 'out',
  inputs: PortHint[],
  outputs: PortHint[],
  connectedPorts: Set<string>
): boolean {
  if (type === 'in') {
    const input = inputs.find(i => i.name === portName);
    if (input) {
      if (input.suppressLabel) return true;
      const isConnected = connectedPorts.has(input.name);
      if (shouldShowInputEditor(input, isConnected)) {
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
        return true;
      }
    }
  }
  return false;
}

export function renderOutputs(
  nodeId: string,
  outputs: PortHint[],
  inputs: PortHint[],
  connectedPorts: Set<string>,
  isPill: boolean,
  renderDebugValue: (portName: string) => any
) {
  return repeat(outputs, output => output.name, (output, index) => {
    const top = isPill ? 11 : (HEADER_HEIGHT + index * ROW_HEIGHT);
    return html`
            <div class="port-wrapper" style="top: ${top}px; position: absolute; right: 0;">
              ${renderDebugValue(output.name)}
              <graph-port
                .nodeId=${nodeId}
                .name=${output.name}
                type="out"
                .description=${output.description || ''}
                ?hideLabel="${isPill ? true : shouldHideLabel(output.name, 'out', inputs, outputs, connectedPorts)}"
              ></graph-port>
            </div>
          `;
  });
}

import { html } from 'lit';
import { GridNode } from '../../builder/state';
import { GraphNodeRenderHandlers } from '../../structor/repository';
import { runtimeManager } from '../../builder/controllers';
import './scope-widget';

export const DebugScopeInputEditor = (node: GridNode, portName: string, handlers: GraphNodeRenderHandlers) => {
  // Get input value from runtimeManager
  const inputs = runtimeManager.inputs.get(node.id);
  let value = 0;
  if (inputs) {
    if (inputs.fields && inputs.fields[portName] !== undefined) {
      value = inputs.fields[portName];
    } else if (inputs.untagged && inputs.untagged.length > 0) {
      value = inputs.untagged[0];
    }
  }

  // We need to pass the value to the graph-widget.
  // The graph-widget likely expects a stream of values or a single value to append?
  // Let's check graph-widget implementation.
  // Assuming it takes a .value property and handles history internally, or we pass history.
  // Actually, `graph-widget` usually takes `data` array.
  // But here we are in a render loop.
  // If we pass `value`, the widget needs to append it.
  // Or we manage history here?
  // Managing history in the renderer function is tricky because it's stateless.
  // The `graph-widget` should probably handle it or we need a stateful component.
  // But `renderInputEditor` returns a TemplateResult.
  // We can use a custom element that manages state.
  // Let's use `graph-widget` and assume it can handle real-time updates if we pass `value`.
  // If `graph-widget` expects a full array, we might need to accumulate it in `RuntimeManager` or `GraphNode`.
  // But `debug.scope` is a node. It could have state.
  // But the UI is separate.
  // Let's look at `graph-widget` first.

  return html`
    <scope-widget
      .value=${value}
      .min=${-1}
      .max=${1}
      .historySize=${100}
    ></scope-widget>
  `;
};

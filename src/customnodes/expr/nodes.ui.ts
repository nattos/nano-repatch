import { html } from 'lit';
import { GridNode } from '../../builder/state';
import { InspectorChangeHandler } from '../../structor/repository';
import '../../views/monaco-editor';

export const ExpressionInspectorRenderer = (node: GridNode, onchange: InspectorChangeHandler) => html`
  <div style="height: 300px; width: 100%; border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden;">
    <monaco-editor-wrapper
      .value=${node.config.code || ''}
      @change=${(e: CustomEvent) => onchange({ code: e.detail.value })}
    ></monaco-editor-wrapper>
  </div>
`;

import { html } from 'lit';
import { GridNode } from '../../builder/state';
import { InspectorChangeHandler } from '../../structor/repository';
import { localController, runtimeManager } from '../../builder/controllers';
import '../../views/editor-status-bar';
import { renderDiagnosticInspector } from '../../views/inspector/diagnostic-inspector';
import { renderCodeInspector } from '../../views/inspector/code-inspector';

export const ExpressionInspectorRenderer = (node: GridNode, onchange: InspectorChangeHandler) => {
  const uiState = localController.observableState.nodeUIStates.get(node.id);
  const diagnostics = uiState?.diagnostics || [];
  const jsCode = uiState?.jsCode || '';

  // Determine Status
  let status: 'idle' | 'pending' | 'error' | 'success' = 'success'; // Default success if no diagnostics

  if (runtimeManager.pendingDirtyNodeIds.has(node.id)) {
    status = 'pending';
  } else if (diagnostics.some((d: any) => d.severity === 'error')) {
    status = 'error';
  } else if (diagnostics.some((d: any) => d.severity === 'warning')) {
    // Warnings don't block success usually, but we can show success state with warning counts
    status = 'success';
  }

  const handleShowDiagnostics = () => {
    // Define transient selectable for diagnostics
    const path = `diagnostics:${node.id}`;

    localController.defineSelectable({
      path,
      renderInspectorContent: () => renderDiagnosticInspector(node.id, diagnostics, () => {
        // On Back: Restore selection to the node
        localController.queueSelectPaths([node.id]);
      })
    }).select();
  };

  const handleViewCode = () => {
    const path = `code:${node.id}`;
    localController.defineSelectable({
      path,
      renderInspectorContent: () => renderCodeInspector(jsCode, () => {
        localController.queueSelectPaths([node.id]);
      })
    }).select();
  };

  return html`
  <div style="display: flex; flex-direction: column; gap: 0;">
    <editor-status-bar
      .status=${status}
      .diagnostics=${diagnostics}
      @show-diagnostics=${handleShowDiagnostics}
      @view-code=${handleViewCode}
    ></editor-status-bar>
    <div style="height: 300px; width: 100%; border: 1px solid var(--border-color); border-top: none; border-radius: 0 0 4px 4px; overflow: hidden;">
      <monaco-editor-wrapper
        .value=${node.config.code || ''}
        @change=${(e: CustomEvent) => onchange({ code: e.detail.value })}
      ></monaco-editor-wrapper>
    </div>
  </div>
`;
};

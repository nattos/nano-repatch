import { html } from 'lit';
import { Diagnostic } from '../../customnodes/expr/v2/ir-types';
import { localController } from '../../builder/controllers';
import '../ui-icon';
import '../ui-button';

export const renderDiagnosticInspector = (
  nodeId: string,
  diagnostics: Diagnostic[],
  onBack: () => void
) => {
  const formatDiagnostic = (d: Diagnostic) => {
    // Basic formatting: [Line:Col] Severity: Message
    // If we have line info, show it.
    // Assuming d has .message, maybe .line?
    // Checking Diagnostic interface might be good, but assuming standard fields.
    const loc = d.range ? `[${d.range.startLineNumber}:${d.range.startColumn || 0}] ` : '';
    return `${loc}${d.severity.toUpperCase()}: ${d.message}`;
  };

  const textContent = diagnostics.map(formatDiagnostic).join('\n');

  return html`
    <div style="display: flex; flex-direction: column; height: 100%; min-height: 400px; box-sizing: border-box; gap: 8px;">

      <!-- Header with Back Button -->
      <div style="display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color);">
        <ui-button icon="la-arrow-left" @click=${onBack}>Back</ui-button>
        <h3 style="margin: 0; font-size: 1.17em; font-weight: bold;">Diagnostics</h3>
      </div>

      <!-- Content Area -->
      <div style="flex: 1; position: relative;">
        <textarea
          readonly
          style="
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            resize: none;
            background: var(--input-bg);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            padding: 8px;
            box-sizing: border-box;
            outline: none;
            white-space: pre;
          "
        >${textContent}</textarea>
      </div>
    </div>
  `;
};

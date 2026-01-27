import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Diagnostic } from '../customnodes/expr/v2/ir-types';

export type EditorStatus = 'idle' | 'pending' | 'error' | 'success';

@customElement('editor-status-bar')
export class EditorStatusBar extends LitElement {
  @property({ type: String })
  status: EditorStatus = 'idle';

  @property({ type: Array })
  diagnostics: Diagnostic[] = [];

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8em;
      border-bottom: 1px solid var(--border-color);
      background: var(--panel-header-bg);
      color: var(--text-color);
      height: 24px;
      box-sizing: border-box;
    }

    .icon {
      font-size: 1.2em;
      line-height: 1;
    }

    .success { color: #4caf50; }
    .error { color: #f44336; }
    .warning { color: #ff9800; }
    .pending { color: #2196f3; animation: spin 1s linear infinite; }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .counts {
      display: flex;
      gap: 12px;
    }

    .count-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  `;

  render() {
    const errors = this.diagnostics.filter(d => d.severity === 'error').length;
    const warnings = this.diagnostics.filter(d => d.severity === 'warning').length;

    let icon = html`<i class="las la-check-circle success icon"></i>`;
    let message = html`<span class="success">Compiled</span>`;

    if (this.status === 'pending') {
      icon = html`<i class="las la-circle-notch pending icon"></i>`;
      message = html`<span style="opacity: 0.7">Compiling...</span>`;
    } else if (errors > 0) {
      icon = html`<i class="las la-exclamation-circle error icon"></i>`;
      message = html`<span class="error">${errors} Error${errors > 1 ? 's' : ''}</span>`;
    } else if (warnings > 0) {
      icon = html`<i class="las la-exclamation-triangle warning icon"></i>`;
      message = html`<span class="warning">${warnings} Warning${warnings > 1 ? 's' : ''}</span>`;
    }

    return html`
      ${icon}
      ${message}
      ${(this.status !== 'pending' && (errors > 0 || warnings > 0)) ? html`
        <div class="counts">
           ${warnings > 0 && errors > 0 ? html`
              <div class="count-item warning">
                  <i class="las la-exclamation-triangle"></i> ${warnings}
              </div>
           ` : ''}
        </div>
      ` : ''}
    `;
  }
}

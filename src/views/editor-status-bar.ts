import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './ui-icon';
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
      font-size: var(--font-size-xs);
      border-bottom: 1px solid var(--border-color);
      background: var(--panel-header-bg);
      color: var(--text-color);
      height: 24px;
      box-sizing: border-box;
    }

    ui-icon {
      font-size: 1.2em; /* Relative to xs font */
      --icon-size: 1.2em;
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
      gap: 4px;
      cursor: pointer;
    }

    .counts:hover .count-item {
      text-decoration: underline;
    }

    .count-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: bold;
    }
  `;

  private handleClick() {
    this.dispatchEvent(new CustomEvent('show-diagnostics', {
      bubbles: true,
      composed: true
    }));
  }

  render() {
    const errors = this.diagnostics.filter(d => d.severity === 'error').length;
    const warnings = this.diagnostics.filter(d => d.severity === 'warning').length;

    let icon = html`<ui-icon icon="la-check-circle" class="success"></ui-icon>`;
    let message = html``;

    if (this.status === 'pending') {
      icon = html`<ui-icon icon="la-circle-notch" class="pending"></ui-icon>`;
      // Keep "Compiling..." or remove? User said "compiled". Pending is logically different.
      // But typically "minimal" means minimal. Let's keep Compiling... for detailed feedback or remove if strict.
      // User said "compiled" (past tense), explicitly referring to the success state text.
      // I'll leave "Compiling..." for now as it wasn't explicitly forbidden and provides feedback on activity.
      // Actually, looking at "It should look like the warnings", maybe just the spinner?
      // Let's remove "Compiling..." to be safe and minimalistic.
      message = html``;
    } else if (errors > 0 || warnings > 0) {
      // If we have errors/warnings, the main "status" icon might be redundant if we just list the counts.
      // Current logic: Main icon + message. Then EXTRA counts at the end.
      // New logic: Just list the items.

      // Success Icon: Show ONLY if no errors/warnings and not pending?
      icon = html``;
      message = html``;
    }

    return html`
      ${this.status === 'success' && errors === 0 && warnings === 0 ? html`<ui-icon icon="la-check-circle" class="success"></ui-icon>` : ''}
      ${this.status === 'pending' ? html`<ui-icon icon="la-circle-notch" class="pending"></ui-icon>` : ''}

      <div class="counts" @click=${this.handleClick}>
        ${errors > 0 ? html`
          <div class="count-item error">
              <ui-icon icon="la-exclamation-circle"></ui-icon> ${errors}
          </div>
        ` : ''}
        ${warnings > 0 ? html`
          <div class="count-item warning">
              <ui-icon icon="la-exclamation-triangle"></ui-icon> ${warnings}
          </div>
        ` : ''}
      </div>
    `;

  }
}

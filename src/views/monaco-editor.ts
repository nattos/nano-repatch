import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type * as Monaco from 'monaco-editor';

// Worker configuration
// We'll set this up once when the module loads, but the actual workers
// will only be spawned when needed.
self.MonacoEnvironment = {
  getWorker: function (_moduleId: any, label: string) {
    if (label === 'json') {
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker', import.meta.url), { type: 'module' });
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker', import.meta.url), { type: 'module' });
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker', import.meta.url), { type: 'module' });
    }
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker', import.meta.url), { type: 'module' });
    }
    return new Worker(new URL('../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker', import.meta.url), { type: 'module' });
  }
};

@customElement('monaco-editor-wrapper')
export class MonacoEditorWrapper extends LitElement {
  @property({ type: String }) value = '';
  @property({ type: String }) language = 'typescript';

  @query('#container') container!: HTMLElement;
  @state() private isLoading = true;

  private editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  // Hold a reference to the dynamically imported monaco module
  private monacoModule: typeof Monaco | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 300px; /* Default height */
      border: 1px solid #ccc;
      position: relative;
    }
    #container {
      width: 100%;
      height: 100%;
    }
    .loading {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.5);
      color: white;
      z-index: 10;
    }
  `;

  render() {
    return html`
      <div id="container"></div>
      ${this.isLoading ? html`<div class="loading">Loading Editor...</div>` : ''}
    `;
  }

  async firstUpdated() {
    if (this.container) {
      try {
        // Dynamic import
        this.monacoModule = await import('monaco-editor');
        this.isLoading = false;

        // Ensure we are still connected before creating
        if (!this.isConnected) return;

        this.editor = this.monacoModule.editor.create(this.container, {
          value: this.value,
          language: this.language,
          theme: 'vs-dark',
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
        });

        this.editor.onDidChangeModelContent(() => {
          const newValue = this.editor?.getValue() || '';
          this.value = newValue;
          this.dispatchEvent(new CustomEvent('change', {
            detail: { value: newValue },
            bubbles: true,
            composed: true
          }));
        });
      } catch (e) {
        console.error("Failed to load Monaco Editor:", e);
        this.isLoading = false; // Stop spinner at least
      }
    }
  }

  updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    // Only update if editor is initialized
    if (changedProperties.has('value') && this.editor) {
      if (this.editor.getValue() !== this.value) {
        this.editor.setValue(this.value);
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.editor?.dispose();
  }
}

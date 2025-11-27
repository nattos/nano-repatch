import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

// Configure Monaco workers
// Note: In a real Vite setup, we might need to configure workers properly.
// For now, we'll try the basic setup. If it fails, we might need a worker loader.
import * as monaco from 'monaco-editor';

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

// Worker configuration is handled globally above

@customElement('monaco-editor-wrapper')
export class MonacoEditorWrapper extends LitElement {
  @property({ type: String }) value = '';
  @property({ type: String }) language = 'typescript';

  @query('#container') container!: HTMLElement;

  private editor: monaco.editor.IStandaloneCodeEditor | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 300px; /* Default height */
      border: 1px solid #ccc;
    }
    #container {
      width: 100%;
      height: 100%;
    }
  `;

  render() {
    return html`<div id="container"></div>`;
  }

  firstUpdated() {
    if (this.container) {
      this.editor = monaco.editor.create(this.container, {
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
    }
  }

  updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
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

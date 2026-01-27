import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type * as Monaco from 'monaco-editor';
import { configureMonaco } from './monaco-config';

// Import Monaco CSS as a URL to inject into Shadow DOM
// This ensures fonts and relative assets are resolved correctly
// @ts-ignore
import monacoCssUrl from 'monaco-editor/min/vs/editor/editor.main.css?url';

// Import workers using Vite's ?worker syntax
// @ts-ignore
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
// @ts-ignore
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// @ts-ignore
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
// @ts-ignore
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
// @ts-ignore
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Worker configuration
self.MonacoEnvironment = {
  getWorker: function (_moduleId: any, label: string) {
    if (label === 'json') {
      return new jsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  }
};

@customElement('monaco-editor-wrapper')
export class MonacoEditorWrapper extends LitElement {
  @property({ type: String }) value = '';
  @property({ type: String }) language = 'typescript';

  @state() private isLoading = true;

  private editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private monacoModule: typeof Monaco | null = null;
  private container: HTMLElement | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 200px;
      position: relative;
      outline: none; /* Prevent focus ring on the wrapper itself */
    }
    .editor-container {
      width: 100%;
      height: 100%;
      min-height: inherit;
      outline: none;
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
      pointer-events: none;
    }
  `;

  render() {
    return html`
      <!-- Inject Monaco Styles into Shadow DOM -->
      <link rel="stylesheet" href="${monacoCssUrl}">
      <div class="editor-container"></div>
      ${this.isLoading ? html`<div class="loading">Loading Editor...</div>` : ''}
    `;
  }

  async firstUpdated() {
    this.container = this.shadowRoot!.querySelector('.editor-container') as HTMLElement;

    if (this.container) {
      try {
        this.monacoModule = await import('monaco-editor');
        configureMonaco(this.monacoModule);
        this.isLoading = false;

        if (!this.isConnected) return;

        this.editor = this.monacoModule.editor.create(this.container, {
          value: this.value,
          language: this.language,
          theme: 'vs-dark',
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: true,
          fixedOverflowWidgets: true,
          glyphMargin: false,
          folding: true,
          lineNumbersMinChars: 3, // Compact line numbers
          lineDecorationsWidth: 0, // Remove left margin from line numbers
          renderLineHighlight: 'none', // Optional: cleaner look
          scrollbar: {
            useShadows: false,
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
          },
          overviewRulerLanes: 0, // Clean scrollbar area
          hideCursorInOverviewRuler: true
        });

        // Fix: Explicitly layout after a short delay to ensure container sizing is stable
        setTimeout(() => {
          this.editor?.layout();
        }, 100);

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
        this.isLoading = false;
      }
    }
  }

  updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    // Only update if editor is initialized and value is different
    // Avoid loop if the update came from the editor itself
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

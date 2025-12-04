import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState, StateEffect } from '@codemirror/state';
import { autocompletion, CompletionContext, CompletionResult, startCompletion, closeCompletion, acceptCompletion, completionKeymap } from '@codemirror/autocomplete';
import { standardKeymap } from '@codemirror/commands';
import { NodeCatalog } from '../structor/node-catalog';

@customElement('smart-input')
export class SmartInput extends LitElement {
  @property({ type: Object }) catalog?: NodeCatalog;
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = 'Type to search...';
  @property({ type: Boolean }) autofocus = false;

  @query('#editor') editorContainer!: HTMLElement;

  private editorView?: EditorView;
  private originalValue = '';
  private lastPreviewedId: string | null = null;

  static styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      font-family: 'Inter', sans-serif;
    }

    #editor {
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
    }

    /* CodeMirror Overrides */
    .cm-editor {
      height: 100%;
    }
    .cm-scroller {
      overflow: auto;
    }
    .cm-content {
      padding: 8px;
      font-family: inherit;
      font-size: 14px;
    }
    .cm-line {
      padding: 0;
    }

    /* Autocomplete Popup Styling */
    .cm-tooltip-autocomplete {
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }

    .cm-completionLabel {
      font-weight: 500;
    }

    .cm-completionDetail {
      font-style: italic;
      color: #666;
      margin-left: 8px;
    }

    .no-suggestion-option {
        color: #888;
        font-style: italic;
        pointer-events: none;
    }
  `;

  protected firstUpdated() {
    this.initEditor();
  }

  private initEditor() {
    if (!this.editorContainer) return;

    const darkTheme = EditorView.theme({
      "&": {
        color: "#eee",
        backgroundColor: "#222"
      },
      ".cm-content": {
        caretColor: "#fff"
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "#fff"
      },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "#444"
      },
      ".cm-gutters": {
        backgroundColor: "#222",
        color: "#ddd",
        border: "none"
      },
      ".cm-tooltip": {
        backgroundColor: "#333",
        color: "#eee",
        border: "1px solid #555",
        position: "fixed",
        zIndex: "99999"
      },
      ".cm-tooltip-autocomplete": {
        "& > ul > li[aria-selected]": {
          backgroundColor: "#444",
          color: "#fff"
        }
      }
    }, { dark: true });

    this.originalValue = this.value;

    const extensions = [
      darkTheme,
      keymap.of([
        {
          key: 'Tab',
          run: (view) => {
            if (acceptCompletion(view)) {
              return true;
            }
            // If no completion open/accepted, commit current value
            this.dispatchCommit(view.state.doc.toString());
            return true;
          }
        },
        {
          key: 'Enter',
          run: (view) => {
            if (acceptCompletion(view)) {
              return true;
            }
            this.dispatchCommit(view.state.doc.toString());
            return true;
          }
        },
        {
          key: 'Escape',
          run: () => {
            this.dispatchEvent(new CustomEvent('cancel'));
            return true;
          }
        },
        ...completionKeymap,
        ...standardKeymap
      ]),
      placeholder(this.placeholder),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.value = update.state.doc.toString();
          this.dispatchEvent(new CustomEvent('change', { detail: this.value }));

          if (this.catalog) {
            // Live Preview Logic
            // Only start completion if the change was caused by user input (typing/deleting)
            // This prevents the popup from opening when the value is updated programmatically (e.g. via Inspector selection)
            const isUserEvent = update.transactions.some(tr => tr.isUserEvent('input') || tr.isUserEvent('delete'));

            if (isUserEvent) {
              const results = this.catalog.search(this.value);
              let previewId: string | null = null;

              if (results.length > 0) {
                const top = results[0];
                if (top.type === 'node' && top.id) {
                  previewId = top.id;
                }
              }

              if (previewId) {
                this.lastPreviewedId = previewId;
                this.dispatchEvent(new CustomEvent('preview-type', { detail: previewId }));
              } else {
                this.lastPreviewedId = null;
                // If no valid preview, revert to current value
                this.dispatchEvent(new CustomEvent('preview-type', { detail: this.value }));
              }

              startCompletion(this.editorView!);
            }
          }
        }
      })
    ];

    if (this.catalog) {
      extensions.push(autocompletion({
        override: [this.completionSource.bind(this)],
        icons: false,
        defaultKeymap: false,
        optionClass: (opt) => opt.type === 'no-suggestion' ? 'no-suggestion-option' : ''
      }));
    }

    const startState = EditorState.create({
      doc: this.value,
      extensions: extensions
    });

    this.editorView = new EditorView({
      state: startState,
      parent: this.editorContainer
    });

    // Auto-focus and select all if requested
    if (this.autofocus) {
      this.editorView.focus();
      this.editorView.dispatch({
        selection: { anchor: 0, head: this.value.length }
      });
      // Start completion immediately if catalog exists
      if (this.catalog) {
        startCompletion(this.editorView);
      }
    }

    // Commit on blur
    this.editorView.contentDOM.addEventListener('blur', () => {
      this.dispatchCommit(this.editorView!.state.doc.toString());
    });
  }

  updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (changedProperties.has('value') && this.editorView) {
      // If the new value matches what we just previewed, and we are in the middle of typing,
      // we do NOT want to replace the editor content with the full ID.
      // The user is still typing "hu", we don't want to force "utils.hub".
      if (this.lastPreviewedId && this.value === this.lastPreviewedId) {
        return;
      }

      const currentDoc = this.editorView.state.doc.toString();
      if (currentDoc !== this.value) {
        this.editorView.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: this.value }
        });
      }
    }
  }

  private completionSource(context: CompletionContext): CompletionResult | null {
    if (!this.catalog) return null;

    // Always use the full document text as the query
    // This ensures that even if text is selected (during two-step commit), we search for the full node ID.
    const query = context.state.doc.toString();
    let results = this.catalog.search(query);

    // If no results, show "No suggestions"
    if (results.length === 0) {
      return {
        from: 0,
        options: [{
          label: "No suggestions",
          type: "no-suggestion",
          apply: () => { } // No-op
        }],
        filter: false
      };
    }

    return {
      from: 0, // Always replace from the start
      options: results.map(item => ({
        label: item.label,
        detail: item.detail,
        type: item.type,
        apply: (view, completion, from, to) => {
          const insertText = item.value;

          if (item.type === 'node') {
            // Two-step commit logic:
            // 1. If current text is NOT the canonical ID, replace text with ID, select all, and KEEP OPEN.
            // 2. If current text IS the canonical ID (already replaced), then commit.

            const canonicalId = item.id!;
            this.dispatchCommit(canonicalId);
          } else {
            // Drill down (Category/Namespace)
            view.dispatch({
              changes: { from, to, insert: insertText },
              selection: { anchor: from + insertText.length }
            });
            // Trigger completion again immediately
            setTimeout(() => {
              startCompletion(view);
            }, 0);
          }
        },
        boost: item.boost
      })),
      filter: false // We handled filtering in catalog.search
    }
  }

  public commit() {
    this.dispatchCommit(this.editorView?.state.doc.toString() || this.value);
  }

  private dispatchCommit(value: string) {
    if (this.editorView) {
      closeCompletion(this.editorView);
      // this.editorView.contentDOM.blur(); // Don't blur manually, we might be here FROM a blur event
    }

    if (this.catalog) {
      if (this.lastPreviewedId) {
        value = this.lastPreviewedId;
      }
    }

    this.dispatchEvent(new CustomEvent('commit', { detail: value }));
  }

  render() {
    return html`<div id="editor"></div>`;
  }
}

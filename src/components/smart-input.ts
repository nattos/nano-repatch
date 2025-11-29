import { LitElement, html, css, PropertyValueMap } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState, StateEffect } from '@codemirror/state';
import { autocompletion, CompletionContext, CompletionResult, startCompletion, closeCompletion, acceptCompletion } from '@codemirror/autocomplete';
import { standardKeymap } from '@codemirror/commands';
import { NodeCatalog } from '../structor/node-catalog';

@customElement('smart-input')
export class SmartInput extends LitElement {
  @property({ type: Object }) catalog!: NodeCatalog;
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = 'Type to search...';
  @property({ type: Boolean }) autofocus = false;

  @query('#editor') editorContainer!: HTMLElement;

  private editorView?: EditorView;

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
      overflow: hidden;
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
        border: "1px solid #555"
      },
      ".cm-tooltip-autocomplete": {
        "& > ul > li[aria-selected]": {
          backgroundColor: "#444",
          color: "#fff"
        }
      }
    }, { dark: true });

    const startState = EditorState.create({
      doc: this.value,
      extensions: [
        darkTheme,
        keymap.of([
          ...standardKeymap,
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
          }
        ]),
        placeholder(this.placeholder),
        autocompletion({
          override: [this.completionSource.bind(this)],
          icons: false,
          defaultKeymap: false,
          optionClass: (opt) => opt.type === 'no-suggestion' ? 'no-suggestion-option' : ''
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.value = update.state.doc.toString();
            this.dispatchEvent(new CustomEvent('change', { detail: this.value }));

            // Live Preview Logic
            const results = this.catalog.search(this.value);
            if (results.length > 0) {
              const top = results[0];
              if (top.type === 'node' && top.id) {
                this.dispatchEvent(new CustomEvent('preview-type', { detail: top.id }));
              }
            }

            // Always ensure completion is running
            startCompletion(this.editorView!);
          }
        })
      ]
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
      // Start completion immediately
      startCompletion(this.editorView);
    }
  }

  updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>) {
    if (changedProperties.has('value') && this.editorView) {
      const currentDoc = this.editorView.state.doc.toString();
      if (currentDoc !== this.value) {
        this.editorView.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: this.value }
        });
      }
    }
  }

  private completionSource(context: CompletionContext): CompletionResult | null {
    // Always match everything to keep popup open
    const word = context.matchBefore(/.*/) || { from: context.pos, text: "", to: context.pos };

    const query = word.text;
    let results = this.catalog.search(query);

    // If no results, show "No suggestions"
    if (results.length === 0) {
      return {
        from: word.from,
        options: [{
          label: "No suggestions",
          type: "no-suggestion",
          apply: () => { } // No-op
        }],
        filter: false
      };
    }

    return {
      from: word.from,
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

            const currentDoc = view.state.doc.toString();
            const canonicalId = item.id!;

            if (currentDoc !== canonicalId) {
              // Step 1: Replace and Select
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: canonicalId },
                selection: { anchor: 0, head: canonicalId.length }
              });

              // Trigger completion again immediately to show the node as selected top option
              setTimeout(() => {
                startCompletion(view);
              }, 0);
            } else {
              // Step 2: Already matches, so Commit
              this.dispatchCommit(canonicalId);
            }
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

  private dispatchCommit(value: string) {
    this.dispatchEvent(new CustomEvent('commit', { detail: value }));
  }

  render() {
    return html`<div id="editor"></div>`;
  }
}

import { fixture, html, expect, oneEvent } from '@open-wc/testing';
import { describe, it, beforeEach, vi } from 'vitest';
import './smart-input';
import { SmartInput } from './smart-input';
import { NodeCatalog } from '../structor/node-catalog';
import { NodeRepository } from '../structor/repository';
import { definePrimitiveNode } from '../structor/type-helpers';
import { NodeCategory } from '../structor/structor';

// Helper to wait for a specific time
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('SmartInput', () => {
  let smartInput: SmartInput;
  let catalog: NodeCatalog;
  let repo: NodeRepository;

  beforeEach(async () => {
    // Mock execCommand for CodeMirror in JSDOM
    if (!document.execCommand) {
        document.execCommand = () => true;
    }

    repo = new NodeRepository();

    const register = (id: string, category: NodeCategory, aliases: string[] = []) => {
      repo.register({
        id,
        version: '1.0.0',
        displayName: id.split('.').pop()!,
        aliases,
        definition: definePrimitiveNode({
          id,
          metadata: { category },
          inputs: {},
          outputs: {},
          execute: () => ({})
        })
      });
    };

    // Register nodes such that "math.add" comes before "math.abs" alphabetically or by relevance if we search "math."
    // Actually, "math.abs" comes before "math.add".
    register('math.abs', NodeCategory.Math);
    register('math.add', NodeCategory.Math);
    register('math.sub', NodeCategory.Math);

    catalog = new NodeCatalog(repo);

    smartInput = await fixture(html`<smart-input .catalog=${catalog}></smart-input>`);
    await smartInput.updateComplete;
  });

  it('commits the selected suggestion even if it is not the top suggestion', async () => {
    // 1. Focus the editor
    const editor = smartInput.shadowRoot!.querySelector('.cm-content') as HTMLElement;
    editor.focus();

    // 2. Type "math." to trigger completion
    // We need to simulate typing. dispatching 'input' isn't enough for CodeMirror,
    // we need to update the state or use dispatched events that CodeMirror listens to.
    // However, SmartInput listens to 'change' events from CodeMirror to update its value.
    // Let's try inserting text directly via the component's editor view if possible,
    // or simulate typing by updating the value property and waiting?
    // No, updating `value` prop doesn't trigger completion logic in the same way mainly due to `isUserEvent` check.

    // We can access the private `editorView` if we cast to any, or we can use the `keydown` / `input` events.
    // A robust way is to dispatch text input into the contenteditable div.

    // Simulate typing "math.a"
    // "math.abs" should be top result.
    // "math.add" should be second result.

    // We will simulate user typing:
    const typeText = async (text: string) => {
        // Accessing the internal editorView to do "real" updates that look like user input
        const view = (smartInput as any).editorView;
        view.dispatch({
            changes: { from: view.state.doc.length, insert: text },
            userEvent: 'input.type'
        });
        await smartInput.updateComplete;
        await delay(50); // Give time for completion to start
    };

    await typeText('math.a');

    // At this point, "math.abs" should be the top suggestion and thus `lastPreviewedId`.
    expect((smartInput as any).lastPreviewedId).to.equal('math.abs');

    // Simulate clicking "math.add" which would call dispatchCommit('math.add', true)
    // We do this by calling dispatchCommit directly, simulating the callback from the completion item.
    setTimeout(() => {
        (smartInput as any).dispatchCommit('math.add', true);
    });

    const { detail } = await oneEvent(smartInput, 'commit');

    expect(detail).to.equal('math.add');
  });

  it('commits the top suggestion implicitily (Enter/Tab)', async () => {
    // 1. Focus the editor
    const editor = smartInput.shadowRoot!.querySelector('.cm-content') as HTMLElement;
    editor.focus();

    // 2. Type "math.a"
    const view = (smartInput as any).editorView;
    view.dispatch({
        changes: { from: view.state.doc.length, insert: 'math.a' },
        userEvent: 'input.type'
    });
    await smartInput.updateComplete;
    await delay(50);

    expect((smartInput as any).lastPreviewedId).to.equal('math.abs');

    // 3. Trigger commit (simulate Enter or Blur) without explicit flag
    setTimeout(() => {
        (smartInput as any).dispatchCommit(view.state.doc.toString());
    });

    const { detail } = await oneEvent(smartInput, 'commit');
    expect(detail).to.equal('math.abs');
  });
  it('persists the last valid preview when typing invalid text', async () => {
    // 1. Focus
    const editor = smartInput.shadowRoot!.querySelector('.cm-content') as HTMLElement;
    editor.focus();

    const view = (smartInput as any).editorView;

    // 2. Type "math.a" -> expect "math.abs"
    view.dispatch({ changes: { from: 0, insert: 'math.a' }, userEvent: 'input.type' });
    await smartInput.updateComplete;
    await delay(50);
    expect((smartInput as any).lastPreviewedId).to.equal('math.abs');

    // 3. Type "math.az" (invalid) -> expect "math.abs" to persist
    view.dispatch({ changes: { from: 6, insert: 'z' }, userEvent: 'input.type' });
    await smartInput.updateComplete;
    await delay(50);
    expect((smartInput as any).lastPreviewedId).to.equal('math.abs');
  });

  it('reverts to the last valid preview on implicit commit (Blur/Enter)', async () => {
     // 1. Focus
    const editor = smartInput.shadowRoot!.querySelector('.cm-content') as HTMLElement;
    editor.focus();

    const view = (smartInput as any).editorView;

    // 2. Type "math.a" -> expect "math.abs"
    view.dispatch({ changes: { from: 0, insert: 'math.a' }, userEvent: 'input.type' });
    await smartInput.updateComplete;
    await delay(50);

    // 3. Type "math.az" (invalid)
    view.dispatch({ changes: { from: 6, insert: 'z' }, userEvent: 'input.type' });
    await smartInput.updateComplete;
    await delay(50);

    // 4. Commit implicit
    setTimeout(() => {
        (smartInput as any).dispatchCommit(view.state.doc.toString());
    });

    const { detail } = await oneEvent(smartInput, 'commit');
    expect(detail).to.equal('math.abs');
  });
  it('defaults to util.hub if committing with no valid preview', async () => {
     // 1. Focus
    const editor = smartInput.shadowRoot!.querySelector('.cm-content') as HTMLElement;
    editor.focus();

    const view = (smartInput as any).editorView;

    // 2. Type "garbage" (invalid, never valid)
    view.dispatch({ changes: { from: 0, insert: 'garbage' }, userEvent: 'input.type' });
    await smartInput.updateComplete;
    await delay(50);

    // 3. Commit
    setTimeout(() => {
        (smartInput as any).dispatchCommit(view.state.doc.toString());
    });

    const { detail } = await oneEvent(smartInput, 'commit');
    expect(detail).to.equal('util.hub');
  });
});

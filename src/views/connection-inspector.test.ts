import { fixture, html, expect, waitUntil } from '@open-wc/testing';
import { GraphEditor } from './graph-editor';
import { appController, localController } from '../builder/controllers';
import { Connection } from '../builder/state';

import './graph-editor';

describe('Connection Inspector', () => {
  let editor: GraphEditor;
  let connection: Connection;

  beforeEach(async () => {
    editor = await fixture(html`<graph-editor></graph-editor>`);
    
    appController.transaction(tr => {
      const node1 = tr.createNode('literal', 1, 1);
      const node2 = tr.createNode('add', 3, 1);
      connection = tr.createConnection(node1.id, '0', node2.id, '0');
    });

    await editor.updateComplete;
  });

  it('should display and allow editing of connection ports in the inspector', async () => {
    // 1. Select the connection
    localController.queueSelectPaths([connection.id]);

    // Wait until the inspector is rendered
    await waitUntil(() => {
        const inspector = editor.shadowRoot?.querySelector('inspector-popup');
        if (!inspector) return false;
        const fromPortInput = inspector.shadowRoot?.querySelector('[data-testid="from-port-input"]');
        return fromPortInput !== null;
    });

    const inspector = editor.shadowRoot!.querySelector('inspector-popup')!;
    const fromPortInput = inspector.shadowRoot!.querySelector('[data-testid="from-port-input"]') as HTMLInputElement;
    const toPortInput = inspector.shadowRoot!.querySelector('[data-testid="to-port-input"]') as HTMLInputElement;
    
    // Check initial values
    expect(fromPortInput.value).to.equal('0');
    expect(toPortInput.value).to.equal('0');

    // 2. Change the value of the input fields
    fromPortInput.value = 'testFrom';
    fromPortInput.dispatchEvent(new Event('input'));
    
    toPortInput.value = 'testTo';
    toPortInput.dispatchEvent(new Event('input'));
    
    await editor.updateComplete;

    // 3. Check that the appController's state for the connection has been updated
    const updatedConnection = appController.getState().graph.connections[connection.id];
    expect(updatedConnection.fromPort).to.equal('testFrom');
    expect(updatedConnection.toPort).to.equal('testTo');
  });
});

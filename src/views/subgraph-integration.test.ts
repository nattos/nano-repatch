import { fixture, html, expect } from '@open-wc/testing';
import './graph-node';
import { GridNode, GraphState } from '../builder/state';
import { localController } from '../builder/controllers';
import { beforeEach, describe, it } from 'vitest';
import { LitElement } from 'lit';

import { runInAction } from 'mobx';

describe('GraphNode Subgraph Integration', () => {
  beforeEach(() => {
    // Clear loaded subgraphs
    runInAction(() => {
      localController.observableState.loadedSubgraphs.clear();
    });
  });

  it('renders dynamic ports based on loaded subgraph', async () => {
    // 1. Define a subgraph with 1 input and 1 output
    const subgraphId = 'test-subgraph';
    const subgraphState: GraphState = {
      inner: {
        nodes: {
          'in1': { id: 'in1', x: 0, y: 0, config: { typeId: 'input', name: 'MyInput' } },
          'out1': { id: 'out1', x: 10, y: 0, config: { typeId: 'output', name: 'MyOutput' } },
          'other': { id: 'other', x: 5, y: 0, config: { typeId: 'add' } } // Should be ignored
        },
        connections: {}
      },
      auxiliary: {
        outgoingConnections: new Map(),
        incomingConnections: new Map()
      }
    };

    // 2. Load the subgraph
    localController.loadSubgraph(subgraphId, subgraphState);

    // 3. Create a subgraph node referencing it
    const node: GridNode = {
      id: 'node-subgraph',
      x: 0,
      y: 0,
      config: { typeId: 'subgraph', subgraphId: subgraphId }
    };

    const el = await fixture(html`<graph-node .node=${node}></graph-node>`);
    await (el as LitElement).updateComplete;

    // 4. Verify ports
    const inPorts = el.shadowRoot!.querySelectorAll('.in-port');
    const outPorts = el.shadowRoot!.querySelectorAll('.out-port');

    expect(inPorts.length).to.equal(1);
    expect(inPorts[0].getAttribute('data-port')).to.equal('MyInput');

    expect(outPorts.length).to.equal(1);
    expect(outPorts[0].getAttribute('data-port')).to.equal('MyOutput');

    // Verify title
    const title = el.shadowRoot!.querySelector('.node-title');
    expect(title!.textContent).to.contain(subgraphId);
  });

  it('renders input/output nodes with virtual inputs', async () => {
    const inputNode: GridNode = {
      id: 'node-input',
      x: 0,
      y: 0,
      config: { typeId: 'input', name: 'TestInput', values: { '0': '123' } }
    };

    const el = await fixture(html`<graph-node .node=${inputNode}></graph-node>`);
    await (el as LitElement).updateComplete;

    const virtualInputs = el.shadowRoot!.querySelectorAll('.virtual-input-field');
    expect(virtualInputs.length).to.equal(1);
    expect((virtualInputs[0] as HTMLInputElement).value).to.equal('123');
  });
});

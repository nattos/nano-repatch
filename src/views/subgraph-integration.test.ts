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
          'in1': { id: 'in1', x: 0, y: 0, config: { typeId: 'io.input', name: 'MyInput', values: {} } },
          'out1': { id: 'out1', x: 10, y: 0, config: { typeId: 'io.output', name: 'MyOutput', values: {} } },
          'other': { id: 'other', x: 5, y: 0, config: { typeId: 'math.add', values: {} } } // Should be ignored
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
      config: { typeId: 'core.subgraph', subgraphId: subgraphId, values: {} }
    };

    const el = await fixture(html`<graph-node .node=${node}></graph-node>`);
    await (el as LitElement).updateComplete;

    await (el as LitElement).updateComplete;

    const inPorts = el.shadowRoot!.querySelectorAll('graph-port[type="in"]');
    const outPorts = el.shadowRoot!.querySelectorAll('graph-port[type="out"]');

    expect(inPorts.length).to.equal(1);
    expect(inPorts[0].getAttribute('name')).to.equal('MyInput');

    expect(outPorts.length).to.equal(1);
    expect(outPorts[0].getAttribute('name')).to.equal('MyOutput');

    // Verify title
    const title = el.shadowRoot!.querySelector('.node-title');
    expect(title!.textContent).to.contain(subgraphId);
  });

  it('renders input/output nodes with virtual inputs', async () => {
    const clampNode: GridNode = {
      id: 'node-clamp',
      x: 0,
      y: 0,
      config: { typeId: 'math.clamp', values: { 'min': 0.5 } }
    };

    const el = await fixture(html`<graph-node .node=${clampNode}></graph-node>`);
    await (el as LitElement).updateComplete;

    const virtualInputs = el.shadowRoot!.querySelectorAll('.virtual-input-field');
    // Clamp has 3 inputs: value, min, max
    expect(virtualInputs.length).to.equal(3);

    // Find the min input
    const minInput = Array.from(virtualInputs).find(i => i.id.includes('min'));
    expect(minInput).to.exist;
    expect((minInput as any).value).to.equal(0.5);
  });
});

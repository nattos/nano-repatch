import { fixture, html, expect } from '@open-wc/testing';

import './graph-node'; // Import graph-node directly
import { GraphNode } from './graph-node';
import { GridNode } from '../builder/state'; // Import GridNode
import { beforeEach, describe, it } from 'vitest';
import { LitElement } from 'lit';

describe('GraphNode', () => {
  let clampNode: GraphNode;
  let testNode: GridNode;

  beforeEach(async () => {
    testNode = {
      id: 'node-test-clamp',
      x: 0,
      y: 0,
      config: { typeId: 'math.clamp', values: {} }
    };

    clampNode = await fixture(html`<graph-node .node=${testNode}></graph-node>`);
    await clampNode.updateComplete;
  });

  it('renders correct ports and virtual inputs for a clamp node', async () => {
    const inPorts = clampNode.shadowRoot!.querySelectorAll('graph-port[type="in"]');
    const outPorts = clampNode.shadowRoot!.querySelectorAll('graph-port[type="out"]');

    expect(inPorts.length).to.equal(3, 'Should have 3 input ports (including virtual ones)');
    expect(outPorts.length).to.equal(1, 'Should have 1 output port');

    const inPortNames = Array.from(inPorts).map(p => p.getAttribute('name'));
    expect(inPortNames).to.have.members(['value', 'min', 'max']);

    const outPortNames = Array.from(outPorts).map(p => p.getAttribute('name'));
    expect(outPortNames).to.have.members(['value']);

    const virtualInputs = clampNode.shadowRoot!.querySelectorAll('.virtual-input-field');
    expect(virtualInputs.length).to.equal(3, 'Should have 3 virtual inputs');
  });

  it('renders correct ports for an fmod node', async () => {
    const fmodTestNode: GridNode = {
      id: 'node-test-fmod',
      x: 0,
      y: 0,
      config: { typeId: 'math.fmod', values: {} }
    };

    const fmodNode = await fixture(html`<graph-node .node=${fmodTestNode}></graph-node>`);
    await (fmodNode as LitElement).updateComplete;

    const inPorts = fmodNode.shadowRoot!.querySelectorAll('graph-port[type="in"]');
    const outPorts = fmodNode.shadowRoot!.querySelectorAll('graph-port[type="out"]');

    expect(inPorts.length).to.equal(2, 'Should have 2 input ports');
    expect(outPorts.length).to.equal(2, 'Should have 2 output ports');

    const inPortNames = Array.from(inPorts).map(p => p.getAttribute('name'));
    expect(inPortNames).to.have.members(['dividend', 'divisor']);

    const outPortNames = Array.from(outPorts).map(p => p.getAttribute('name'));
    expect(outPortNames).to.have.members(['div', 'mod']);

    const virtualInputs = fmodNode.shadowRoot!.querySelectorAll('.virtual-input-field');
    expect(virtualInputs.length).to.equal(2, 'Should have 2 virtual inputs');
  });
});


import { GraphExecutor } from './src/structor/executor';
import { NodeRepository, defaultNodeRepository } from './src/structor/repository';
import { GraphDefinition } from './src/structor/structor';
import { NumberType } from './src/structor/std-types';

// Define a simple math node if not already in default repository,
// but let's try to use what's likely there or register a simple one.
// I'll register a simple 'test.add' node to be sure.

const repository = new NodeRepository();

// Register a simple add node
repository.register({
  id: 'test.add',
  version: '1.0.0',
  displayName: 'Add',
  definition: {
    id: 'test.add',
    kind: 'primitive',
    configType: { kind: 'record', fields: {}, untagged: [] },
    computeOutputTypes: () => ({ kind: 'record', fields: { result: NumberType }, untagged: [] }),
    execute: (inputs: any) => {
      const a = inputs.fields.a || 0;
      const b = inputs.fields.b || 0;
      return { fields: { result: a + b }, untagged: [] };
    }
  },
  inputs: [
    { name: 'a', type: NumberType, description: 'A' },
    { name: 'b', type: NumberType, description: 'B' }
  ],
  outputs: [
    { name: 'result', type: NumberType, description: 'Result' }
  ]
});

const graph: GraphDefinition = {
  id: 'test-graph',
  kind: 'graph',
  type: { kind: 'graph', inputs: { kind: 'record', fields: {}, untagged: [] }, outputs: { kind: 'record', fields: {}, untagged: [] } },
  nodes: {
    'node1': { definitionId: 'test.add', defaultConfig: { fields: {}, untagged: [] } }
  },
  connections: [],
  inputs: {
    'in_a': { nodeId: 'node1', port: 'a' },
    'in_b': { nodeId: 'node1', port: 'b' }
  },
  outputs: {
    'out': { nodeId: 'node1', port: 'result' }
  }
};

const executor = new GraphExecutor(graph, repository);

console.log('Initial Update');
executor.update({});
console.log('Output (should be 0):', executor.getGraphOutput('out'));

console.log('Setting Inputs a=5, b=3');
executor.setInput('in_a', 5);
executor.setInput('in_b', 3);
executor.update({});
console.log('Output (should be 8):', executor.getGraphOutput('out'));

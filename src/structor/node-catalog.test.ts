import { describe, it, expect, beforeEach } from 'vitest';
import { NodeCatalog } from './node-catalog';
import { NodeRepository, NodeType } from './repository';
import { definePrimitiveNode } from './type-helpers';
import { NodeCategory } from './structor';

describe('NodeCatalog', () => {
  let repo: NodeRepository;
  let catalog: NodeCatalog;

  beforeEach(() => {
    repo = new NodeRepository();

    // Helper to register dummy nodes
    const register = (id: string, category: NodeCategory, aliases: string[] = []) => {
      repo.register({
        id,
        version: '1.0.0',
        displayName: id.split('.').pop()!, // Simple display name
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

    // Register a diverse set of nodes
    register('math.add', NodeCategory.Math, ['plus', 'sum']);
    register('math.sub', NodeCategory.Math);
    register('logic.and', NodeCategory.Logic);
    register('core.and', NodeCategory.Logic); // ID doesn't contain 'logic'
    register('io.input', NodeCategory.IO);
    register('resolume.input', NodeCategory.IO); // Namespace 'resolume', Category 'IO'
    register('resolume.output', NodeCategory.IO);

    catalog = new NodeCatalog(repo);
  });

  it('should return all nodes when query is empty', () => {
    const results = catalog.search('');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should match nodes by ID', () => {
    const results = catalog.search('add');
    expect(results.find((r: any) => r.id === 'math.add')).toBeDefined();
  });

  it('should match nodes by namespace', () => {
    const results = catalog.search('math');
    // Should show the namespace itself or nodes under it?
    // User req: "We will rank categories and namespace matches higher"
    // So 'math' should probably show 'math.' as a namespace match
    const mathNamespace = results.find((r: any) => r.type === 'namespace' && r.label === 'math');
    expect(mathNamespace).toBeDefined();
  });

  it('should drill down into namespaces with dot', () => {
    const results = catalog.search('math.');
    // Should show 'add', 'sub'
    expect(results.find((r: any) => r.id === 'math.add')).toBeDefined();
    expect(results.find(r => r.id === 'math.sub')).toBeDefined();
    // Should NOT show 'logic.and'
    expect(results.find(r => r.id === 'logic.and')).toBeUndefined();
  });

  it('should show categories within a namespace', () => {
    // resolume.input and resolume.output are in IO category
    const results = catalog.search('resolume.');
    // Should show 'IO' category
    expect(results.find((r: any) => r.type === 'category' && r.label === 'IO')).toBeDefined();
  });

  it('should filter by category within a namespace', () => {
    const results = catalog.search('resolume.IO.');
    expect(results.find((r: any) => r.id === 'resolume.input')).toBeDefined();
    expect(results.find((r: any) => r.id === 'resolume.output')).toBeDefined();
  });

  it('should show nodes when drilling down into a category that is not in the ID', () => {
    // 1. Search for 'Logic'
    const catResults = catalog.search('Logic');
    const logicCat = catResults.find(r => r.type === 'category' && r.label === 'Logic');
    expect(logicCat).toBeDefined();
    expect(logicCat?.value).toBe('Logic.');

    // 2. Drill down 'Logic.'
    const results = catalog.search('Logic.');
    // Should find 'core.and' because it has category 'Logic'
    expect(results.find(r => r.id === 'core.and')).toBeDefined();
  });

  it('should match nodes by alias', () => {
    const results = catalog.search('plus');
    expect(results.find(r => r.id === 'math.add')).toBeDefined();

    const results2 = catalog.search('sum');
    expect(results2.find(r => r.id === 'math.add')).toBeDefined();
  });
});

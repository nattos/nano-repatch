import { NodeRepository, NodeType } from './repository';
import { NodeCategory } from './structor';

export interface CatalogItem {
  label: string;
  type: 'node' | 'category' | 'namespace';
  id?: string; // For nodes
  value: string; // The value to insert (e.g. "math." or "math.add")
  detail?: string;
  boost?: number;
}

export class NodeCatalog {
  constructor(private repository: NodeRepository, private subgraphProvider?: () => string[]) { }

  search(query: string): CatalogItem[] {
    const results: CatalogItem[] = [];
    const normalizedQuery = query.toLowerCase();

    // 1. Handle Drill-down (ends with '.')
    if (normalizedQuery.endsWith('.')) {
      return this.getDrillDownResults(query.slice(0, -1));
    }

    // 2. Handle Search
    // We search across everything: Namespaces, Categories, Nodes, AND Subgraphs

    const nodes = Array.from(this.repository.getAllNodeTypes());
    const namespaces = new Set<string>();
    const categories = new Set<string>();

    // Inject Subgraphs as pseudo-nodes
    const subgraphPaths = this.subgraphProvider ? this.subgraphProvider() : [];
    const subgraphs = subgraphPaths
      .filter(path => path.includes('/')) // Ignore root files
      .map(path => {
        // sub/dir/graph.json -> sub.dir.graph
        const noExt = path.replace('.json', '');
        const dotted = noExt.replace(/\//g, '.');
        return {
          id: dotted, // This will be the subgraphId
          displayName: dotted.split('.').pop()! // Short name
        };
      });


    for (const node of nodes) {
      const parts = node.id.split('.');
      if (parts.length > 1) {
        namespaces.add(parts[0]);
      }
      if (node.definition.metadata?.category) {
        categories.add(node.definition.metadata.category);
      }
    }

    for (const sub of subgraphs) {
      const parts = sub.id.split('.');
      if (parts.length > 1) {
        namespaces.add(parts[0]);
      }
    }

    // Match Namespaces
    for (const ns of namespaces) {
      if (ns.toLowerCase().includes(normalizedQuery)) {
        results.push({
          label: ns,
          type: 'namespace',
          value: ns + '.',
          detail: 'Namespace',
          boost: 20 // High boost for namespaces
        });
      }
    }

    // Match Categories
    for (const cat of categories) {
      if (cat.toLowerCase().includes(normalizedQuery)) {
        results.push({
          label: cat,
          type: 'category',
          value: cat + '.',
          detail: 'Category',
          boost: 15 // High boost for categories
        });
      }
    }

    // Match Nodes
    for (const node of nodes) {
      let score = 0;
      const id = node.id.toLowerCase();
      const name = node.displayName.toLowerCase();
      const aliases = (node.aliases || []).map(a => a.toLowerCase());

      if (id === normalizedQuery) score += 10;
      else if (id.startsWith(normalizedQuery)) score += 5;
      else if (id.includes(normalizedQuery)) score += 1;

      if (name === normalizedQuery) score += 5;
      else if (name.startsWith(normalizedQuery)) score += 3;
      else if (name.includes(normalizedQuery)) score += 1;

      // Check Aliases
      for (const alias of aliases) {
        if (alias === normalizedQuery) score += 5;
        else if (alias.startsWith(normalizedQuery)) score += 3;
        else if (alias.includes(normalizedQuery)) score += 1;
      }

      if (score > 0) {
        results.push({
          label: node.displayName,
          type: 'node',
          id: node.id,
          value: node.id,
          detail: node.id,
          boost: score
        });
      }
    }

    // Match Subgraphs
    for (const sub of subgraphs) {
      let score = 0;
      const id = sub.id.toLowerCase();
      const name = sub.displayName.toLowerCase();
      const fullPath = sub.id; // dotted path is the ID

      if (fullPath === normalizedQuery) score += 12; // Higher than regular nodes? Equal?
      else if (fullPath.startsWith(normalizedQuery)) score += 6;
      else if (fullPath.includes(normalizedQuery)) score += 2;

      if (name === normalizedQuery) score += 6;
      else if (name.startsWith(normalizedQuery)) score += 4;
      else if (name.includes(normalizedQuery)) score += 2;

      if (score > 0) {
        results.push({
          label: sub.displayName, // Show "graph"
          type: 'node',
          id: sub.id, // "sub.graph"
          value: sub.id,
          detail: 'Subgraph',
          boost: score
        });
      }
    }

    return results.sort((a, b) => {
      const boostDiff = (b.boost || 0) - (a.boost || 0);
      if (boostDiff !== 0) return boostDiff;
      // If boosts are equal, prefer shorter values (e.g. "math" over "math.add")
      return a.value.length - b.value.length;
    });
  }

  private getDrillDownResults(prefix: string): CatalogItem[] {
    // Prefix could be "math" or "resolume.IO" or "Logic"
    // We need to find nodes that match this prefix
    const nodes = Array.from(this.repository.getAllNodeTypes());
    const results: CatalogItem[] = [];
    const seen = new Set<string>();

    const normalizedPrefix = prefix.toLowerCase();

    // Inject Subgraphs
    const subgraphPaths = this.subgraphProvider ? this.subgraphProvider() : [];
    const subgraphs = subgraphPaths
      .filter(path => path.includes('/'))
      .map(path => {
        const noExt = path.replace('.json', '');
        const dotted = noExt.replace(/\//g, '.');
        return {
          id: dotted,
          displayName: dotted.split('.').pop()!
        };
      });

    // Determine matches for both regular nodes and subgraphs

    const allItems = [
      ...nodes.map(n => ({ id: n.id, displayName: n.displayName, category: n.definition.metadata?.category, isSubgraph: false })),
      ...subgraphs.map(s => ({ id: s.id, displayName: s.displayName, category: undefined, isSubgraph: true }))
    ];

    for (const node of allItems) {
      const id = node.id;
      const category = node.category || '';

      // Check if node belongs to this prefix path
      // Case 1: Prefix is namespace (e.g. "math") -> match "math.add"
      // Case 2: Prefix is namespace.category (e.g. "resolume.IO") -> match "resolume.input" (if category is IO)
      // Case 3: Prefix is category (e.g. "Logic") -> match "core.and" (if category is Logic)

      let matches = false;

      // Check ID hierarchy
      if (id.toLowerCase().startsWith(normalizedPrefix + '.')) {
        matches = true;
      }

      if (matches) {
        // It's a child node.
        // Should we show the node itself? Yes.
        results.push({
          label: node.displayName,
          type: 'node',
          id: node.id,
          value: node.id,
          detail: node.isSubgraph ? 'Subgraph' : node.id,
          boost: 1
        });

        // Should we show its category?
        if (category && !seen.has(category)) {
          if (!normalizedPrefix.includes(category.toLowerCase())) {
            results.push({
              label: category,
              type: 'category',
              value: prefix + '.' + category + '.', // Append category to prefix
              detail: 'Category',
              boost: 2
            });
            seen.add(category);
          }
        }
      } else {
        // Handle the case where prefix includes category: "resolume.IO"
        const parts = normalizedPrefix.split('.');

        if (parts.length === 2 && !node.isSubgraph) {
          const ns = parts[0];
          const cat = parts[1];

          if (id.toLowerCase().startsWith(ns + '.') && category.toLowerCase() === cat) {
            results.push({
              label: node.displayName,
              type: 'node',
              id: node.id,
              value: node.id,
              detail: node.id,
              boost: 1
            });
          }
        } else if (parts.length === 1 && !node.isSubgraph) {
          // Handle Case 3: Prefix is just category name
          if (category.toLowerCase() === normalizedPrefix) {
            results.push({
              label: node.displayName,
              type: 'node',
              id: node.id,
              value: node.id,
              detail: node.id,
              boost: 1
            });
          }
        }
      }
    }

    return results;
  }
}

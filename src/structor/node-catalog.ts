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
  constructor(private repository: NodeRepository) { }

  search(query: string): CatalogItem[] {
    const results: CatalogItem[] = [];
    const normalizedQuery = query.toLowerCase();

    // 1. Handle Drill-down (ends with '.')
    if (normalizedQuery.endsWith('.')) {
      return this.getDrillDownResults(query.slice(0, -1));
    }

    // 2. Handle Search
    // We search across everything: Namespaces, Categories, Nodes

    const nodes = Array.from(this.repository.getAllNodeTypes());
    const namespaces = new Set<string>();
    const categories = new Set<string>();

    for (const node of nodes) {
      const parts = node.id.split('.');
      if (parts.length > 1) {
        namespaces.add(parts[0]);
      }
      if (node.definition.metadata?.category) {
        categories.add(node.definition.metadata.category);
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

      if (id === normalizedQuery) score += 10;
      else if (id.startsWith(normalizedQuery)) score += 5;
      else if (id.includes(normalizedQuery)) score += 1;

      if (name === normalizedQuery) score += 5;
      else if (name.startsWith(normalizedQuery)) score += 3;
      else if (name.includes(normalizedQuery)) score += 1;

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

    return results.sort((a, b) => {
      const boostDiff = (b.boost || 0) - (a.boost || 0);
      if (boostDiff !== 0) return boostDiff;
      // If boosts are equal, prefer shorter values (e.g. "math" over "math.add")
      return a.value.length - b.value.length;
    });
  }

  private getDrillDownResults(prefix: string): CatalogItem[] {
    // Prefix could be "math" or "resolume.IO"
    // We need to find nodes that match this prefix
    const nodes = Array.from(this.repository.getAllNodeTypes());
    const results: CatalogItem[] = [];
    const seen = new Set<string>();

    const normalizedPrefix = prefix.toLowerCase();

    for (const node of nodes) {
      const id = node.id;
      const category = node.definition.metadata?.category || '';

      // Check if node belongs to this prefix path
      // Case 1: Prefix is namespace (e.g. "math") -> match "math.add"
      // Case 2: Prefix is namespace.category (e.g. "resolume.IO") -> match "resolume.input" (if category is IO)

      let matches = false;

      // Check ID hierarchy
      if (id.toLowerCase().startsWith(normalizedPrefix + '.')) {
        matches = true;
      }

      // Check Category hierarchy (if prefix matches namespace, and node is in category)
      // This is tricky. User said: "resolume." should show "IO."
      // So if we are at "resolume.", we look at all nodes starting with "resolume."
      // And for each node, we add its Category to the list.

      if (matches) {
        // It's a child node.
        // Should we show the node itself? Yes.
        results.push({
          label: node.displayName,
          type: 'node',
          id: node.id,
          value: node.id,
          detail: node.id,
          boost: 1
        });

        // Should we show its category?
        if (category && !seen.has(category)) {
          // Only if the prefix doesn't already include the category?
          // User example: "resolume." -> show "IO."
          // "resolume.IO." -> show nodes

          // If prefix is just "resolume", we show "IO"
          // If prefix is "resolume.IO", we don't show "IO" again.

          // Simple heuristic: If the category name is NOT part of the prefix, show it.
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
        // We need to match nodes that start with "resolume." AND have category "IO"

        // Split prefix: "resolume" and "IO"
        const parts = normalizedPrefix.split('.');
        // Assume last part is category if it matches a known category?
        // Or just strictly follow the user's "namespace.category" logic?

        // Let's try to match: ID starts with (parts[0] + '.') AND category == parts[1]
        if (parts.length === 2) {
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
        }
      }
    }

    return results;
  }
}

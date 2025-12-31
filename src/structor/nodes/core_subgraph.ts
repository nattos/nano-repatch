import { registerNode } from '../node-helpers';
import { definePrimitiveNode } from '../type-helpers';
import { NodeCategory, StructorType, AnalysisContext, ExecutionContext } from '../structor';
import { GraphState } from '../../builder/state';

interface SubgraphConfig {
  subgraphId: string;
}

interface SubgraphAnalysisContext extends AnalysisContext {
  loadedSubgraphs?: Map<string, GraphState>;
}

// Helper to infer type from io.input config (duplicated from io_input.ts for now to avoid circular deps if shared in primitives)
// Ideally this moves to a shared helper file.
function inferTypeFromConfig(config: any): StructorType | undefined {
  if (!config) return undefined;
  const typeStr = config.type as string;
  if (!typeStr || typeStr === 'any') return undefined;

  if (typeStr === 'float') return { kind: 'atomic', type: 'number' };
  if (typeStr === 'string') return { kind: 'atomic', type: 'string' };
  if (typeStr.startsWith('float')) {
    const size = parseInt(typeStr.slice(5));
    if (!isNaN(size)) {
      return { kind: 'array', size, element: { kind: 'atomic', type: 'number' } };
    }
  }
  return undefined;
}

// Helper for dynamic port naming (replacing #)
export function resolvePortName(name: string, index: number, total: number, kind: 'input' | 'output'): string {
  if (!name || !name.includes('#')) return name;

  let replacement = '';
  if (total === 1) {
    replacement = kind === 'input' ? 'in' : 'out';
  } else if (total <= 4) {
    replacement = ['x', 'y', 'z', 'w'][index];
  } else {
    replacement = index.toString();
  }

  return name.replace(/#/g, replacement);
}

export const primitive_subgraph = definePrimitiveNode({
  id: 'core.subgraph',
  metadata: {
    category: NodeCategory.Core,
    keywords: ['nested', 'graph'],
    description: 'Executes a nested subgraph.'
  },
  config: { subgraphId: { kind: 'atomic', type: 'string' } },
  inputs: {},
  outputs: {},
  ui: {
    inspector: {
      fields: [
        {
          type: 'string',
          label: 'Subgraph ID',
          path: 'subgraphId'
        }
      ]
    }
  },
  getDisplayLabel: (config: SubgraphConfig) => {
    if (config.subgraphId) {
      const parts = config.subgraphId.split('.');
      return parts[parts.length - 1];
    }
    return undefined;
  },
  computeForwardPorts: (inputType, config, context) => {
    // Access loadedSubgraphs from context (injected by compiler)
    const ctx = context as SubgraphAnalysisContext;
    const loadedSubgraphs = ctx.loadedSubgraphs;

    if (!loadedSubgraphs) {
      return { inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: {} } };
    }

    // FIXME: There's a widespread problem where configs are typed as Structors, but they aren't actually.
    const subgraphId = (config as any as SubgraphConfig).subgraphId;
    const subgraph = loadedSubgraphs.get(subgraphId);

    if (subgraph) {
      const subgraphNodes = Object.values(subgraph.inner.nodes);

      // Compute Inputs from Subgraph Inputs
      const inputFields: Record<string, StructorType> = {};
      const inputNodes = subgraphNodes
        .filter(n => n.config.typeId === 'io.input' || n.config.typeId === 'input')
        .sort((a, b) => a.y - b.y);

      inputNodes.forEach((n, i) => {
        let name = (n.config as any).name || 'value';
        name = resolvePortName(name, i, inputNodes.length, 'input');
        const inferred = inferTypeFromConfig(n.config);
        inputFields[name] = inferred || { kind: 'atomic', type: 'any' };
      });

      // Compute Outputs from Subgraph Outputs
      const outputFields: Record<string, StructorType> = {};
      const outputNodes = subgraphNodes
        .filter(n => n.config.typeId === 'io.output' || n.config.typeId === 'output')
        .sort((a, b) => a.y - b.y);

      outputNodes.forEach((n, i) => {
        let name = (n.config as any).name || 'value';
        name = resolvePortName(name, i, outputNodes.length, 'output');
        outputFields[name] = { kind: 'atomic', type: 'any' };
      });

      return {
        inputs: { kind: 'record', fields: inputFields },
        outputs: { kind: 'record', fields: outputFields }
      };
    }

    return { inputs: { kind: 'record', fields: {} }, outputs: { kind: 'record', fields: {} } };
  },
  execute: (input: any, config: any, context: ExecutionContext) => {
    // Subgraph execution logic would go here.
    return { fields: {} };
  }
});
registerNode({
  version: "1.0.0",
  ...primitive_subgraph,
  displayName: 'Subgraph',
  // getDisplayLabel is already in primitive_subgraph but safe to pass again (it comes via spread)
});

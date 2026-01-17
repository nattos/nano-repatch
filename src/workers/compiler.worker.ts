import { compileGraph } from '../builder/compiler';
import { defaultNodeRepository } from '../structor/repository';
import { CompilerWorkerMessage, GraphCompiledMessage } from './types';
import { GraphState } from '../builder/state';

self.onerror = (e) => {
  console.error('Compiler Worker Error (Global):', e);
  // Optional: Post error back to main thread if we had a message type for it
};

self.onmessage = async (event: MessageEvent<CompilerWorkerMessage>) => {
  const { type } = event.data;

  if (type === 'COMPILE_GRAPH') {
    const { state, subgraphs } = event.data;
    try {
      // Convert subgraphs Record to Map
      const subgraphsMap = new Map<string, GraphState>(Object.entries(subgraphs));

      // 0. Pre-load dependencies for nodes (e.g. TypeScript for Expression Node)
      const uniqueTypeIds = new Set<string>();
      // State is AppState, so we need state.graph.inner.nodes
      if (state.graph && state.graph.inner && state.graph.inner.nodes) {
        Object.values(state.graph.inner.nodes).forEach(n => uniqueTypeIds.add(n.config.typeId));
      }

      subgraphsMap.forEach(g => {
        if (g.inner && g.inner.nodes) {
          Object.values(g.inner.nodes).forEach(n => uniqueTypeIds.add(n.config.typeId));
        }
      });

      const processedTypes = new Set<string>();
      const loadPromises: Promise<void>[] = [];

      for (const typeId of uniqueTypeIds) {
        if (processedTypes.has(typeId)) continue;
        processedTypes.add(typeId);

        const nodeType = defaultNodeRepository.getNodeType(typeId);
        if (nodeType && nodeType.definition && (nodeType.definition as any).loadCompileDeps) {
          loadPromises.push((nodeType.definition as any).loadCompileDeps());
        }
      }

      if (loadPromises.length > 0) {
        // console.log(`Compiler Worker: Loading dependencies for ${loadPromises.length} node types...`);
        await Promise.all(loadPromises);
      }

      // console.log('Compiler Worker: Compiling graph...');
      const { graph, inferredTypes, virtualInputMappings, outputRemappings, nodeMetadata, idMap, usesMidi } = compileGraph(state, subgraphsMap, defaultNodeRepository);
      const response: GraphCompiledMessage = {
        type: 'GRAPH_COMPILED',
        graph,
        inferredTypes,
        virtualInputMappings,
        outputRemappings,
        nodeMetadata,
        idMap,
        usesMidi
      };

      self.postMessage(response);
    } catch (error) {
      console.error('Compiler Worker Error:', error);
      // We might want an error message type, but for now just log
    }
  } else if (type === 'COMPILE_CONFIGS') {
    try {
      const { nodes } = event.data;

      // 0. Pre-load dependencies
      const uniqueTypeIds = new Set<string>();
      nodes.forEach((n: any) => uniqueTypeIds.add(n.typeId));

      const loadPromises: Promise<void>[] = [];
      const processedTypes = new Set<string>();

      for (const typeId of uniqueTypeIds) {
        if (processedTypes.has(typeId)) continue;
        processedTypes.add(typeId);

        const nodeType = defaultNodeRepository.getNodeType(typeId);
        if (nodeType && nodeType.definition && (nodeType.definition as any).loadCompileDeps) {
          loadPromises.push((nodeType.definition as any).loadCompileDeps());
        }
      }

      if (loadPromises.length > 0) {
        await Promise.all(loadPromises);
      }

      const configs: Record<string, any> = {};

      for (const node of nodes) {
        const nodeType = defaultNodeRepository.getNodeType(node.typeId);
        if (nodeType && nodeType.compileConfig) {
          configs[node.id] = nodeType.compileConfig(node.config);
        } else {
          configs[node.id] = node.config; // Fallback to raw config
        }
      }

      self.postMessage({
        type: 'CONFIGS_COMPILED',
        configs
      });
    } catch (error) {
      console.error('Compiler Worker Error (Multi Config):', error);
    }
  }
};

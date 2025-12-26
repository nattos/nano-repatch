import { compileGraph } from '../builder/compiler';
import { defaultNodeRepository } from '../structor/repository';
import { CompilerWorkerMessage, GraphCompiledMessage } from './types';
import { GraphState } from '../builder/state';

self.onerror = (e) => {
  console.error('Compiler Worker Error (Global):', e);
  // Optional: Post error back to main thread if we had a message type for it
};

self.onmessage = (event: MessageEvent<CompilerWorkerMessage>) => {
  const { type } = event.data;

  if (type === 'COMPILE_GRAPH') {
    const { state, subgraphs } = event.data;
    try {
      // Convert subgraphs Record to Map
      const subgraphsMap = new Map<string, GraphState>(Object.entries(subgraphs));

      // console.log('Compiler Worker: Compiling graph...');
      const { graph, inferredTypes } = compileGraph(state, subgraphsMap, defaultNodeRepository);

      const response: GraphCompiledMessage = {
        type: 'GRAPH_COMPILED',
        graph,
        inferredTypes
      };

      self.postMessage(response);
    } catch (error) {
      console.error('Compiler Worker Error:', error);
      // We might want an error message type, but for now just log
    }
  } else if (type === 'COMPILE_CONFIGS') {
    try {
      const { nodes } = event.data;
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

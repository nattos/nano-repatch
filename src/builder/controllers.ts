import { AppController } from './state';
import { LocalController } from './local-state';
import { RuntimeManager } from '../runtime/manager';
import { WorkspaceController } from './workspace-controller';

import { registerNicePatternUI } from '../customnodes/nicepattern/ui-registration';
import { resolumeManager } from '../io/resolume/manager';

import { reaction, toJS } from 'mobx';

// Register UI components for custom nodes (Main thread only)
registerNicePatternUI();

// These are the singleton instances of the controllers that will be used throughout the application.
export const appController = new AppController();
export const localController = new LocalController();
export const runtimeManager = new RuntimeManager(appController, localController);
export const workspaceController = new WorkspaceController(appController);

// Initial connection to Resolume
resolumeManager.connect();
runtimeManager.sendResolumeControl('connect');

// React to graph changes to update wire layout
reaction(
  () => toJS(appController.observableState.graph.inner),
  () => {
    localController.updateWireLayout(appController.observableState.graph);
  },
  { fireImmediately: true, delay: 50 } // Debounce slightly to avoid thrashing on drag
);

// Listen for inferred types updates and propagate to LocalController
// Listen for inferred types updates and propagate to LocalController
// DEPRECATED: RuntimeManager now updates LocalController directly to avoid LongEdit loops.
// appController.onInferredTypesUpdate((inferredTypes) => {
//   localController.updateInferredTypes(inferredTypes, (nodeId) => {
//     return appController.observableState.graph.inner.nodes[nodeId]?.config.typeId;
//   });
// });

// Expose for E2E testing
(window as any).testing = { appController, localController, runtimeManager, workspaceController };


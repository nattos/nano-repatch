import { AppController } from './state';
import { LocalController } from './local-state';
import { RuntimeManager } from '../runtime/manager';
import { WorkspaceController } from './workspace-controller';

import { registerNicePatternUI } from '../customnodes/nicepattern/ui-registration';

import { reaction, toJS } from 'mobx';

// Register UI components for custom nodes (Main thread only)
registerNicePatternUI();

// These are the singleton instances of the controllers that will be used throughout the application.
export const appController = new AppController();
export const localController = new LocalController();
export const runtimeManager = new RuntimeManager(appController, localController);
export const workspaceController = new WorkspaceController(appController);

// React to graph changes to update wire layout
reaction(
  () => toJS(appController.observableState.graph.inner),
  () => {
    localController.updateWireLayout(appController.observableState.graph);
  },
  { fireImmediately: true, delay: 50 } // Debounce slightly to avoid thrashing on drag
);

// Expose for E2E testing
(window as any).testing = { appController, localController, runtimeManager, workspaceController };


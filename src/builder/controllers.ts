import { AppController } from './state';
import { LocalController } from './local-state';
import { RuntimeManager } from '../runtime/manager';
import { WorkspaceController } from './workspace-controller';

import { resolumeManager } from '../io/resolume/manager';
import { reaction, toJS } from 'mobx';

// Register UI components for custom nodes is now handled via index.ts -> registration-ui.ts

// These are the singleton instances of the controllers that will be used throughout the application.
export const appController = new AppController();
export const localController = new LocalController();
export const runtimeManager = new RuntimeManager(appController, localController);
export const workspaceController = new WorkspaceController(appController, localController);

// Initial connection to Resolume
// Initial connection to Resolume (if enabled)
localController.settingsLoaded.then(() => {
  if (localController.observableState.localSettings.enableResolumeIO) {
    resolumeManager.connect();
    runtimeManager.sendResolumeControl('connect');
  }
});

// React to graph changes to update wire layout
reaction(
  () => toJS(appController.observableState.graph.inner),
  () => {
    localController.updateWireLayout(appController.observableState.graph);
  },
  { fireImmediately: true, delay: 50 } // Debounce slightly to avoid thrashing on drag
);

// Expose for E2E testing
if ((import.meta as any).env.DEV) {
  (window as any).testing = { appController, localController, runtimeManager, workspaceController };
}


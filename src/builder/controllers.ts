import { AppController, LocalController } from './state';
import { RuntimeManager } from '../runtime/manager';

// These are the singleton instances of the controllers that will be used throughout the application.
export const appController = new AppController();
export const localController = new LocalController();
export const runtimeManager = new RuntimeManager(appController, localController);

// Expose for E2E testing
(window as any).testing = { appController, localController, runtimeManager };

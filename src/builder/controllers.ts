import { AppController, LocalController } from './state';

// These are the singleton instances of the controllers that will be used throughout the application.
export const appController = new AppController();
export const localController = new LocalController();

// Expose for E2E testing
(window as any).testing = { appController, localController };

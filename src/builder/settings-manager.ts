import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { LocalSettings } from './local-state';

const DB_NAME = 'nano-repatch-settings';
const STORE_NAME = 'settings';
const DB_VERSION = 1;

interface SettingsDB extends DBSchema {
  settings: {
    key: string;
    value: LocalSettings;
  };
}

export class SettingsManager {
  private dbPromise: Promise<IDBPDatabase<SettingsDB>> | null = null;

  constructor() {
    if (typeof indexedDB !== 'undefined' && typeof IDBRequest !== 'undefined') {
      this.dbPromise = openDB<SettingsDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        },
      });
    }
  }

  public async saveSettings(settings: LocalSettings): Promise<void> {
    if (!this.dbPromise) return;
    try {
      const db = await this.dbPromise;
      await db.put(STORE_NAME, settings, 'localSettings');
    } catch (e) {
      console.error('Error saving settings:', e);
    }
  }

  public async loadSettings(): Promise<LocalSettings | null> {
    if (!this.dbPromise) return null;
    try {
      const db = await this.dbPromise;
      return (await db.get(STORE_NAME, 'localSettings')) || null;
    } catch (e) {
      console.error('Error loading settings:', e);
      return null;
    }
  }
}

export const settingsManager = new SettingsManager();

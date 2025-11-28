import { makeAutoObservable } from 'mobx';
import { ResolumeClient, ResolumeWebSocket } from './resolume-client';
import { ResolumeComposition, ResolumeParameter } from './state';
import { ResolumeApiClient } from './resolume';
import { FakeResolumeApiClient } from './fake-resolume-client';

export class ResolumeManager {
  client: ResolumeClient;
  state: ResolumeComposition;
  ws: ResolumeWebSocket | null = null;

  private parameterMap: Map<string, ResolumeParameter> = new Map();
  private subscriptions: Map<string, Set<(value: any) => void>> = new Map();

  constructor(init?: { client: ResolumeClient; }) {
    this.client = init?.client ?? new ResolumeApiClient();
    this.state = new ResolumeComposition();
    makeAutoObservable(this);
  }

  async connect() {
    console.log('[ResolumeManager] Connecting...');
    try {
      const info = await this.client.getProductInfo();
      console.log(`[ResolumeManager] Connected to ${info.name} v${info.major}.${info.minor}`);

      this.ws = this.client.connectWebSocket(
        (data) => this.handleMessage(data),
        (err) => console.error('[ResolumeManager] WS Error:', err),
        () => console.log('[ResolumeManager] WS Closed')
      );
    } catch (e) {
      console.error('[ResolumeManager] Connection failed:', e);
    }
  }

  get isConnected() {
    return !!this.ws;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(data: any) {
    // Initial state (check if it looks like a composition)
    if (data.layers && data.decks) {
      console.log('[ResolumeManager] Received initial state');
      this.state.load(data);
      this.rebuildParameterMap();
    } else if (data.type === 'parameter_update') {
      // Handle update
      // data.id is the param ID.
      // We need to find the parameter in our state.
      // We can use the ID to find it if we map ID -> Param too.
      // For now, let's assume we can find it by path if provided, or we need an ID map.
      const param = this.findParameterById(data.id);
      if (param) {
        param.update(data.value);
        // Notify subscribers
        const subs = this.subscriptions.get(param.path);
        if (subs) {
          subs.forEach(cb => cb(data.value));
        }
      }
    }
  }

  private rebuildParameterMap() {
    this.parameterMap.clear();

    const visit = (obj: any) => {
      if (obj instanceof ResolumeParameter) {
        this.parameterMap.set(obj.path, obj);
      }

      // Recurse
      for (const key in obj) {
        const val = obj[key];
        if (Array.isArray(val)) {
          val.forEach(visit);
        } else if (typeof val === 'object' && val !== null) {
          // Avoid infinite recursion on 'state' or parent refs if any
          if (val instanceof ResolumeParameter || val.constructor.name.startsWith('Resolume')) {
            visit(val);
          }
        }
      }
    };

    visit(this.state);
    console.log(`[ResolumeManager] Indexed ${this.parameterMap.size} parameters`);
  }

  private findParameterById(id: number): ResolumeParameter | undefined {
    // Inefficient linear search, but robust. Optimization: maintain ID map.
    for (const param of this.parameterMap.values()) {
      if (param.id === id) return param;
    }
    return undefined;
  }

  getParameter(path: string): ResolumeParameter | undefined {
    return this.parameterMap.get(path);
  }

  subscribe(path: string, callback: (value: any) => void) {
    if (!this.subscriptions.has(path)) {
      this.subscriptions.set(path, new Set());
    }
    this.subscriptions.get(path)!.add(callback);

    // If first subscriber, send subscribe message to Resolume
    // Note: Fake client expects /parameter/by-id/<id>
    const param = this.getParameter(path);
    if (param && this.ws) {
      // Only send if we haven't already?
      // Actually, fake client handles multiple subs fine.
      // But we need to use the ID format for the fake client.
      this.ws.send({
        action: 'subscribe',
        parameter: `/parameter/by-id/${param.id}`
      });

      // Immediate callback with current value
      callback(param.value);
    } else {
      console.warn(`[ResolumeManager] Cannot subscribe to ${path}: Parameter not found or WS not ready`);
    }
  }

  unsubscribe(path: string, callback: (value: any) => void) {
    const subs = this.subscriptions.get(path);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        this.subscriptions.delete(path);
        // Ideally send unsubscribe to Resolume
      }
    }
  }

  setValue(path: string, value: any) {
    const param = this.getParameter(path);
    if (param && this.ws) {
      this.ws.send({
        action: 'set',
        parameter: `/parameter/by-id/${param.id}`, // Use ID for fake client
        id: param.id,
        value: value
      });
      // Optimistic update?
      // param.update(value); // Wait for ack?
    }
  }
}

export const resolumeManager = new ResolumeManager();

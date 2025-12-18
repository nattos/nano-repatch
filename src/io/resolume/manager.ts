import { makeAutoObservable } from 'mobx';
import { ResolumeClient, ResolumeWebSocket } from './resolume-client';
import { ResolumeComposition, ResolumeParameter } from './state';
import { ResolumeApiClient } from './resolume';
import { FakeResolumeApiClient } from './fake-resolume-client';

export class ResolumeManager {
  client: ResolumeClient;
  state: ResolumeComposition;
  ws: ResolumeWebSocket | null = null;
  isConnecting = false;

  private parameterMap: Map<string, ResolumeParameter> = new Map();
  private subscriptions: Map<string, Map<any, ((value: any) => void) | undefined>> = new Map();

  subscribe(path: string, subscriber: any, callback?: (value: any) => void) {
    if (!this.subscriptions.has(path)) {
      this.subscriptions.set(path, new Map());
    }
    this.subscriptions.get(path)!.set(subscriber, callback);

    // If we are connected and the parameter exists, send subscribe message.
    // If not connected, we will send it when we connect/receive initial state.
    // If parameter doesn't exist yet, we will send it when we rebuild the map.
    const param = this.getParameter(path);
    if (param && this.ws) {
      this.sendSubscription(param);
      // Immediate callback with current value
      if (callback) callback(param.value);
    } else {
      console.log(`[ResolumeManager] Queued subscription for ${path} (Connected: ${!!this.ws}, Param found: ${!!param})`);
    }
  }

  private sendSubscription(param: ResolumeParameter) {
    if (this.ws) {
      this.ws.send({
        action: 'subscribe',
        parameter: `/parameter/by-id/${param.id}`
      });
    }
  }

  unsubscribe(path: string, subscriber: any) {
    const subs = this.subscriptions.get(path);
    if (subs) {
      subs.delete(subscriber);

      if (subs.size === 0) {
        this.subscriptions.delete(path);
        // Ideally send unsubscribe to Resolume
      }
    }
  }

  constructor(init?: { client: ResolumeClient; }) {
    this.client = init?.client ?? new FakeResolumeApiClient();
    this.state = new ResolumeComposition();
    makeAutoObservable(this);
  }

  async connect() {
    if (this.isConnected || this.isConnecting) {
      return;
    }
    this.isConnecting = true;
    console.log('[ResolumeManager] Connecting...');
    try {
      const info = await this.client.getProductInfo();
      console.log(`[ResolumeManager] Connected to ${info.name} v${info.major}.${info.minor}`);

      this.ws = this.client.connectWebSocket(
        (data) => this.handleMessage(data),
        (err) => console.error('[ResolumeManager] WS Error:', err),
        () => {
          console.log('[ResolumeManager] WS Closed');
          this.isConnecting = false;
        }
      );
    } catch (e) {
      console.error('[ResolumeManager] Connection failed:', e);
      this.isConnecting = false;
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
          subs.forEach(cb => {
            if (cb) cb(data.value);
          });
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

    // Re-apply subscriptions for found parameters
    for (const [path, subs] of this.subscriptions.entries()) {
      const param = this.parameterMap.get(path);
      if (param) {
        console.log(`[ResolumeManager] Resubscribing to ${path}`);
        this.sendSubscription(param);
        // Notify with current value
        subs.forEach(cb => {
          if (cb) cb(param.value);
        });
      }
    }
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

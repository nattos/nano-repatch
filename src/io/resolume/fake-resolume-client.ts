// src/io/resolume/fake-resolume-client.ts

import { ResolumeClient, ResolumeWebSocket } from './resolume-client';
import { ProductInfo } from './resolume-client';

// Load the initial state fixture
import initialCompositionState from '../../io/resolume/probe/resolume-ws-initial-state.json';

// Define the structure of the messages we expect to receive and send
interface WebSocketMessage {
  action?: string;
  parameter?: string;
  id?: number;
  value?: any;
}

interface ParameterSubscription {
  id: number;
  path: string;
  callback: (update: any) => void; // A callback to send updates to the client
}

export class FakeResolumeApiClient implements ResolumeClient {
  private currentCompositionState: any;
  private subscribedParameters: Map<number, ParameterSubscription[]>;
  private mockWs: ResolumeWebSocket | null = null;
  private _wsReadyState: number = 0; // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED

  constructor() {
    this.currentCompositionState = JSON.parse(JSON.stringify(initialCompositionState)); // Deep copy
    this.subscribedParameters = new Map();
  }

  // Override getProductInfo to return mock data
  getProductInfo(): Promise<ProductInfo> {
    const mockProductInfo: ProductInfo = {
      name: 'Fake Arena',
      major: 7,
      minor: 18,
      micro: 2,
      revision: 29742,
    };
    return Promise.resolve(mockProductInfo);
  }

  // Override connectWebSocket to simulate WebSocket behavior
  connectWebSocket(
    onMessage: (data: any) => void,
    onError?: (error: any) => void,
    onClose?: (event: any) => void
  ): ResolumeWebSocket {
    console.log('[FakeResolumeApiClient] Simulating WebSocket connection.');
    this._wsReadyState = 1; // OPEN

    const self = this;
    // Simulate WebSocket instance
    this.mockWs = {
      send: (message: object) => {
        console.log('[FakeResolumeApiClient] WS Received:', JSON.stringify(message));
        this.handleIncomingWebSocketMessage(message as WebSocketMessage, onMessage);
      },
      close: () => {
        console.log('[FakeResolumeApiClient] Simulating WS close.');
        this._wsReadyState = 3; // CLOSED
        if (onClose) {
          onClose({ code: 1000, reason: 'Simulated close' });
        }
      },
      get readyState() {
        return self._wsReadyState;
      }
    };

    // Simulate connection opening and sending initial state
    setTimeout(() => {
      console.log('[FakeResolumeApiClient] Sending initial state on WS open...');
      onMessage(this.currentCompositionState);
    }, 100); // Small delay to simulate async behavior

    return this.mockWs;
  }

  // Helper to find a parameter by its path in the nested composition state
  private getParameterByPath(path: string): any | undefined {
    // Path format: /composition/layers/1/video/opacity
    const parts = path.split('/').filter(Boolean); // Remove empty strings from split
    let current: any = this.currentCompositionState; // Start from the root of the fixture

    // Special handling for top-level keys like decks, layers, etc.
    // The fixture is not wrapped in a "composition" key, but has "layers", "decks", etc. directly.
    if (parts[0] === 'composition') {
      parts.shift(); // Remove 'composition' if present, as it's implicit
    }

    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      if (!current) return undefined;

      // Handle "layers/1", "clips/1", etc.
      // We need to find the item with 'id' matching the numeric part.
      // This is a simplification; a real implementation would need to match by name or index too.
      const match = part.match(/^([a-zA-Z]+?)(\d+)$/); // e.g., "layers1", "clips1"
      if (match) {
        const collectionName = match[1]; // e.g., "layers"
        const index = parseInt(match[2], 10) - 1; // Convert to 0-indexed for array access

        // If the collection is named like "layers", look for it in the current object
        if (current[collectionName] && Array.isArray(current[collectionName])) {
          current = current[collectionName][index];
          // After accessing an item in an array like layers[0], the next part is often directly a property of that object.
          // Example: /composition/layers/1/video/opacity
          // After finding layers[0], next part is "video", then "opacity".
        } else {
          // This is complex, as sometimes the ID is part of the path, other times it's an array index
          // For now, let's assume direct access or by ID in array
          const targetId = parseInt(part, 10);
          if (!isNaN(targetId) && Array.isArray(current)) {
            current = current.find((item: any) => item.id === targetId);
          } else if (current[part]) {
            current = current[part];
          } else {
            return undefined;
          }
        }
      } else if (part === 'parameter' && parts[i + 1] === 'by-id') {
        // Special handling for /parameter/by-id/<paramId> for subscriptions
        const paramId = parseInt(parts[i + 2], 10);
        return this.findParameterByIdRecursive(this.currentCompositionState, paramId);
      } else if (current[part]) {
        current = current[part];
      } else if (Array.isArray(current)) {
        // This path part is likely an ID of an element in an array
        const targetId = parseInt(part, 10);
        current = current.find((item: any) => item.id === targetId);
      } else {
        return undefined;
      }
    }
    return current;
  }

  // Recursive helper for getParameterByPath to find parameter by its ID
  private findParameterByIdRecursive(obj: any, id: number): any | undefined {
    if (typeof obj !== 'object' || obj === null) {
      return undefined;
    }
    if (obj.id === id) {
      return obj;
    }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = this.findParameterByIdRecursive(obj[key], id);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }


  private handleIncomingWebSocketMessage(message: WebSocketMessage, onMessageCallback: (data: any) => void) {
    switch (message.action) {
      case 'subscribe': {
        if (message.parameter) {
          const paramIdMatch = message.parameter.match(/\/parameter\/by-id\/(\d+)/);
          if (paramIdMatch) {
            const paramId = parseInt(paramIdMatch[1], 10);
            const parameter = this.findParameterByIdRecursive(this.currentCompositionState, paramId);
            if (parameter) {
              // Simulate subscription confirmation
              const subscriptionMessage = {
                id: parameter.id,
                valuetype: parameter.valuetype,
                value: parameter.value,
                path: `/composition/layers/1/video/opacity`, // Hardcode path for now, need a proper path resolver
                type: 'parameter_subscribed',
              };
              onMessageCallback(subscriptionMessage);

              // Store subscription for future updates
              let subs = this.subscribedParameters.get(paramId);
              if (!subs) {
                subs = [];
                this.subscribedParameters.set(paramId, subs);
              }
              subs.push({ id: paramId, path: subscriptionMessage.path, callback: onMessageCallback });
              console.log(`[FakeResolumeApiClient] Subscribed to parameter ${paramId}`);
            } else {
              onMessageCallback({ error: `Parameter not found for ID: ${paramId}`, path: message.parameter });
            }
          } else {
            onMessageCallback({ error: `Invalid subscribe parameter format: ${message.parameter}` });
          }
        } else {
          onMessageCallback({ error: 'Missing parameter field for subscribe action' });
        }
        break;
      }
      case 'set': {
        if (message.parameter && typeof message.id === 'number' && message.value !== undefined) {
          // Find the parameter by ID and update its value
          const parameter = this.findParameterByIdRecursive(this.currentCompositionState, message.id);
          if (parameter && parameter.valuetype === 'ParamRange') {
            parameter.value = message.value;
            // Simulate parameter update broadcast
            this.notifySubscribers(parameter.id, parameter.value, parameter.valuetype, message.parameter);
            onMessageCallback({ type: 'parameter_set_success', path: message.parameter, value: message.value });
            console.log(`[FakeResolumeApiClient] Parameter ${message.parameter} (ID: ${message.id}) set to ${message.value}`);
          } else if (parameter) {
            onMessageCallback({ error: `Parameter ${message.parameter} (ID: ${message.id}) is not a ParamRange or cannot be set this way.` });
          } else {
            onMessageCallback({ error: `Parameter not found for path: ${message.parameter} ID: ${message.id}` });
          }
        } else {
          onMessageCallback({ error: 'Missing parameter, id, or value fields for set action' });
        }
        break;
      }
      case 'trigger': {
        if (message.parameter && message.value === true) {
          // Find the parameter by path and simulate trigger
          const parameter = this.getParameterByPath(message.parameter);
          if (parameter && parameter.valuetype === 'ParamState') { // Example: connected state
            parameter.value = 'Connected'; // Simulate clip connecting
            this.notifySubscribers(parameter.id, parameter.value, parameter.valuetype, message.parameter);
            onMessageCallback({ type: 'trigger_success', path: message.parameter });
            console.log(`[FakeResolumeApiClient] Triggered ${message.parameter}`);
          } else if (parameter && parameter.valuetype === 'ParamTrigger') {
            // For true ParamTrigger types, no state change, just an event
            onMessageCallback({ type: 'trigger_success', path: message.parameter });
            console.log(`[FakeResolumeApiClient] Triggered event ${message.parameter}`);
          } else {
            onMessageCallback({ error: `Parameter not found or not a trigger for path: ${message.parameter}` });
          }
        } else {
          onMessageCallback({ error: 'Missing parameter or invalid value for trigger action' });
        }
        break;
      }
      default: {
        onMessageCallback({ error: `Unknown action: ${message.action}` });
      }
    }
  }

  private notifySubscribers(paramId: number, value: any, valuetype: string, path: string) {
    const subscribers = this.subscribedParameters.get(paramId);
    if (subscribers) {
      subscribers.forEach(sub => {
        sub.callback({
          id: paramId,
          valuetype: valuetype,
          value: value,
          path: path,
          type: 'parameter_update',
        });
      });
    }
  }
}


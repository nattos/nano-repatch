// src/io/resolume/resolume.ts

import { ResolumeClient, ResolumeWebSocket } from './resolume-client';

// Keep the existing interfaces from the original resolume.ts
export interface ResolumeVersion {
  major: number;
  minor: number;
  micro: number;
  revision: number;
}
export interface ProductInfo extends ResolumeVersion {
  name: string;
}
// ... and so on for all the other interfaces ...


//################################################################################
//## Real API Client Class
//################################################################################

export class RealResolumeApiClient implements ResolumeClient {
  private apiBaseUrl: string;
  private fetch: typeof fetch;
  private WebSocket: typeof WebSocket;

  constructor(
    baseUrl: string = 'http://127.0.0.1:8080',
    customFetch: typeof fetch | null = null,
    customWebSocket: typeof WebSocket | null = null
  ) {
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    this.apiBaseUrl = `${baseUrl}/api/v1`;
    this.fetch = customFetch as typeof fetch;
    this.WebSocket = customWebSocket as typeof WebSocket;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      const url = `${this.apiBaseUrl}${endpoint}`;
      const response = await this.fetch(url, options);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return await response.json() as T;
    } catch (error) {
      console.error(`[RealResolumeApiClient] Error in request: ${error}`);
      throw error;
    }
  }

  getProductInfo(): Promise<ProductInfo> {
    return this.request<ProductInfo>('/product');
  }

  connectWebSocket(
    onMessage: (data: any) => void,
    onError?: (error: any) => void,
    onClose?: (event: any) => void
  ): ResolumeWebSocket {
    const wsUrl = this.apiBaseUrl.replace(/^http/, 'ws');
    const ws = new this.WebSocket(wsUrl) as any;

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        onMessage(data);
      } catch (error) {
        console.error("[RealResolumeApiClient] Error parsing message:", error);
      }
    };

    if (onError) ws.onerror = onError;
    if (onClose) ws.onclose = onClose;
    ws.onopen = () => console.log("[RealResolumeApiClient] Connection established.");

    return {
      send: (message: object) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(message));
        } else {
          console.warn("[RealResolumeApiClient] WebSocket is not open. Message not sent:", message);
        }
      },
      close: () => ws.close(),
      get readyState() {
        return ws.readyState;
      }
    };
  }
}
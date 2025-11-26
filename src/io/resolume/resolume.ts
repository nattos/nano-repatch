// src/io/resolume/resolume.ts

import { ProductInfo, ResolumeClient, ResolumeWebSocket, ResolumeWebSocketMessage } from './resolume-client';

export class ResolumeApiClient implements ResolumeClient {
  private apiBaseUrl: string;
  private customFetch?: typeof fetch;
  private WebSocket: typeof WebSocket;

  constructor(init?: {
    baseUrl?: string,
    customFetch?: typeof fetch,
    customWebSocket?: typeof WebSocket,
  }) {
    let baseUrl = init?.baseUrl ?? 'http://127.0.0.1:8080';
    let customFetch = init?.customFetch;
    let customWebSocket = init?.customWebSocket ?? WebSocket;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    this.apiBaseUrl = `${baseUrl}/api/v1`;
    this.customFetch = customFetch;
    this.WebSocket = customWebSocket;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    try {
      const url = `${this.apiBaseUrl}${endpoint}`;
      const response = await (this.customFetch ?? fetch)(url, options);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return await response.json() as T;
    } catch (error) {
      console.error(`[RealResolumeApiClient] Error in request:`, error);
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
      send: (message: ResolumeWebSocketMessage) => {
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
export interface ResolumeVersion {
  major: number;
  minor: number;
  micro: number;
  revision: number;
}

export interface ProductInfo extends ResolumeVersion {
  name: string;
}

export interface SubscribeMessage {
  action: 'subscribe';
  parameter: string;
}

export interface SetMessage {
  action: 'set';
  parameter: string;
  id: number;
  value: any;
}

export type ResolumeWebSocketMessage = SubscribeMessage | SetMessage;

/**
 * Common interface for both the real and fake Resolume API clients.
 * This allows them to be used interchangeably for testing and production.
 */
export interface ResolumeClient {
  /**
   * Gets product information (name and version).
   */
  getProductInfo(): Promise<ProductInfo>;

  /**
   * Connects to the Resolume WebSocket for real-time updates.
   * @param onMessage A callback function to handle incoming parsed WebSocket messages.
   * @param onError Optional callback for WebSocket errors.
   * @param onClose Optional callback for when the WebSocket closes.
   * @returns A WebSocket-like object with a `send` method for sending JSON messages.
   */
  connectWebSocket(
    onMessage: (data: any) => void,
    onError?: (error: any) => void,
    onClose?: (event: any) => void
  ): ResolumeWebSocket;
}

/**
 * A WebSocket-like interface that includes a method for sending structured JSON.
 */
export interface ResolumeWebSocket {
  /**
   * Sends a JSON message over the WebSocket connection.
   * @param message The JSON object to send.
   */
  send(message: ResolumeWebSocketMessage): void;

  /**
   * Closes the WebSocket connection.
   */
  close(): void;

  /**
   * The current state of the WebSocket connection.
   */
  readonly readyState: number;
}

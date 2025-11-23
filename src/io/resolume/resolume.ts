/**
 * TypeScript interfaces and a client for the Resolume REST API.
 * Based on documentation: https://resolume.com/docs/restapi/
 */

//################################################################################
//## API Interfaces
//################################################################################

export interface ResolumeVersion {
  major: number;
  minor: number;
  micro: number;
  revision: number;
}

export interface ProductInfo extends ResolumeVersion {
  name: string;
}

export interface ArenaVersion extends ResolumeVersion {
  name: string;
}

export interface ServerInfo {
  resolume: ResolumeVersion;
  arena: ArenaVersion;
}

export interface CompositionInfo {
  name: string;
  location: string;
  // Additional properties like width, height, etc. may exist
  width?: number;
  height?: number;
}

/**
 * Common properties for selectable items like Decks, Layers, Clips, Columns
 */
export interface BaseSelectable {
  id: number;
  name: string;
  selected: boolean;
  /** UUID, e.g., "471F151E-C62A-4F3B-8C7F-1A5333F2E788" */
  uuid?: string;
  // Other common properties can be added here
}

export interface Deck extends BaseSelectable {
  /** The currently selected clip ID in this deck */
  selectedclip: number;
  // Decks don't have parameters in the same way, but might have properties
}

export interface Layer extends BaseSelectable {
  bypassed: boolean;
  /** The currently connected clip ID in this layer */
  selectedclip: number;
  /** Array of parameters for this layer */
  params: Parameter[];
  clips: Clip[];
}

export interface Clip extends BaseSelectable {
  /** Connection state: "Empty", "Connected", "Connected & Previewing" */
  connected: "Empty" | "Connected" | "Connected & Previewing" | string;
  /** Array of parameters for this clip */
  params: Parameter[];
  // Other properties like thumbnail, transport, etc.
  thumbnail?: {
    data: string; // Base64 encoded image
  };
}

export interface Column extends BaseSelectable {
  /** Connection state: "Empty", "Connected" */
  connected: "Empty" | "Connected" | string;
}

//--------------------------------------------------------------------------------
//## Parameter Interfaces (Discriminated Union)
//--------------------------------------------------------------------------------

export interface ColorRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * The possible types for a parameter's value when updating.
 */
export type ParamValue = string | number | boolean | ColorRgba;

/**
 * The request body for updating a parameter's value.
 */
export interface ParamValueUpdate {
  value: ParamValue;
}

/**
 * Base interface for all parameter types.
 * The 'valuetype' property is the discriminant.
 */
export interface BaseParam {
  id: string; // Note: Param IDs are strings (UUIDs), not numbers
  name: string;
  valuetype: "Enum" | "Float" | "Color" | "String" | "Boolean" | "Event" | "ParamLink";
  // Common optional properties
  midichannel?: number;
  midicontrol?: number;
}

export interface EnumParam extends BaseParam {
  valuetype: "Enum";
  value: string;
  options: string[];
}

export interface FloatParam extends BaseParam {
  valuetype: "Float";
  value: number;
  /** A two-element array: [min, max] */
  range: [number, number];
}

export interface ColorParam extends BaseParam {
  valuetype: "Color";
  value: ColorRgba;
}

export interface StringParam extends BaseParam {
  valuetype: "String";
  value: string;
}

export interface BooleanParam extends BaseParam {
  valuetype: "Boolean";
  value: boolean;
}

export interface EventParam extends BaseParam {
  valuetype: "Event";
  /** Events don't have a persistent value */
  // value?: never;
}

export interface ParamLinkParam extends BaseParam {
  valuetype: "ParamLink";
  value: string; // This likely holds the ID of the linked param
}

/**
 * A union of all possible parameter types.
 */
export type Parameter =
  | EnumParam
  | FloatParam
  | ColorParam
  | StringParam
  | BooleanParam
  | EventParam
  | ParamLinkParam;

//--------------------------------------------------------------------------------
//## WebSocket Interfaces
//--------------------------------------------------------------------------------

/**
 * The structure of a message from the WebSocket.
 * Example type: "/params/471F151E-C62A-4F3B-8C7F-1A5333F2E788/updated"
 */
export interface WebSocketUpdate {
  type: string;
  value: ParamValue;
}


//################################################################################
//## API Client Class
//################################################################################

export class ResolumeApiClient {
  private apiBaseUrl: string;
  private fetch: typeof fetch;
  private WebSocket: typeof WebSocket;

  /**
   * Creates a new Resolume API client.
   * @param baseUrl The base URL of the Resolume server (e.g., "http://127.0.0.1:8080")
   * @param customFetch Optional fetch implementation for use in Node.js environments.
   * @param customWebSocket Optional WebSocket implementation for use in Node.js environments.
   */
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


  //--------------------------------------------------------------------------------
  //## Private Helper Methods
  //--------------------------------------------------------------------------------

  /**
   * Generic request helper for GET operations.
   * @param endpoint The API endpoint (e.g., "/composition")
   * @param options Optional RequestInit options
   * @returns A promise that resolves to the JSON response
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      const url = `${this.apiBaseUrl}${endpoint}`;
      console.log('fetching', url);
      const response = await this.fetch(url, options);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      // Handle "204 No Content" which has an empty body
      if (response.status === 204) {
        return undefined as T;
      }
      return await response.json() as T;
    } catch (error) {
      console.error(`[ResolumeApiClient] Error in request: ${error}`);
      throw error;
    }
  }

  //--------------------------------------------------------------------------------
  //## Public API Methods
  //--------------------------------------------------------------------------------

  /**
   * Gets product information (name and version).
   */
  getProductInfo(): Promise<ProductInfo> {
    return this.request<ProductInfo>('/product');
  }

  //--------------------------------------------------------------------------------
  //## WebSocket
  //--------------------------------------------------------------------------------

  /**
   * Connects to the Resolume WebSocket for real-time updates.
   * @param onMessage A callback function to handle incoming parsed WebSocket messages
   * @param onError Optional callback for WebSocket errors
   * @param onClose Optional callback for when the WebSocket closes
   * @returns The WebSocket instance
   */
  //--------------------------------------------------------------------------------
  //## WebSocket
  //--------------------------------------------------------------------------------

  /**
   * Connects to the Resolume WebSocket for real-time updates.
   * @param onMessage A callback function to handle incoming parsed WebSocket messages
   * @param onError Optional callback for WebSocket errors
   * @param onClose Optional callback for when the WebSocket closes
   * @returns The WebSocket instance
   */
  connectWebSocket(
    onMessage: (data: any) => void,
    onError?: (error: Event) => void,
    onClose?: (event: CloseEvent) => void
  ): WebSocket {
    const wsUrl = this.apiBaseUrl.replace(/^http/, 'ws');
    const ws = new this.WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        onMessage(data);
      } catch (error) {
        console.error("[ResolumeWebSocket] Error parsing message:", error);
      }
    };

    if (onError) {
      ws.onerror = onError;
    } else {
      ws.onerror = (error) => {
        console.error("[ResolumeWebSocket] Error:", error);
      };
    }

    if (onClose) {
      ws.onclose = onClose;
    } else {
      ws.onclose = (event) => {
        console.log(`[ResolumeWebSocket] Closed: ${event.code} ${event.reason}`);
      };
    }

    ws.onopen = () => {
      console.log("[ResolumeWebSocket] Connection established.");
    };

    return ws;
  }

  /**
   * Sends a JSON message over the WebSocket connection.
   * @param ws The WebSocket instance.
   * @param message The JSON object to send.
   * @param callback An optional callback function to be called when the message is sent.
   */
  sendWebSocketMessage(ws: any, message: object, callback?: (err?: Error) => void): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message), callback);
    } else {
      console.warn("[ResolumeApiClient] WebSocket is not open. Message not sent:", message);
      if (callback) {
        callback(new Error("WebSocket is not open"));
      }
    }
  }
}

/**
 * Example Usage (demonstrates how to use the class)
 *
 * async function example() {
 * try {
 * const client = new ResolumeApiClient("http://127.0.0.1:8080");
 *
 * // 1. Get server info
 * const info = await client.getServerInfo();
 * console.log(`Connected to ${info.arena.name}`);
 *
 * // 2. Get all layers
 * const layers = await client.getLayers();
 * const firstLayer = layers[0];
 * console.log(`First layer: ${firstLayer.name}`);
 *
 * // 3. Get clips for the first layer
 * const clips = await client.getClipsByLayerId(firstLayer.id);
 * const firstClip = clips[0];
 * if (firstClip) {
 * console.log(`First clip: ${firstClip.name}`);
 * * // 4. Trigger the first clip
 * await client.connectClip(firstClip.id);
 * console.log(`Triggered clip ${firstClip.name}`);
 * }
 *
 * // 5. Find and update a parameter (e.g., layer opacity)
 * const opacityParam = firstLayer.params.find(p => p.name === "Opacity");
 * if (opacityParam && opacityParam.valuetype === "Float") {
 * console.log(`Current opacity: ${opacityParam.value}`);
 * * // 6. Set opacity to 50%
 * await client.updateParamValue(opacityParam.id, 0.5);
 * console.log("Set opacity to 0.5");
 * }
 *
 * // 7. Connect to WebSocket
 * client.connectWebSocket((data) => {
 * console.log("WS Update:", data.type, "New Value:", data.value);
 * });
 *
 * } catch (error) {
 * console.error("Failed to connect or interact with Resolume:", error);
 * }
 * }
 *
 * // To run the example:
 * // example();
 */

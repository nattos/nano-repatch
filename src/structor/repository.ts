import { NodeDefinition, Structor, StructorType } from './structor';
import type { GraphState, GridNode } from '../builder/state';

export interface PortHint {
  name: string; // Corresponds to tag. Empty string for default/untagged.
  type: StructorType;
  description?: string;
  // For "virtual inputs"
  defaultValue?: any;
  range?: [number, number];
  step?: number;
  redirect?: 'untagged';
  suppressInputEditor?: boolean;
  alwaysShowInputEditor?: boolean;
  suppressLabel?: boolean;
  allowMultiConnection?: boolean; // Forces collection of all inputs into an array, even if types match.
}

export type InspectorChangeHandler = (config: Partial<GridNode['config']>) => void;
export interface GraphNodeRenderHandlers {
  handleVirtualInputChange: (e: Event, portName: string) => void;
}

// Enum for Region Visibility
export enum RegionVisibility {
  Auto = 'auto',
  Show = 'show',
  Hide = 'hide',
}

export interface NodeType {
  id: string;
  version: string;
  displayName: string;
  aliases?: string[];
  definition: NodeDefinition;
  inputs?: PortHint[];
  outputs?: PortHint[];

  /**
   * A function that compiles the UI-friendly `GridNode.config` object
   * into the `Structor`-formatted `defaultConfig` for a `NodeInstance`.
   * If not provided, the config is assumed to be undefined.
   */
  compileConfig?: (uiConfig: any) => Structor;

  /**
   * A custom Lit-element renderer for the node's body.
   * If not provided, a default renderer is used.
   */
  renderBody?: (node: GridNode, handlers: GraphNodeRenderHandlers) => unknown;

  /**
   * Returns the exact pixel height required for the custom body.
   * If provided, this is used for layout calculations instead of heuristics.
   */
  getBodyHeight?: (node: GridNode) => number;

  /**
   * A custom Lit-element renderer for the node's inspector content.
   */
  renderInspector?: (node: GridNode, onchange: InspectorChangeHandler) => unknown;

  /**
   * Returns the exact pixel height required for the custom inspector editor.
   */
  getInspectorHeight?: (node: GridNode) => number;

  /**
   * A custom Lit-element renderer for a specific input port.
   * Renders in place of the default virtual input when the port is disconnected.
   */
  renderInputEditor?: (node: GridNode, portName: string, handlers: GraphNodeRenderHandlers) => unknown;

  /**
   * Returns the exact pixel height required for the custom input editor.
   */
  getInputEditorHeight?: (node: GridNode, portName: string) => number;

  ui?: {
    body?: () => Promise<(node: GridNode, handlers: GraphNodeRenderHandlers) => unknown>;
    getBodyHeight?: () => Promise<(node: GridNode) => number>;
    inspector?: (() => Promise<(node: GridNode, onchange: InspectorChangeHandler) => unknown>) | { fields: any[] };
    inputEditor?: () => Promise<(node: GridNode, portName: string, handlers: GraphNodeRenderHandlers) => unknown>;
    getInputEditorHeight?: () => Promise<(node: GridNode, portName: string) => number>;
  };

  /**
   * Optional callback to determine the dynamic display label of a node.
   */
  getDisplayLabel?: (uiConfig: any) => string | undefined;

  /**
   * Whether to capture inputs for this node type in the executor.
   */
  inspectInputs?: boolean;

  /**
   * Whether structural changes in the node's config (affecting ports) require a full graph compilation.
   */
  shouldRecompileOnConfigChange?: ((uiConfig: any) => boolean) | ((newConfig: any, oldConfig: any) => boolean);

  /**
   * Optional method to identify child nodes owned by this node (e.g. for spatial groups).
   */
  getChildren?: (node: GridNode, allNodes: Record<string, GridNode>) => string[];

  /**
   * Optional method to define the spatial region associated with this node.
   */
  getRegion?: (uiConfig: any) => {
    x: number;
    y: number;
    width: number;
    height: number;
    visibility: RegionVisibility;
  };
}

export class NodeRepository {
  private nodes = new Map<string, NodeType>();

  register(node: NodeType): void {
    this.nodes.set(node.id, node);
  }

  get(id: string): NodeDefinition | undefined {
    return this.nodes.get(id)?.definition;
  }

  getNodeType(id: string): NodeType | undefined {
    return this.nodes.get(id);
  }

  getAllNodeTypes(): IterableIterator<NodeType> {
    return this.nodes.values();
  }
}

export const defaultNodeRepository = new NodeRepository();
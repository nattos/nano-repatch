import {
  definePrimitiveNode,
  TypedNodeOptions,
  NodeInputsDef,
  NodeConfigDef,
  NodeOutputsDef,
  InferRecord
} from './type-helpers';
import {
  PrimitiveNodeDefinition,
  StructorType,
  ExecutionContext
} from './structor';
import { defaultNodeRepository, PortHint, NodeType } from './repository';

// --- Enhanced Node Definition ---

export type InspectorFieldDef =
  | { type: 'string'; label: string; path: string; placeholder?: string }
  | { type: 'number'; label: string; path: string; min?: number; max?: number; step?: number }
  | { type: 'slider'; label: string; path: string; min: number; max: number; step?: number }
  | { type: 'boolean'; label: string; path: string }
  | { type: 'select'; label: string; path: string; options: { label: string; value: any }[] }
  | { type: 'tab-bar'; label: string; path: string; options: { label: string; value: any }[] };

export interface GenericInspector {
  fields: InspectorFieldDef[];
}

export interface NodeUI {
  inspector?: (() => Promise<any>) | GenericInspector;
  body?: () => Promise<any>;
  getBodyHeight?: () => Promise<any>;
  inputEditor?: () => Promise<any>;
  getInputEditorHeight?: () => Promise<any>;
}

export interface ExtendedInputDef {
  type: StructorType;
  description?: string;
  defaultValue?: any;
  range?: [number, number];
  step?: number;
  suppressInputEditor?: boolean;
  alwaysShowInputEditor?: boolean;
  suppressLabel?: boolean;
  redirect?: string;
  allowMultiConnection?: boolean;
}

export type ExtendedNodeInputsDef = Record<string, StructorType | ExtendedInputDef>;

export interface ExtendedOutputDef {
  type: StructorType;
  description?: string;
}

export type ExtendedNodeOutputsDef = Record<string, StructorType | ExtendedOutputDef>;

export type SimplifyInputs<T extends ExtendedNodeInputsDef> = {
  [K in keyof T]: T[K] extends ExtendedInputDef ? T[K]['type'] : T[K]
} & Record<string, StructorType>;

export type SimplifyOutputs<T extends ExtendedNodeOutputsDef> = {
  [K in keyof T]: T[K] extends ExtendedOutputDef ? T[K]['type'] : T[K]
} & Record<string, StructorType>;

export interface EnhancedNodeOptions<
  TInputs extends ExtendedNodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends ExtendedNodeOutputsDef,
  TState = undefined
> extends Omit<TypedNodeOptions<any, TConfig, any, TState>, 'inputs' | 'outputs' | 'execute'> {
  inputs?: TInputs;
  outputs: TOutputs; // Explicit override
  ui?: NodeUI;
  version?: string;
  displayName?: string;
  aliases?: string[];
  compileConfig?: (uiConfig: any) => any;
  compilePorts?: (node: any, context: any) => { inputs: PortHint[], outputs: PortHint[] };
  getDisplayLabel?: (config: any) => string | undefined;

  inspectInputs?: boolean;
  onMessage?: (state: TState, message: any) => void;

  execute: (
    inputs: InferRecord<{ kind: 'record', fields: SimplifyInputs<TInputs> }>,
    config: InferRecord<{ kind: 'record', fields: TConfig }>,
    context: ExecutionContext,
    state: TState
  ) => InferRecord<{ kind: 'record', fields: SimplifyOutputs<TOutputs> }> | { outputs: InferRecord<{ kind: 'record', fields: SimplifyOutputs<TOutputs> }>; ui?: any };
}

export interface EnhancedNodeDefinition extends PrimitiveNodeDefinition {
  ui?: NodeUI;
  version: string;
  displayName: string;
  aliases?: string[];
  compileConfig?: (uiConfig: any) => any;
  compilePorts?: (node: any, context: any) => { inputs: PortHint[], outputs: PortHint[] };
  getDisplayLabel?: (config: any) => string | undefined;
  extendedInputs?: ExtendedNodeInputsDef;
  extendedOutputs?: ExtendedNodeOutputsDef;

  inspectInputs?: boolean;
  // onMessage is inherited from PrimitiveNodeDefinition
}

export function defineNode<
  TInputs extends ExtendedNodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends ExtendedNodeOutputsDef,
  TState = undefined
>(
  options: EnhancedNodeOptions<TInputs, TConfig, TOutputs, TState>
): EnhancedNodeDefinition {
  // 1. Strip down inputs to NodeInputsDef (just types) for definePrimitiveNode
  const simpleInputs: NodeInputsDef = {};
  for (const [key, val] of Object.entries(options.inputs || {})) {
    if ('kind' in (val as any)) {
      // It's StructorType
      simpleInputs[key] = val as StructorType;
    } else if ('type' in (val as any)) {
      // It's ExtendedInputDef
      const type = (val as ExtendedInputDef).type;
      simpleInputs[key] = { ...type, redirect: (val as ExtendedInputDef).redirect };
    }
  }

  // 2. Strip down outputs to NodeOutputsDef
  const simpleOutputs: NodeOutputsDef = {};
  for (const [key, val] of Object.entries(options.outputs || {})) {
    if ('kind' in (val as any)) {
      simpleOutputs[key] = val as StructorType;
    } else if ('type' in (val as any)) {
      simpleOutputs[key] = (val as ExtendedOutputDef).type;
    }
  }

  const primitiveDef = definePrimitiveNode({
    ...options,
    inputs: simpleInputs,
    outputs: simpleOutputs, // Use stripped outputs
    onMessage: options.onMessage
  } as unknown as TypedNodeOptions<any, TConfig, any, TState>);
  // Cast to unknown first to avoid incompatibility issues with Simplify types vs constraints

  return {
    ...primitiveDef,
    ui: options.ui,
    version: options.version || '1.0.0',
    displayName: options.displayName || options.id,
    aliases: options.aliases,
    compileConfig: options.compileConfig,
    compilePorts: options.compilePorts,
    getDisplayLabel: options.getDisplayLabel,
    extendedInputs: options.inputs,
    extendedOutputs: options.outputs,

    inspectInputs: options.inspectInputs
  };
}

// --- Registration Helper ---

export function registerNode(def: EnhancedNodeDefinition) {
  const inputs: PortHint[] = Object.entries(def.extendedInputs || {}).map(([name, val]: [string, any]) => {
    const isExtended = 'type' in val && typeof (val as any).type === 'object' && 'kind' in (val as any).type;
    const type = isExtended ? val.type : val;
    return {
      name,
      type,
      description: isExtended ? val.description : undefined,
      defaultValue: isExtended ? val.defaultValue : undefined,
      range: isExtended ? val.range : undefined,
      step: isExtended ? val.step : undefined,
      suppressInputEditor: isExtended ? val.suppressInputEditor : undefined,
      alwaysShowInputEditor: isExtended ? val.alwaysShowInputEditor : undefined,
      suppressLabel: isExtended ? val.suppressLabel : undefined,
      redirect: isExtended ? val.redirect : undefined,
      allowMultiConnection: isExtended ? val.allowMultiConnection : undefined,
    };
  });

  const outputs: PortHint[] = Object.entries(def.extendedOutputs || {}).map(([name, val]: [string, any]) => {
    const isExtended = 'type' in val && typeof (val as any).type === 'object' && 'kind' in (val as any).type;
    const type = isExtended ? val.type : val;
    return {
      name,
      type,
      description: isExtended ? val.description : undefined,
      suppressLabel: isExtended ? val.suppressLabel : undefined,
    };
  });

  const nodeType: NodeType = {
    id: def.id,
    version: def.version,
    displayName: def.displayName,
    aliases: def.aliases,
    definition: def,
    inputs,
    outputs,
    compileConfig: def.compileConfig,
    compilePorts: def.compilePorts,
    getDisplayLabel: def.getDisplayLabel,

    inspectInputs: def.inspectInputs,
  };

  // If UI is provided, we need to hook it up.
  // Since we can't import Lit here, we can attach the loaders to the NodeType
  // and let the View layer (GraphNode) handle the loading.
  // We need to extend NodeType interface to support `ui` property.
  // For now, we cast to any or augment the type.
  (nodeType as any).ui = def.ui;

  defaultNodeRepository.register(nodeType);
}

export function getNodeDisplayName(nodeConfig: any, nodeType: NodeType | undefined): string {
  const name = nodeConfig.name;
  const typeId = nodeConfig.typeId;

  if (!nodeType) {
    // Fallback if node type validation is not available
    const isDefault = !name || name === '#';
    if (isDefault) return typeId;

    // Attempt hash replacement with typeId
    if (name && name.includes('#')) {
      return name.replace(/#/g, typeId);
    }

    return name;
  }

  // If user explicitly clears the name, it might be empty string.
  // We treat empty string as "use default dynamic label".
  // The special value "#" also means "use default dynamic label".

  const isDefault = !name || name === '#';
  const hasHash = name && name.includes('#');

  if (isDefault) {
    // Attempt dynamic label
    if (nodeType.getDisplayLabel) {
      const dynamic = nodeType.getDisplayLabel(nodeConfig);
      if (dynamic) return dynamic;
    }
    // Fallback to static display name
    return nodeType.displayName;
  }

  if (hasHash) {
    // Replace hash with dynamic label
    const dynamic = nodeType.getDisplayLabel ? nodeType.getDisplayLabel(nodeConfig) : nodeType.displayName;
    return name.replace(/#/g, dynamic || nodeType.displayName);
  }

  return name;
}

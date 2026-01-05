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
  ExecutionContext,
  RecordType,
  AnalysisContext,
  TypedBroadcastChannel
} from './structor';
import { defaultNodeRepository, PortHint, NodeType } from './repository';
import { UIConfigStructorType } from './std-types';
import type { GridNode } from '../builder/state';

// --- Enhanced Node Definition ---

export type InspectorFieldDef =
  | { type: 'string'; label: string; path: string; placeholder?: string; default?: string }
  | { type: 'number'; label: string; path: string; min?: number; max?: number; step?: number; default?: number }
  | { type: 'slider'; label: string; path: string; min: number; max: number; step?: number; default?: number }
  | { type: 'boolean'; label: string; path: string; default?: boolean }
  | { type: 'select'; label: string; path: string; options: { label: string; value: any }[]; default?: any }
  | { type: 'select'; label: string; path: string; options: { label: string; value: any }[]; default?: any }
  | { type: 'structor-type'; label: string; path: string; default?: UIConfigStructorType }
  | { type: 'tab-bar'; label: string; path: string; options: { label: string; value: any }[]; default?: any }
  | { type: 'button'; label: string; path: string; text?: string };

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
  suppressLabel?: boolean;
  suppressInputEditor?: boolean;
}

export type ExtendedNodeOutputsDef = Record<string, StructorType | ExtendedOutputDef>;


export type AutoBroadcastDef = boolean | Record<string, Partial<TypedBroadcastChannel>>;

export type SimplifyInputs<
  T extends ExtendedNodeInputsDef,
  TBroadcast extends AutoBroadcastDef | undefined = undefined
> = {
  [K in keyof T]: T[K] extends ExtendedInputDef
  ? (
    // Check for flatten in broadcast config
    (TBroadcast extends Record<string, any>
      ? (K extends keyof TBroadcast
        ? (TBroadcast[K]['combine'] extends { reduce: 'flatten' } ? true : false)
        : false)
      : false
    ) extends true
    ? T[K]['type'] // Flattened -> Base type
    : (
      T[K]['allowMultiConnection'] extends true
      ? { kind: 'array', size: 'dynamic', element: T[K]['type'] }
      : T[K]['type']
    )
  )
  : T[K]
} & Record<string, StructorType>;

export type SimplifyOutputs<T extends ExtendedNodeOutputsDef> = {
  [K in keyof T]: T[K] extends ExtendedOutputDef ? T[K]['type'] : T[K]
} & Record<string, StructorType>;

export interface EnhancedNodeOptions<
  TInputs extends ExtendedNodeInputsDef,
  TUIConfig extends Record<string, any> | any, // Allow strict structural typing
  TCompiledConfig extends NodeConfigDef,
  TOutputs extends ExtendedNodeOutputsDef,
  TState = undefined,
  TAutoBroadcast extends AutoBroadcastDef | undefined = undefined
> extends Omit<TypedNodeOptions<any, TCompiledConfig, any, TState>, 'inputs' | 'outputs' | 'execute' | 'computeForwardPorts' | 'computeBackwardPorts' | 'config' | 'shouldRecompileOnConfigChange' | 'getDisplayLabel' | 'autoBroadcast'> { // Exclude config to redefine it
  inputs?: TInputs;
  autoBroadcast?: TAutoBroadcast; // Explicit override
  outputs: TOutputs; // Explicit override
  dynamicOutputType?: StructorType;
  ui?: NodeUI;
  version?: string;
  displayName?: string;
  aliases?: string[];
  compileConfig?: (uiConfig: TUIConfig) => any; // Returns TCompiledConfig (raw values struct) or just any
  getDisplayLabel?: (uiConfig: TUIConfig) => string | undefined;
  subgraphExpansionTag?: string;

  inspectInputs?: boolean;
  onMessage?: (state: TState, message: any) => void;
  shouldRecompileOnConfigChange?: (uiConfig: TUIConfig) => boolean;

  // Re-declare with explicit names
  computeForwardPorts?: (
    inputTypes: RecordType,
    uiConfig: TUIConfig, // Use UI Config here
    context: AnalysisContext,
    backwardMetadata?: any,
  ) => { inputs: RecordType; outputs: RecordType };

  computeBackwardPorts?: (
    outputRequirements: RecordType,
    uiConfig: TUIConfig,
    context: AnalysisContext,
  ) => {
    inputRequirements: RecordType;
    backwardMetadata?: any;
  };

  // NOTE: This config property is used to define the schema of the COMPILED config for runtime validation/marshaling
  config?: TCompiledConfig;

  execute: (
    inputs: InferRecord<{ kind: 'record', fields: SimplifyInputs<TInputs, TAutoBroadcast> }>,
    config: InferRecord<{ kind: 'record', fields: TCompiledConfig }>, // This is the compiled runtime config
    context: ExecutionContext,
    state: TState
  ) => InferRecord<{ kind: 'record', fields: SimplifyOutputs<TOutputs> }> | { outputs: InferRecord<{ kind: 'record', fields: SimplifyOutputs<TOutputs> }>; ui?: any };

  getChildren?: (node: GridNode, allNodes: Record<string, GridNode>) => string[];
  getRegion?: (config: TUIConfig) => { x: number; y: number; width: number; height: number };
}

export interface EnhancedNodeDefinition extends PrimitiveNodeDefinition {
  ui?: NodeUI;
  version: string;
  displayName: string;
  aliases?: string[];
  compileConfig?: (uiConfig: any) => any;
  getDisplayLabel?: (uiConfig: any) => string | undefined;
  subgraphExpansionTag?: string; // Inherited from PrimitiveNodeDefinition but explicit here for clarity if needed
  extendedInputs?: ExtendedNodeInputsDef;
  extendedOutputs?: ExtendedNodeOutputsDef;

  inspectInputs?: boolean;
  shouldRecompileOnConfigChange?: ((uiConfig: any) => boolean) | ((newConfig: any, oldConfig: any) => boolean);
  // onMessage is inherited from PrimitiveNodeDefinition
  getChildren?: (node: GridNode, allNodes: Record<string, GridNode>) => string[];
  getRegion?: (config: any) => { x: number; y: number; width: number; height: number };
}

export function defineNode<
  const TInputs extends ExtendedNodeInputsDef,
  TUIConfig extends Record<string, any> | any = any,
  TCompiledConfig extends NodeConfigDef = any,
  TOutputs extends ExtendedNodeOutputsDef = ExtendedNodeOutputsDef,
  TState = undefined,
  const TAutoBroadcast extends AutoBroadcastDef | undefined = undefined
>(
  options: EnhancedNodeOptions<TInputs, TUIConfig, TCompiledConfig, TOutputs, TState, TAutoBroadcast>
): EnhancedNodeDefinition {
  // 1. Strip down inputs to NodeInputsDef (just types) for definePrimitiveNode
  const simpleInputs: NodeInputsDef = {};
  for (const [key, val] of Object.entries(options.inputs || {})) {
    if ('kind' in (val as any)) {
      // It's StructorType
      simpleInputs[key] = val as StructorType;
    } else if ('type' in (val as any)) {
      // It's ExtendedInputDef
      const ext = val as ExtendedInputDef;
      const type = ext.type;
      const inputType = ext.allowMultiConnection
        ? { kind: 'array', size: 'dynamic', element: type } as StructorType
        : type;

      simpleInputs[key] = {
        ...inputType,
        redirect: ext.redirect,
        defaultValue: 'defaultValue' in ext ? ext.defaultValue : (type as any).defaultValue
      };
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
    autoBroadcast: options.autoBroadcast,
    inputs: simpleInputs,
    outputs: simpleOutputs, // Use stripped outputs
    computeForwardPorts: (inputTypes: any, config: any, context: any, backwardMetadata?: any) => {
      // Config here is coming from the Graph/Builder, so it is UIConfig
      if (options.computeForwardPorts) {
        return options.computeForwardPorts(inputTypes, config, context, backwardMetadata);
      }
      return {
        // Return static definition for inputs and outputs.
        inputs: { kind: 'record', fields: simpleInputs },
        outputs: { kind: 'record', fields: simpleOutputs }
      };
    },
    // Same for Backward
    computeBackwardPorts: (outputRequirements: any, config: any, context: any) => {
      if (options.computeBackwardPorts) {
        return options.computeBackwardPorts(outputRequirements, config, context);
      }
      return { inputRequirements: { kind: 'record', fields: {} } };
    },
    onMessage: options.onMessage,
    config: options.config // Pass the Compiled config schema
  } as unknown as TypedNodeOptions<any, TCompiledConfig, any, TState>);
  // Cast to unknown first to avoid incompatibility issues with Simplify types vs constraints

  return {
    ...primitiveDef,
    ui: options.ui,
    version: options.version || '1.0.0',
    displayName: options.displayName || options.id,
    aliases: options.aliases,
    compileConfig: options.compileConfig,
    getDisplayLabel: options.getDisplayLabel,
    subgraphExpansionTag: options.subgraphExpansionTag,
    extendedInputs: options.inputs,
    extendedOutputs: options.outputs,

    inspectInputs: options.inspectInputs,
    shouldRecompileOnConfigChange: options.shouldRecompileOnConfigChange,
    getChildren: options.getChildren,
    getRegion: options.getRegion
  };
}

// --- Registration Helper ---

export function registerNode(def: EnhancedNodeDefinition) {
  const inputsSource = def.extendedInputs || (def.inputs as any) || {};
  const inputs: PortHint[] = Object.entries(inputsSource).map(([name, val]: [string, any]) => {
    const isExtended = 'type' in val && typeof (val as any).type === 'object' && 'kind' in (val as any).type;


    const type = isExtended ? val.type : val;
    return {
      name,
      type,
      description: isExtended ? val.description : undefined,
      defaultValue: isExtended ? val.defaultValue : undefined,
      range: isExtended ? val.range : undefined,
      step: isExtended ? val.step : undefined,
      suppressInputEditor: isExtended ? val.suppressInputEditor : (type.kind === 'atomic' && type.type === 'any' ? true : undefined),
      alwaysShowInputEditor: isExtended ? val.alwaysShowInputEditor : undefined,
      suppressLabel: isExtended ? val.suppressLabel : undefined,
      redirect: isExtended ? val.redirect : undefined,
      allowMultiConnection: isExtended ? val.allowMultiConnection : undefined,
    };
  });

  const outputsSource = def.extendedOutputs || (def.outputs as any) || {};
  const outputs: PortHint[] = Object.entries(outputsSource).map(([name, val]: [string, any]) => {
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
    version: def.version || '1.0.0',
    displayName: def.displayName || def.id,
    aliases: def.aliases,
    definition: def,
    inputs,
    outputs,
    compileConfig: def.compileConfig,
    getDisplayLabel: def.getDisplayLabel,

    inspectInputs: def.inspectInputs,
    shouldRecompileOnConfigChange: def.shouldRecompileOnConfigChange,
    getChildren: def.getChildren,
    getRegion: def.getRegion,
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

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

export interface NodeUI {
  inspector?: () => Promise<any>;
  body?: () => Promise<any>;
  getBodyHeight?: () => Promise<any>;
  inputEditor?: () => Promise<any>;
}

export interface ExtendedInputDef {
  type: StructorType;
  description?: string;
  defaultValue?: any;
  range?: [number, number];
  suppressInputEditor?: boolean;
  suppressLabel?: boolean;
}

export type ExtendedNodeInputsDef = Record<string, StructorType | ExtendedInputDef>;

export interface EnhancedNodeOptions<
  TInputs extends ExtendedNodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends NodeOutputsDef,
  TState = undefined
> extends Omit<TypedNodeOptions<any, TConfig, TOutputs, TState>, 'inputs'> {
  inputs?: TInputs;
  ui?: NodeUI;
  version?: string;
  displayName?: string;
  aliases?: string[];
  compileConfig?: (uiConfig: any) => any;
  getPorts?: (node: any, loadedSubgraphs?: Map<string, any>) => { inputs: PortHint[]; outputs: PortHint[]; displayName?: string; } | null;
}

export interface EnhancedNodeDefinition extends PrimitiveNodeDefinition {
  ui?: NodeUI;
  version: string;
  displayName: string;
  aliases?: string[];
  compileConfig?: (uiConfig: any) => any;
  extendedInputs?: ExtendedNodeInputsDef;
  extendedOutputs?: NodeOutputsDef;
  getPorts?: (node: any, loadedSubgraphs?: Map<string, any>) => { inputs: PortHint[]; outputs: PortHint[]; displayName?: string; } | null;
}

export function defineNode<
  TInputs extends ExtendedNodeInputsDef,
  TConfig extends NodeConfigDef,
  TOutputs extends NodeOutputsDef,
  TState = undefined
>(
  options: EnhancedNodeOptions<TInputs, TConfig, TOutputs, TState>
): EnhancedNodeDefinition {
  // 1. Strip down inputs to NodeInputsDef (just types) for definePrimitiveNode
  const simpleInputs: NodeInputsDef = {};
  for (const [key, val] of Object.entries(options.inputs || {})) {
    if ('kind' in val) {
       // It's StructorType
       simpleInputs[key] = val as StructorType;
    } else if ('type' in val) {
       // It's ExtendedInputDef
       simpleInputs[key] = (val as ExtendedInputDef).type;
    }
  }

  const primitiveDef = definePrimitiveNode({
    ...options,
    inputs: simpleInputs
  } as TypedNodeOptions<any, TConfig, TOutputs, TState>);

  return {
    ...primitiveDef,
    ui: options.ui,
    version: options.version || '1.0.0',
    displayName: options.displayName || options.id,
    aliases: options.aliases,
    compileConfig: options.compileConfig,
    extendedInputs: options.inputs,
    extendedOutputs: options.outputs,
    getPorts: options.getPorts
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
      suppressInputEditor: isExtended ? val.suppressInputEditor : undefined,
      suppressLabel: isExtended ? val.suppressLabel : undefined,
    };
  });

  const outputs: PortHint[] = Object.entries(def.extendedOutputs || {}).map(([name, type]: [string, any]) => ({
    name,
    type,
    // Outputs currently don't use ExtendedInputDef, but could in future
  }));

  const nodeType: NodeType = {
    id: def.id,
    version: def.version,
    displayName: def.displayName,
    aliases: def.aliases,
    definition: def,
    inputs,
    outputs,
    compileConfig: def.compileConfig,
    getPorts: def.getPorts,
  };

  // If UI is provided, we need to hook it up.
  // Since we can't import Lit here, we can attach the loaders to the NodeType
  // and let the View layer (GraphNode) handle the loading.
  // We need to extend NodeType interface to support `ui` property.
  // For now, we cast to any or augment the type.
  (nodeType as any).ui = def.ui;

  defaultNodeRepository.register(nodeType);
}

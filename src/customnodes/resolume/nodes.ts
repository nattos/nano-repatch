import { defineNode, registerNode, InspectorFieldDef } from '../../structor/node-helpers';
import { defineType } from '../../structor/type-helpers';
// import { resolumeManager } from '../../io/resolume/manager'; // Removed to break circular dependency
import { NodeCategory } from '../../structor/structor';
import { numberType } from '../../structor/std-types';

const anyType = defineType({ kind: 'atomic', type: 'any' });
const stringType = defineType({ kind: 'atomic', type: 'string' });

const ResolumeFields: InspectorFieldDef[] = [
  { type: 'string', label: 'Path', path: 'path', placeholder: '/composition/...' }
];

export const resolumeInputNode = defineNode({
  id: 'resolume.input',
  version: '1.0.0',
  displayName: 'Resolume Input',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['resolume', 'arena', 'parameter', 'read'],
    description: 'Reads a parameter value from Resolume Arena.'
  },
  inputs: {},
  config: {
    path: stringType
  },
  outputs: {
    value: { type: numberType, suppressLabel: true }
  },
  autoBroadcast: false,
  isRealtime: () => true, // Inputs change over time
  ui: { inspector: { fields: ResolumeFields } },
  getDisplayLabel: (uiConfig) => {
    if (!uiConfig.path) return undefined;
    const parts = uiConfig.path.split('/');
    return parts[parts.length - 1] || uiConfig.path;
  },

  createState: (config, context) => {
    // Initial state
    const state = {
      value: 0 as any,
      unsubscribe: () => { },
      currentPath: config.path,
      callback: (val: any) => { }
    };

    state.callback = (val: any) => {
      state.value = val;
    };

    const resolume = context.resolume;

    if (config.path && resolume) {
      resolume.subscribe(config.path, state.callback, state.callback);
      state.unsubscribe = () => resolume.unsubscribe(config.path, state.callback);
    }

    return state;
  },

  execute: (inputs, config, context, state) => {
    // Check for path change
    if (config.path !== state.currentPath) {
      // Unsubscribe from old
      if (state.currentPath) {
        state.unsubscribe();
      }

      state.currentPath = config.path;

      // Subscribe to new
      const resolume = context.resolume;
      if (config.path && resolume) {
        resolume.subscribe(config.path, state.callback);
        state.unsubscribe = () => resolume.unsubscribe(config.path, state.callback);
      }
    }

    return { value: state?.value ?? 0 };
  },
  compileConfig: (uiConfig) => ({
    fields: {
      path: uiConfig?.path ?? '',
    },
    untagged: [],
  }),
});

export const resolumeOutputNode = defineNode({
  id: 'resolume.output',
  version: '1.0.0',
  displayName: 'Resolume Output',
  metadata: {
    category: NodeCategory.IO,
    keywords: ['resolume', 'arena', 'parameter', 'write'],
    description: 'Writes a value to a Resolume Arena parameter.'
  },
  inputs: {
    value: { type: anyType, suppressInputEditor: true, suppressLabel: true, }
  },
  config: {
    path: stringType
  },
  outputs: {},
  autoBroadcast: true,
  ui: { inspector: { fields: ResolumeFields } },
  getDisplayLabel: (uiConfig) => {
    if (!uiConfig.path) return undefined;
    const parts = uiConfig.path.split('/');
    return parts[parts.length - 1] || uiConfig.path;
  },

  createState: (config, context) => {
    return { lastValue: undefined as any };
  },

  execute: (inputs, config, context, state) => {
    if (config.path && inputs.value !== undefined) {
      const newValue = inputs.value;
      const lastValue = state.lastValue;

      let changed = false;

      if (typeof newValue === 'number' && typeof lastValue === 'number') {
        if (Math.abs(newValue - lastValue) > 1e-5) {
          changed = true;
        }
      } else if (newValue !== lastValue) {
        changed = true;
      }

      const resolume = context.resolume;
      if (changed && resolume) {
        resolume.setValue(config.path, newValue);
        state.lastValue = newValue;
      }
    }
    return {};
  },
  compileConfig: (uiConfig) => ({
    fields: {
      path: uiConfig?.path ?? '',
    },
    untagged: [],
  }),
});

registerNode(resolumeInputNode);
registerNode(resolumeOutputNode);

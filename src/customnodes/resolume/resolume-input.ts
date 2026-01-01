import { defineNode, registerNode, InspectorFieldDef } from '../../structor/node-helpers';
import { defineType, StringType } from '../../structor/type-helpers';
// import { resolumeManager } from '../../io/resolume/manager'; // Checked: removed in origin file too
import { NodeCategory } from '../../structor/structor';
import { numberType } from '../../structor/std-types';

const ResolumeFields: InspectorFieldDef[] = [
  { type: 'string', label: 'Path', path: 'path', placeholder: '/composition/...' }
];

interface ResolumeInputState {
  value: any;
  unsubscribe: () => void;
  currentPath?: string;
  callback: (val: any) => void;
}

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
    path: StringType
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

  createState: (config, context): ResolumeInputState => {
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
    // using strict inference
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
  compileConfig: (uiConfig: { path?: string }) => ({
    path: uiConfig.path ?? ''
  }),
});

registerNode(resolumeInputNode);

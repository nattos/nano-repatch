import { defineNode, registerNode, InspectorFieldDef } from '../../structor/node-helpers';
import { defineType, StringType } from '../../structor/type-helpers';
// import { resolumeManager } from '../../io/resolume/manager';
import { NodeCategory } from '../../structor/structor';

const anyType = defineType({ kind: 'atomic', type: 'any' });

const ResolumeFields: InspectorFieldDef[] = [
  { type: 'string', label: 'Path', path: 'path', placeholder: '/composition/...' }
];

interface ResolumeOutputState {
  lastValue: any;
}

export const resolumeOutputNode = defineNode<any, { path?: string }, { path: typeof StringType }, any, ResolumeOutputState>({
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
    path: StringType
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
    path: uiConfig.path ?? ''
  }),
});

registerNode(resolumeOutputNode);

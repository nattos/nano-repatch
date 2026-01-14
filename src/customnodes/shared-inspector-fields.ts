
import { InspectorFieldDef } from "../structor/node-helpers";

export const TimeBaseModeField: InspectorFieldDef = {
  type: 'tab-bar',
  label: 'Mode',
  path: 'mode',
  options: [
    { label: 'Time', value: 'time' },
    { label: 'Beats', value: 'beats' }
  ],
  default: 'time'
};

export const BeatDenomField: InspectorFieldDef = {
  type: 'tab-bar',
  label: 'Beat Denom',
  path: 'beatDenom',
  options: [
    { label: '1/64', value: 0.015625 },
    { label: '1/32', value: 0.03125 },
    { label: '1/16', value: 0.0625 },
    { label: '1/8', value: 0.125 },
    { label: '1/4', value: 0.25 },
    { label: '1/2', value: 0.5 },
    { label: '1/1', value: 1.0 },
  ],
  default: 0.25 // Quarter note default
};

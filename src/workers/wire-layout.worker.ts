
import { computeWireLayout } from '../layout/wire-layout';
import { WiringWorkerMessage, WiringMainMessage } from './types';

const ctx: Worker = self as any;

ctx.onmessage = (event: MessageEvent<WiringWorkerMessage>) => {
  const { type, wires, options } = event.data;

  if (type === 'LAYOUT_REQUEST') {
    const layout = computeWireLayout(wires, options);

    const response: WiringMainMessage = {
      type: 'LAYOUT_RESULT',
      layout
    };

    ctx.postMessage(response);
  }
};

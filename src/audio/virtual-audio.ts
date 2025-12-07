// Virtual Audio Context for Web Workers
// Records commands to be executed on the main thread

export type AudioCommand =
  | { type: 'createOscillator'; id: string }
  | { type: 'createGain'; id: string }
  | { type: 'createBiquadFilter'; id: string }
  | { type: 'connect'; sourceId: string; destId: string; input?: number; output?: number }
  | { type: 'disconnect'; sourceId: string }
  | { type: 'start'; id: string; time: number }
  | { type: 'stop'; id: string; time: number }
  | { type: 'setParamValue'; id: string; param: string; value: number; time: number }
  | { type: 'linearRampToValueAtTime'; id: string; param: string; value: number; time: number }
  | { type: 'exponentialRampToValueAtTime'; id: string; param: string; value: number; time: number }
  | { type: 'setTargetAtTime'; id: string; param: string; target: number; startTime: number; timeConstant: number }
  | { type: 'cancelScheduledValues'; id: string; param: string; time: number }
  | { type: 'setNodeProperty'; id: string; property: string; value: any }
  | { type: 'dispose'; id: string }
  | { type: 'clear' };

export class VirtualAudioParam {
  constructor(
    private context: VirtualAudioContext,
    private nodeId: string,
    private paramName: string
  ) { }

  setValueAtTime(value: number, startTime: number) {
    const delay = Math.max(0, startTime - this.context.currentTime);
    this.context.addCommand({
      type: 'setParamValue',
      id: this.nodeId,
      param: this.paramName,
      value,
      time: delay
    });
  }

  linearRampToValueAtTime(value: number, endTime: number) {
    const delay = Math.max(0, endTime - this.context.currentTime);
    this.context.addCommand({
      type: 'linearRampToValueAtTime',
      id: this.nodeId,
      param: this.paramName,
      value,
      time: delay
    });
  }

  exponentialRampToValueAtTime(value: number, endTime: number) {
    const delay = Math.max(0, endTime - this.context.currentTime);
    this.context.addCommand({
      type: 'exponentialRampToValueAtTime',
      id: this.nodeId,
      param: this.paramName,
      value,
      time: delay
    });
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number) {
    const delay = Math.max(0, startTime - this.context.currentTime);
    this.context.addCommand({
      type: 'setTargetAtTime',
      id: this.nodeId,
      param: this.paramName,
      target,
      startTime: delay,
      timeConstant
    });
  }

  cancelScheduledValues(startTime: number) {
    const delay = Math.max(0, startTime - this.context.currentTime);
    this.context.addCommand({
      type: 'cancelScheduledValues',
      id: this.nodeId,
      param: this.paramName,
      time: delay
    });
  }
}

export class VirtualAudioNode {
  constructor(public id: string, protected context: VirtualAudioContext) { }

  connect(destination: VirtualAudioNode) {
    this.context.addCommand({
      type: 'connect',
      sourceId: this.id,
      destId: destination.id
    });
  }

  disconnect() {
    this.context.addCommand({
      type: 'disconnect',
      sourceId: this.id
    });
  }

  dispose() {
    this.context.addCommand({
      type: 'dispose',
      id: this.id
    });
  }
}

export class VirtualOscillatorNode extends VirtualAudioNode {
  frequency: VirtualAudioParam;

  constructor(id: string, context: VirtualAudioContext) {
    super(id, context);
    this.frequency = new VirtualAudioParam(context, id, 'frequency');
  }

  set type(value: string) {
    this.context.addCommand({
      type: 'setNodeProperty',
      id: this.id,
      property: 'type',
      value
    });
  }

  start(time: number = 0) {
    const delay = Math.max(0, time - this.context.currentTime);
    this.context.addCommand({ type: 'start', id: this.id, time: delay });
  }

  stop(time: number = 0) {
    const delay = Math.max(0, time - this.context.currentTime);
    this.context.addCommand({ type: 'stop', id: this.id, time: delay });
  }
}

export class VirtualGainNode extends VirtualAudioNode {
  gain: VirtualAudioParam;

  constructor(id: string, context: VirtualAudioContext) {
    super(id, context);
    this.gain = new VirtualAudioParam(context, id, 'gain');
  }
}

export class VirtualBiquadFilterNode extends VirtualAudioNode {
  frequency: VirtualAudioParam;

  constructor(id: string, context: VirtualAudioContext) {
    super(id, context);
    this.frequency = new VirtualAudioParam(context, id, 'frequency');
  }

  set type(value: string) {
    this.context.addCommand({
      type: 'setNodeProperty',
      id: this.id,
      property: 'type',
      value
    });
  }
}

export class VirtualAudioContext {
  private commands: AudioCommand[] = [];
  private nodeCount = 0;
  public destination: VirtualAudioNode;
  public state: 'suspended' | 'running' | 'closed' = 'running';

  // We need a way to sync time. For now, we'll rely on the main thread to handle relative timing
  // or we pass a simulated time.
  // ToneSynthLayer uses ctx.currentTime.
  // We can let the worker track its own time or receive it.
  public currentTime: number = 0;

  // We need a way to track context lifetime to invalidate node states on reset
  public contextId: string = Math.random().toString(36).slice(2);

  constructor() {
    this.destination = new VirtualAudioNode('destination', this);
  }

  createOscillator() {
    const id = `osc-${this.nodeCount++}`;
    this.addCommand({ type: 'createOscillator', id });
    return new VirtualOscillatorNode(id, this);
  }

  createGain() {
    const id = `gain-${this.nodeCount++}`;
    this.addCommand({ type: 'createGain', id });
    return new VirtualGainNode(id, this);
  }

  createBiquadFilter() {
    const id = `filter-${this.nodeCount++}`;
    this.addCommand({ type: 'createBiquadFilter', id });
    return new VirtualBiquadFilterNode(id, this);
  }

  addCommand(command: AudioCommand) {
    this.commands.push(command);
  }

  flushCommands() {
    const cmds = this.commands;
    this.commands = [];
    return cmds;
  }

  reset() {
      // Clear all pending commands
      this.commands = [];
      // Issue a clear command to the renderer
      this.addCommand({ type: 'clear' });
      // Reset local counters
      this.nodeCount = 0;
      // Generate new context ID
      this.contextId = Math.random().toString(36).slice(2);
  }
}

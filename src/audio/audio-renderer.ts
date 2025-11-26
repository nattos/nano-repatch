import { AudioCommand } from './virtual-audio';

export class AudioRenderer {
  private ctx: AudioContext;
  private nodes = new Map<string, AudioNode>();

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.nodes.set('destination', this.ctx.destination);
  }

  resume() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  execute(commands: AudioCommand[]) {
    this.resume();

    for (const cmd of commands) {
      try {
        switch (cmd.type) {
          case 'createOscillator': {
            const osc = this.ctx.createOscillator();
            osc.onended = () => {
              this.nodes.delete(cmd.id);
            };
            this.nodes.set(cmd.id, osc);
            break;
          }
          case 'createGain': {
            this.nodes.set(cmd.id, this.ctx.createGain());
            break;
          }
          case 'createBiquadFilter': {
            this.nodes.set(cmd.id, this.ctx.createBiquadFilter());
            break;
          }
          case 'connect': {
            const source = this.nodes.get(cmd.sourceId);
            const dest = this.nodes.get(cmd.destId);
            if (source && dest) {
              source.connect(dest as AudioNode);
            }
            break;
          }
          case 'disconnect': {
            const source = this.nodes.get(cmd.sourceId);
            if (source) {
              source.disconnect();
            }
            break;
          }
          case 'start': {
            const node = this.nodes.get(cmd.id) as OscillatorNode;
            if (node) {
              const now = this.ctx.currentTime;
              node.start(now + cmd.time);
            }
            break;
          }
          case 'stop': {
            const node = this.nodes.get(cmd.id) as OscillatorNode;
            if (node) {
              const now = this.ctx.currentTime;
              node.stop(now + cmd.time);
            }
            break;
          }
          case 'setParamValue': {
            const node = this.nodes.get(cmd.id) as any;
            if (node && node[cmd.param]) {
              const now = this.ctx.currentTime;
              node[cmd.param].setValueAtTime(cmd.value, now + cmd.time);
            }
            break;
          }
          case 'linearRampToValueAtTime': {
            const node = this.nodes.get(cmd.id) as any;
            if (node && node[cmd.param]) {
              const now = this.ctx.currentTime;
              node[cmd.param].linearRampToValueAtTime(cmd.value, now + cmd.time);
            }
            break;
          }
          case 'exponentialRampToValueAtTime': {
            const node = this.nodes.get(cmd.id) as any;
            if (node && node[cmd.param]) {
              const now = this.ctx.currentTime;
              node[cmd.param].exponentialRampToValueAtTime(cmd.value, now + cmd.time);
            }
            break;
          }
          case 'setTargetAtTime': {
            const node = this.nodes.get(cmd.id) as any;
            if (node && node[cmd.param]) {
              const now = this.ctx.currentTime;
              node[cmd.param].setTargetAtTime(cmd.target, now + cmd.startTime, cmd.timeConstant);
            }
            break;
          }
          case 'cancelScheduledValues': {
            const node = this.nodes.get(cmd.id) as any;
            if (node && node[cmd.param]) {
              const now = this.ctx.currentTime;
              node[cmd.param].cancelScheduledValues(now + cmd.time);
            }
            break;
          }
          case 'setNodeProperty': {
            const node = this.nodes.get(cmd.id) as any;
            if (node) {
              node[cmd.property] = cmd.value;
            }
            break;
          }
          case 'dispose': {
            const node = this.nodes.get(cmd.id);
            if (node) {
              node.disconnect();
              this.nodes.delete(cmd.id);
            }
            break;
          }
        }
      } catch (e) {
        console.error('AudioRenderer error:', e, cmd);
      }
    }
  }
}

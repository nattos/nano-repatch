import { AbstractLayer, LayerConfig } from "./abstract-layer";
import { Step } from "./envelope-generator";

export class GateLayer extends AbstractLayer {
    protected onTrigger(vel: number) { this.output = vel; }
    protected onRelease() { this.output = 0; }
    protected process(isActive: boolean) {
        // Hard gate, output stays high if active
        if (isActive && this.output === 0) this.output = 1.0;
    }
}

export class ExponentialLayer extends AbstractLayer {
    private decayRate: number = 0.96;

    constructor(config: LayerConfig, decay: number = 0.96) {
        super(config);
        this.decayRate = decay;
    }

    protected onTrigger(vel: number) {
        // Snap up
        this.output = vel;
    }
    protected onRelease() {
        // Instant cut per requirements
        this.output = 0;
    }
    protected process(isActive: boolean, step: Step) {
        if (isActive) {
            // Decay while holding
            this.output *= this.decayRate;
            // Sustain floor logic could go here
        }
    }
}

export class PWMLayer extends AbstractLayer {
    private phase: number = 0;
    private duty: number = 0.5;
    private freq: number = 0.2;

    protected onTrigger() {
        this.duty = 0.5; // Reset duty
    }
    protected onRelease() {
        // Natural decay for this layer per prototype
    }
    protected process(isActive: boolean, step: Step, dt: number) {
        // Always decay value for this specific layer type
        if (!isActive) {
             this.output *= 0.85;
             return;
        }

        // Logic
        this.duty *= 0.98;
        this.phase += this.freq;
        if (this.phase > 1.0) this.phase -= 1.0;

        this.output = (this.phase < this.duty) ? 1.0 : 0.0;
    }
}

export class NoiseLayer extends AbstractLayer {
    protected onTrigger() {}
    protected onRelease() { this.output *= 0.85; }
    protected process(isActive: boolean) {
        if (isActive) {
            this.output = Math.random();
        } else {
            this.output *= 0.85;
        }
    }
}

// --- Audio Layer ---

export class ToneSynthLayer extends AbstractLayer {
    private ctx: AudioContext;
    private osc: OscillatorNode | null = null;
    private gain: GainNode | null = null;
    private filter: BiquadFilterNode | null = null;
    private frequency: number;

    constructor(config: LayerConfig, audioContext: AudioContext, frequency: number) {
        super(config);
        this.ctx = audioContext;
        this.frequency = frequency;
    }

    // Audio layers handle output differently (audio graph),
    // but we can use 'output' for monitoring amplitude if we want.

    private initVoice(time: number, velocity: number) {
        if(this.ctx.state === 'suspended') return;

        // Disconnect old if exists (simple monophonic cleanup)
        this.cleanup();

        this.osc = this.ctx.createOscillator();
        this.gain = this.ctx.createGain();
        this.filter = this.ctx.createBiquadFilter();

        // Config
        this.osc.type = 'triangle';
        this.osc.frequency.setValueAtTime(this.frequency, time);

        this.filter.type = 'lowpass';
        this.filter.frequency.setValueAtTime(800 + (velocity * 2000), time);

        // Envelope
        this.gain.gain.setValueAtTime(0, time);
        this.gain.gain.linearRampToValueAtTime(velocity, time + 0.005);
        this.gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3); // Short pluck

        // Graph
        this.osc.connect(this.filter);
        this.filter.connect(this.gain);
        this.gain.connect(this.ctx.destination); // Or a master bus passed in constructor

        this.osc.start(time);
        this.osc.stop(time + 0.35);
    }

    private cleanup() {
        try {
            if (this.osc) { this.osc.stop(); this.osc.disconnect(); }
            if (this.gain) this.gain.disconnect();
            if (this.filter) this.filter.disconnect();
        } catch(e) { /* ignore already stopped */ }
    }

    protected onTrigger(velocity: number) {
        // Monophonic synth logic
        // If holding, we might just pitch slide, but for this specific "Clicky" requirement:
        // We do trigger a new pluck on new note, but handle holds in process
        this.initVoice(this.ctx.currentTime, velocity);
    }

    protected onRelease() {
        if (this.gain) {
            // Fast release
            this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
            this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        }
    }

    protected process(isActive: boolean, step: Step) {
        if (isActive && step.hold && this.osc) {
            // Logic for sustaining note if needed
            // Currently our initVoice creates a one-shot envelope,
            // but we could modify `gain` here to sustain.
        }
    }
}

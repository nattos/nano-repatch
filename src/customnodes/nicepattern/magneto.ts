import { defineNode } from "../../structor/node-helpers";
import { numberType, booleanType, vec4Type, midiEventType, midiStreamType } from "../../structor/std-types";

// --- Physics Constants & Types ---

const PRE_CONFIG = {
  gravity: 800,
  magnetEpsilon: 50,
  physicsRate: 120,
  solverSteps: 16,
  sphereCount: 16,
  magnetRange: 800,
  height: 600 // Simulation height (arbitrary units, matching canvas pixels roughly)
};

class Sphere {
    id: number;
    radius: number;
    mass: number;
    restLength: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    isLatched: boolean;
    tensionRatio: number;
    currentSpringForce: number;
    currentMagForce: number;

    constructor(id: number, w: number, h: number, idx: number, count: number) {
        this.id = id;
        this.radius = 6 + Math.random() * 8;
        this.mass = this.radius;
        this.restLength = 20 + Math.pow(Math.random(), 2) * 150;

        const pad = w * 0.1;
        const avail = w - (pad * 2);
        this.x = pad + (avail / (count - 1)) * idx;
        this.y = h - this.restLength;
        this.vx = 0;
        this.vy = 0;
        this.isLatched = false;
        this.tensionRatio = 0;
        this.currentSpringForce = 0;
        this.currentMagForce = 0;
    }

    update(dt: number, h: number, plateY: number, magnetOn: boolean, params: { gravity: number, springK: number, magnetStrength: number, damping: number }) {
        this.currentMagForce = 0;
        this.currentSpringForce = 0;
        this.tensionRatio = 0;

        const targetY = h - this.restLength;
        const springForce = (targetY - this.y) * params.springK;
        const gravityForce = params.gravity * this.mass;
        const totalDownForce = gravityForce + springForce;
        this.currentSpringForce = Math.max(0, totalDownForce);

        // Helper: getMagneticForce
        const getMagneticForce = (dist: number) => {
             if (dist >= PRE_CONFIG.magnetRange) return 0;
             const decay = PRE_CONFIG.magnetEpsilon / (dist * dist + PRE_CONFIG.magnetEpsilon);
             return params.magnetStrength * decay;
        };

        const holdForce = getMagneticForce(0);

        if (magnetOn) {
            const distToPlate = this.y - this.radius - plateY;
            if (this.isLatched || distToPlate <= 2.0) {
                if (holdForce > totalDownForce) {
                    this.isLatched = true;
                    this.y = plateY + this.radius;
                    this.vy = 0;
                    this.currentMagForce = holdForce;
                    this.tensionRatio = Math.max(0, Math.min(1, totalDownForce / holdForce));
                    return;
                } else {
                    this.isLatched = false;
                }
            }
        } else {
            this.isLatched = false;
        }

        let force = totalDownForce;
        if (magnetOn && !this.isLatched) {
            const dist = Math.max(0, this.y - this.radius - plateY);
            const magForce = -getMagneticForce(dist);
            this.currentMagForce = Math.abs(magForce);
            force += magForce;
        }

        this.vy += (force / this.mass) * dt;
        this.vy *= params.damping;
        this.y += this.vy * dt;

        if (this.y + this.radius > h) {
            this.y = h - this.radius;
            this.vy *= -0.5;
        }
        if (this.y - this.radius < plateY) {
            this.y = plateY + this.radius;
            if (!magnetOn) {
                this.vy *= -0.6;
                // Bounce assist during attack? (from logic: if(STATE.phase === 'ATTACK') this.vy += 400;)
                // We don't have direct access to phase here easily unless passed.
                // Porting strictly: logic used STATE.phase === 'ATTACK'.
                // Let's assume we pass a 'bounce' flag or similar?
                // Or just omit strict attack bounce for now.
            } else {
                if(this.vy < 0) this.vy = 0;
            }
        }
    }
}

interface MagnetoState {
    spheres: Sphere[];
    plateY: number;
    phase: 'IDLE' | 'ATTACK' | 'DECAY' | 'SUSTAIN' | 'RELEASE';
    sustainProgress: number;
    accumulator: number;
    lastGate: boolean;
}

// --- Node Definition ---

export const magneto = defineNode({
  id: "nicepattern.magneto",
  version: "1.0.0",
  displayName: "Magneto",
  metadata: {
    category: 'NicePattern',
    keywords: ['envelope', 'physics', 'magnet', 'modulator'],
    description: 'Physics-based magnetic envelope generator.'
  },
  inputs: {
    midi_in: { type: midiStreamType, description: "Trigger Input" },
    attack: { type: numberType, defaultValue: 0.2, range: [0.01, 2.0], step: 0.01, description: "Attack Time (s)" },
    decay: { type: numberType, defaultValue: 0.25, range: [0.01, 2.0], step: 0.01, description: "Decay Time (s)" },
    sustain: { type: numberType, defaultValue: 0.6, range: [0.0, 1.0], step: 0.01, description: "Sustain Level (0-1)" },
    release: { type: numberType, defaultValue: 0.3, range: [0.01, 5.0], step: 0.01, description: "Release Time (s)" },
    peak: { type: numberType, defaultValue: 0.9, range: [0.1, 1.0], step: 0.01, description: "Peak Level (0-1, inverted)" },

    // Physics
    mag_flux: { type: numberType, defaultValue: 2000000, range: [100000, 4000000], step: 10000, description: "Magnet Strength" },
    spring_k: { type: numberType, defaultValue: 25000, range: [1000, 50000], step: 100, description: "Spring Stiffness" },
    damping: { type: numberType, defaultValue: 0.999, range: [0.900, 1.000], step: 0.001, description: "Damping Factor" }
  },
  outputs: {
    env: { type: numberType, description: "Envelope Output (Tension)" },
    vec: vec4Type, // [Tension, Ext, Spring, Mag]
    ch1: { type: numberType, description: "Channel 1 (Tension)" },
    ch2: { type: numberType, description: "Channel 2 (Extension)" },
    ch3: { type: numberType, description: "Channel 3 (Spring Force)" },
    ch4: { type: numberType, description: "Channel 4 (Mag Force)" }
  },
  ui: {
      body: () => import('./magneto-editor').then(m => m.MagnetoEditorRenderer),
      getBodyHeight: () => Promise.resolve(() => 272) // Triple Grid Height
  },
  isRealtime: () => true,
  createState: () => {
      const spheres: Sphere[] = [];
      const cw = 600; // Virtual width
      const ch = PRE_CONFIG.height;
      for(let i=0; i<PRE_CONFIG.sphereCount; i++) {
          spheres.push(new Sphere(i, cw, ch, i, PRE_CONFIG.sphereCount));
      }
      return {
          spheres,
          plateY: 40, // Open Y
          phase: 'IDLE',
          sustainProgress: 0,
          accumulator: 0,
          lastGate: false
      };
  },
  execute: (inputs, config, context, state: MagnetoState) => {
      const dt = context.clock.dt;

      // Inputs - Parse MIDI
      const stream = (inputs.midi_in || []) as any[];
      let gate = state.lastGate; // Persist gate state

      for (const e of stream) {
        if (e.type === 'note_on') {
          gate = true;
        } else if (e.type === 'note_off') {
          gate = false;
        }
      }

      const attack = inputs.attack ?? 0.2;
      const decay = inputs.decay ?? 0.25;
      const sustain = inputs.sustain ?? 0.6;
      const release = inputs.release ?? 0.3;
      const peak = inputs.peak ?? 0.9;

      const magStr = inputs.mag_flux ?? 2000000;
      const kp = inputs.spring_k ?? 25000;
      const damp = inputs.damping ?? 0.999;

      // Layout Targets (simulating h * 0.95 vs h * 0.1)
      const h = PRE_CONFIG.height;
      const deep = h * 0.95;
      const shallow = h * 0.1;

      const plateOpenY = 40;
      const plateClosedY = shallow + (peak * (deep - shallow));
      const plateSustainY = shallow + (sustain * (deep - shallow));

      // Speeds (ported from updatePhysics in HTML)
      const speedAttack = 0.05 / Math.max(0.01, attack);
      const speedDecay = 0.02 / Math.max(0.01, decay);
      const speedRelease = 0.02 / Math.max(0.01, release);


      // Phase Logic
      if (gate && !state.lastGate) {
           // Gate On
           state.phase = 'ATTACK';
           state.sustainProgress = 0;
      } else if (!gate && state.lastGate) {
           // Gate Off
           state.phase = 'RELEASE';
           state.sustainProgress = 0;
      }
      state.lastGate = gate;


      // Physics Loop (Fixed Timestep)
      state.accumulator += dt;
      const FIXED_STEP = 1 / PRE_CONFIG.physicsRate;

      let magnetActive = false;

      // Limit max steps to prevent freeze on lag
      let steps = 0;
      while (state.accumulator >= FIXED_STEP && steps < 5) {
          state.accumulator -= FIXED_STEP;
          steps++;

          let targetY = plateOpenY;
          let speed = speedRelease;

          if (gate) {
              if (state.phase === 'IDLE' || state.phase === 'RELEASE') {
                  state.phase = 'ATTACK';
                  state.sustainProgress = 0;
              }

              if (state.phase === 'ATTACK') {
                  targetY = plateClosedY;
                  speed = speedAttack;
                  if (Math.abs(state.plateY - plateClosedY) < 10) state.phase = 'DECAY';
              } else if (state.phase === 'DECAY') {
                  targetY = plateSustainY;
                  speed = speedDecay;
                  if (Math.abs(state.plateY - plateSustainY) < 5) state.phase = 'SUSTAIN';
              } else if (state.phase === 'SUSTAIN') {
                  targetY = plateSustainY;
                  speed = 0.1; // Slow drift? HTML: 0.1
                  state.sustainProgress += (1.0 - state.sustainProgress) * 2.0 * FIXED_STEP;
              }
              magnetActive = true;
          } else {
              // Release
              state.phase = 'RELEASE';
              targetY = plateOpenY;
              speed = speedRelease;

              // Ensure we snap to open if close enough
              if (Math.abs(state.plateY - plateOpenY) < 15) {
                  magnetActive = false;
                  state.phase = 'IDLE';
                 // Optionally snap plateY?
                 // state.plateY = plateOpenY;
              } else {
                  magnetActive = true;
              }
          }

          const diff = targetY - state.plateY;
          state.plateY += diff * speed;

          // Solver
          const solverDt = FIXED_STEP / PRE_CONFIG.solverSteps;
          const params = { gravity: PRE_CONFIG.gravity, springK: kp, magnetStrength: magStr, damping: damp };

          for(let i=0; i<PRE_CONFIG.solverSteps; i++) {
              state.spheres.forEach(s => {
                  s.update(solverDt, h, state.plateY, magnetActive, params);
              });
          }
      }
      // Dump extra accumulator if too much lag
      if (state.accumulator > FIXED_STEP) state.accumulator = 0;

      // Calculate Metrics (Audio Output)

      let sumTension = 0, sumExt = 0, sumFS = 0, sumFM = 0, latchedCount = 0;

      state.spheres.forEach(s => {
          if (s.isLatched) { latchedCount++; sumTension += s.tensionRatio; }
          const ext = Math.max(0, (h - s.restLength) - s.y);
          sumExt += ext;
          sumFS += s.currentSpringForce;
          sumFM += s.currentMagForce;
      });

      const metricTension = latchedCount > 0 ? (sumTension / latchedCount) : 0;
      const metricExt = Math.min(1.0, sumExt / (h * PRE_CONFIG.sphereCount * 0.4));

      const maxSpringF = PRE_CONFIG.sphereCount * kp * h * 0.3;
      const maxMagF = PRE_CONFIG.sphereCount * magStr;

      const metricFS = Math.min(1.0, sumFS / maxSpringF);
      const metricFM = Math.min(1.0, sumFM / maxMagF);

      // Prepare Output
      const vec = [metricTension, metricExt, metricFS, metricFM];

      // UI Output (for Hero Node)
      const uiData = {
          plateY: state.plateY,
          phase: state.phase,
          sustainProgress: state.sustainProgress,
          spheres: state.spheres.map(s => ({
              x: s.x, y: s.y, r: s.radius,
              l: s.isLatched, t: s.tensionRatio
          })),
          adsr: { attack, decay, sustain, release, peak }
      };

      return {
          outputs: {
              env: metricTension,
              vec: vec,
              ch1: metricTension,
              ch2: metricExt,
              ch3: metricFS,
              ch4: metricFM
          },
          ui: uiData
      };
  }
});

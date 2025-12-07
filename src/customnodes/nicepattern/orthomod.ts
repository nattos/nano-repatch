import {
  MidiEvent
} from "../../io/midi/types";
import {
  defineNode,
  InspectorFieldDef
} from "../../structor/node-helpers";
import {
  numberType,
  midiStreamType
} from "../../structor/std-types";
import { defineType } from "../../structor/type-helpers";
import { SeededRandom } from "./utils";

// --- Types ---
export const vec4Type = defineType({
  kind: "array",
  element: numberType,
  size: 4,
  hint: "vec4"
});

// --- Logic Helpers ---

function generateHadamard(n: number): number[][] {
  if (n === 1) return [[0]];
  const h = generateHadamard(n / 2);
  const out: number[][] = [];
  for (let i = 0; i < h.length; i++) out.push([...h[i], ...h[i]]);
  for (let i = 0; i < h.length; i++) out.push([...h[i], ...h[i].map(b => 1 - b)]);
  return out;
}

function getComplexity(row: number[]): number {
  let t = 0;
  for (let i = 0; i < row.length - 1; i++) if (row[i] !== row[i + 1]) t++;
  return t;
}

export function generateCodes(resolution: number, seed: number): number[][] {
  // 1. Generate Raw Hadamard (Size 8)
  const rawCodes = generateHadamard(8).sort((a, b) => getComplexity(a) - getComplexity(b));
  // Force index 0 to be all ON (as per prototype)
  rawCodes[0] = [1, 1, 1, 1, 1, 1, 1, 1];

  // 2. Permute Columns based on seed
  const colMap = [0, 1, 2, 3, 4, 5, 6, 7];
  const rng = new SeededRandom(seed);

  // Fisher-Yates shuffle for columns
  for (let i = colMap.length - 1; i > 0; i--) {
      const j = rng.nextRange(0, i);
      [colMap[i], colMap[j]] = [colMap[j], colMap[i]];
  }

  // 3. Select Subset based on resolution
  const count = Math.max(2, Math.min(8, resolution));
  const subset = rawCodes.slice(0, count);

  // 4. Map columns
  return subset.map(code => {
      const newCode = new Array(8);
      for(let i=0; i<8; i++) newCode[i] = code[colMap[i]];
      return newCode;
  });
}

// --- Node Definition ---

export const OrthomodFields: InspectorFieldDef[] = [
  { type: 'number', label: 'Seed', path: 'seed', step: 1 }
];

interface OrthomodState {
  linearEnv: number;
  gateOpen: boolean;
  active: boolean;
  codes: number[][];
  lastSeed: number;
  lastResolution: number;
  currentEffectiveCurve: number;
  phase: number;
}

export const orthomod = defineNode({
  id: "nicepattern.orthomod",
  version: "1.0.0",
  displayName: "Orthomod",
  metadata: {
    category: 'NicePattern',
    keywords: ['envelope', 'modulation', 'orthogonal', 'hadamard'],
    description: 'Orthogonal code-based envelope generator.'
  },
  config: {
    seed: numberType
  },
  inputs: {
    midi_in: { type: midiStreamType, description: "Trigger Input" },
    decay: { type: numberType, defaultValue: 1.2, description: "Decay Time (s)" },
    curve: { type: numberType, defaultValue: 1.5, description: "Response Curve", range: [0.1, 4.0] },
    resolution: { type: numberType, defaultValue: 8, range: [2, 8], description: "Codebook Size" },
    manual_phase: {
      type: numberType,
      defaultValue: -1,
      description: "Manual Phase Override (0-1)",
      suppressInputEditor: true
    }
  },
  outputs: {
    env: { type: numberType, description: "Envelope Output (0-1)" },
    vec: { type: vec4Type, description: "Channel Values [c1, c2, c3, c4]" },
    ch1: { type: numberType, description: "Channel 1" },
    ch2: { type: numberType, description: "Channel 2" },
    ch3: { type: numberType, description: "Channel 3" },
    ch4: { type: numberType, description: "Channel 4" }
  },
  ui: {
    inspector: { fields: OrthomodFields },
    body: () => import('./orthomod-editor').then(m => m.OrthomodEditorRenderer),
    getBodyHeight: () => Promise.resolve(() => 260) // Fixed height for hero widget
  },
  isRealtime: () => true,
  createState: () => ({
    linearEnv: 0.0,
    gateOpen: false,
    active: false,
    codes: [],
    lastSeed: -1,
    lastResolution: -1,
    currentEffectiveCurve: 1.5,
    phase: 0.0
  }),
  execute: (inputs, config, context, state: OrthomodState) => {
    const dt = context.clock.dt;
    state.phase += dt; // Accumulate time in seconds
    const now = state.phase;


    // Inputs - Sanitize with Safe Defaults to prevent NaNs
    // Be very aggressive about defaults.
    const decayRaw = inputs.decay;
    const decay = (typeof decayRaw === 'number' && Number.isFinite(decayRaw)) ? Math.max(0.001, decayRaw) : 1.2;

    const curveRaw = inputs.curve;
    const sustainCurve = (typeof curveRaw === 'number' && Number.isFinite(curveRaw)) ? Math.max(0.001, curveRaw) : 1.5;

    const resRaw = inputs.resolution;
    const resolution = (typeof resRaw === 'number' && Number.isFinite(resRaw)) ? Math.floor(Math.max(2, Math.min(8, resRaw))) : 8;

    const seedRaw = config.seed;
    const seed = (typeof seedRaw === 'number' && Number.isFinite(seedRaw)) ? seedRaw : 12345;

    // Manual Phase: allow -1, clamp 0-1
    const phaseRaw = inputs.manual_phase;
    const manualPhase = (typeof phaseRaw === 'number' && Number.isFinite(phaseRaw)) ? phaseRaw : -1.0;

    // 1. Rebuild Codes if needed
    if (seed !== state.lastSeed || resolution !== state.lastResolution) {
      state.codes = generateCodes(resolution, seed);
      state.lastSeed = seed;
      state.lastResolution = resolution;
    }

    // 2. MIDI Triggers
    const stream = (inputs.midi_in || []) as any[];
    for (const e of stream) {
      if (e.type === 'note_on') {
        state.linearEnv = 1.0;
        state.gateOpen = true;
        state.active = true;
        state.currentEffectiveCurve = sustainCurve;
      } else if (e.type === 'note_off') {
        state.gateOpen = false;
        // Logic from prototype: when released, switch to fast release curve
        // But we need to calculate current level and decay from there
        // The prototype logic was:
        // STATE.currentEffectiveCurve = STATE.releaseCurve; // 12.0
        // We'll simplify for now or adopt it?
        // Let's stick to simple decay for now, prototype logic is a bit specific to 'hold' behavior.
        // Actually, let's keep it simple: Release just lets it decay naturally or we can speed it up.
        // The prototype says: when gate open, if decay finishes, it stops?
        // Prototype: "if(gateOpen && ... > stepDur) noteOff" -> auto release logic.
        // Here we just follow MIDI.
      }
    }

    // 3. Envelope Logic
    // If manual phase is active, use it
    let currentEnv = 0;

    if (manualPhase >= 0) {
      state.linearEnv = Math.max(0, Math.min(1, manualPhase));
      state.active = true; // Force active
      state.currentEffectiveCurve = 1.0; // Linear for manual
    } else {
       if (state.active) {
         state.linearEnv -= dt / Math.max(0.01, decay);
         if (state.linearEnv <= 0) {
           state.linearEnv = 0;
           state.active = false;
         }
       }
        // Apply sustain curve if not manual
        // If gate is open, use normal curve. If gate is closed (released), use sharper curve?
        // Prototype logic: "STATE.currentEffectiveCurve = STATE.releaseCurve" (12.0) on noteOff.
        if (!state.gateOpen && state.active) {
            // Accelerate decay or change curve?
            // The prototype just changed the curve.
            state.currentEffectiveCurve = 12.0;
        } else {
            state.currentEffectiveCurve = sustainCurve;
        }
    }

    // Curve
    // Protect Math.pow against (0, negative) or (negative, fractional)
    const base = Math.max(0, state.linearEnv);
    const exponent = state.currentEffectiveCurve;
    currentEnv = Math.pow(base, exponent);

    if (Number.isNaN(currentEnv)) currentEnv = 0;

    // 4. Map to Codes
    // Prototype: "let pos = 1.0 - STATE.curEnv"
    // So Env=1.0 -> Pos=0 (Index 0). Env=0.0 -> Pos=1 (Index Max)
    // Prototype Index 0 is ALL ON. So Start of Env = ALL ON.
    let pos = 1.0 - currentEnv;
    pos = Math.max(0, Math.min(0.999, pos));

    const count = state.codes.length;
    const idx = Math.floor(pos * count);
    const code = state.codes[idx] || state.codes[0]; // Fallback

    // 5. Modulators
    // Prototype: sqr = (t*rate)%1 > 0.5. sin = abs(sin(t...))
    const rate = 50; // Hz? Prototype used 50
    const sqr = (now * rate) % 1.0 > 0.5 ? 1 : 0;
    const sin = Math.abs(Math.sin(now * rate * Math.PI * 2));

    // 6. Channel Outputs
    const channels = [0, 0, 0, 0];

    if (state.active && currentEnv > 0.001) {
       for(let ch=0; ch<4; ch++) {
         const b1 = code[ch * 2] || 0;
         const b2 = code[ch * 2 + 1] || 0;

         let val = 0;
         if (b1 === 0 && b2 === 0) val = 0; // OFF
         else if (b1 === 1 && b2 === 1) val = 1; // ON
         else if (b1 === 1 && b2 === 0) val = sqr; // SQR
         else if (b1 === 0 && b2 === 1) val = sin; // SIN

         channels[ch] = val * currentEnv;
         if (Number.isNaN(channels[ch])) channels[ch] = 0;
       }
    }

    const safeNum = (n: number) => Number.isFinite(n) ? n : 0;

    return {
      env: safeNum(currentEnv),
      vec: channels.map(safeNum),
      ch1: safeNum(channels[0]),
      ch2: safeNum(channels[1]),
      ch3: safeNum(channels[2]),
      ch4: safeNum(channels[3]),
      gate: state.gateOpen ? 1 : 0
    };
  },
  compileConfig: (uiConfig) => ({
    seed: uiConfig?.seed ?? 12345
  })
});

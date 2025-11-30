
import { html, TemplateResult } from 'lit';
import { StructorType } from '../structor/structor';

export function formatType(type: StructorType | undefined): string {
  if (!type) return 'unknown';

  if (type.kind === 'record' && type.hint) {
    return type.hint;
  }

  if (type.kind === 'array' && type.hint) {
    return type.hint;
  }

  if (type.kind === 'atomic') {
    return type.type;
  }

  if (type.kind === 'array') {
    return `${formatType(type.element)}[]`;
  }

  if (type.kind === 'record') {
    return 'record';
  }

  return type.kind;
}

export function formatValue(value: any, type?: StructorType): TemplateResult {
  if (value === undefined || value === null) {
    return html`<span class="chip">null</span>`;
  }

  if (type?.kind === 'record' && type.hint === 'midi') {
    return html`<span class="chip midi">${formatMidiEvent(value)}</span>`;
  }

  if (type?.kind === 'array' && type.hint === 'midi-stream') {
    return formatMidiStream(value);
  }

  if (type?.kind === 'array' && type.hint === 'step-sequence') {
    return formatStepSequence(value);
  }

  if (typeof value === 'number') {
    return html`<span class="chip">${value.toFixed(4)}</span>`;
  }

  if (typeof value === 'string') {
    return html`<span class="chip">"${value}"</span>`;
  }

  if (Array.isArray(value)) {
    return html`<span class="chip vector">vector(${value.length})</span>`;
  }

  if (typeof value === 'object') {
    return html`<span class="chip struct">struct</span>`;
  }

  return html`<span class="chip">${String(value)}</span>`;
}

function unwrap(value: any): any {
  if (value && typeof value === 'object' && 'fields' in value) {
    const result: any = {};
    for (const [k, v] of Object.entries(value.fields)) {
      result[k] = unwrap(v);
    }
    return result;
  }
  return value;
}

function formatMidiEvent(rawEvent: any): string {
  const event = unwrap(rawEvent);
  const status = event.status & 0xF0;

  if (status === 0xB0) { // CC
    return `cc${event.data1}:${(event.data2 / 127).toFixed(2)}`;
  }

  if (status === 0x90) { // Note On
    if (event.data2 > 0) {
      return `${midiNoteName(event.data1)}:on`;
    } else {
      return `${midiNoteName(event.data1)}:off`;
    }
  }

  if (status === 0x80) { // Note Off
    return `${midiNoteName(event.data1)}:off`;
  }

  return `midi(${status ? status.toString(16) : '?'})`;
}

function midiNoteName(note: number): string {
  const notes = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const octave = Math.floor(note / 12) - 1;
  const name = notes[note % 12];
  return `${name}${octave}`;
}

function formatMidiStream(stream: any[]): TemplateResult {
  if (!stream || stream.length === 0) {
    return html`<span class="chip midi-stream empty">[]</span>`;
  }

  // Show last few events
  const events = stream.slice(-3).map(formatMidiEvent).join(', ');
  return html`<span class="chip midi-stream">[${events}]</span>`;
}

function formatStepSequence(sequence: any[]): TemplateResult {
  if (!sequence || !Array.isArray(sequence)) {
    return html`<span class="chip">invalid seq</span>`;
  }

  const steps = sequence.map((rawStep, index) => {
    const step = unwrap(rawStep);
    const isActive = step.noteIndex !== null && step.noteIndex !== undefined;
    const velocity = step.velocity ?? 0;
    const isHold = step.hold;

    // Calculate height based on velocity (min 20% for visibility)
    const heightPercent = isActive ? Math.max(20, velocity * 100) : 100;

    // Color
    // Active: #4caf50 (Green) or #2196f3 (Blue) or #ff9800 (Orange)
    // Inactive: #333
    // We can use CSS variables or fixed colors.
    const color = isActive ? '#4caf50' : '#333';
    const opacity = isActive ? 1 : 0.3;

    return html`
      <div class="step ${isActive ? 'active' : ''} ${isHold ? 'hold' : ''}"
           style="
             height: ${isActive ? heightPercent : 20}%;
             background-color: ${color};
             opacity: ${isActive ? 1 : 0.5};
           "
           title="Step ${index}: ${isActive ? `Note ${step.noteIndex}, Vel ${velocity.toFixed(2)}` : 'Rest'}"
      ></div>
    `;
  });

  return html`
    <style>
      .step-seq-viz {
        display: inline-flex;
        gap: 1px;
        height: 14px;
        align-items: flex-end;
        background: rgba(0,0,0,0.3);
        padding: 2px;
        border-radius: 3px;
        vertical-align: middle;
      }
      .step-seq-viz .step {
        width: 6px;
        border-radius: 1px;
        min-height: 2px;
      }
      .step-seq-viz .step.hold {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        margin-right: -1px; /* Connect visually */
        padding-right: 1px;
        z-index: 1;
      }
    </style>
    <div class="step-seq-viz">
      ${steps}
    </div>
  `;
}

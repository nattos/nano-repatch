
import { html, TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
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

export function formatValue(value: any, type?: StructorType, options?: { extraClasses: Record<string, boolean> }): TemplateResult {
  if (value === undefined || value === null) {
    return html`<span class=${classMap({'chip': true, ...options?.extraClasses})}>null</span>`;
  }

  if (type?.kind === 'record' && type.hint === 'midi') {
    return html`<span class=${classMap({'chip': true, 'midi': true, ...options?.extraClasses})}>${formatMidiEvent(value)}</span>`;
  }

  if (type?.kind === 'array' && type.hint === 'midi-stream') {
    return formatMidiStream(value, options);
  }

  if (type?.kind === 'array' && type.hint === 'step-sequence') {
    return formatStepSequence(value, options);
  }

  if (typeof value === 'number') {
    return html`<span class=${classMap({'chip': true, ...options?.extraClasses})}>${value.toFixed(4)}</span>`;
  }

  if (typeof value === 'string') {
    return html`<span class=${classMap({'chip': true, ...options?.extraClasses})}>"${value}"</span>`;
  }

  if (Array.isArray(value)) {
    return html`<span class=${classMap({'chip': true, 'vector': true, ...options?.extraClasses})}>vector(${value.length})</span>`;
  }

  if (typeof value === 'object') {
    return html`<span class=${classMap({'chip': true, 'struct': true, ...options?.extraClasses})}>struct</span>`;
  }

  return html`<span class=${classMap({'chip': true, ...options?.extraClasses})}>${String(value)}</span>`;
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

  // Handle new MidiEvent structure
  if (event.type === 'cc') {
    return `cc${event.cc}:${(event.value / 127).toFixed(2)}`;
  }
  if (event.type === 'note_on') {
    return `${midiNoteName(event.note)}:on`;
  }
  if (event.type === 'note_off') {
    return `${midiNoteName(event.note)}:off`;
  }

  // Fallback for legacy or raw bytes if any
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

  return `midi(${event.type || (status ? status.toString(16) : '?')})`;
}

function midiNoteName(note: number): string {
  const notes = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const octave = Math.floor(note / 12) - 1;
  const name = notes[note % 12];
  return `${name}${octave}`;
}

function formatMidiStream(stream: any[], options?: { extraClasses: Record<string, boolean> }): TemplateResult {
  if (!stream || stream.length === 0) {
    return html`<span class=${classMap({'chip': true, 'midi-stream': true, 'empty': true, ...options?.extraClasses})}>[]</span>`;
  }

  // Show last few events
  const events = stream.slice(-3).map(formatMidiEvent).join(', ');
  return html`<span class=${classMap({'chip': true, 'midi-stream': true, ...options?.extraClasses})}>[${events}]</span>`;
}

function formatStepSequence(sequence: any[], options?: { extraClasses: Record<string, boolean> }): TemplateResult {
  if (!sequence || !Array.isArray(sequence)) {
    return html`<span class=${classMap({'chip': true, ...options?.extraClasses})}>invalid seq</span>`;
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
    <div class="step-seq-viz">
      ${steps}
    </div>
  `;
}


import { html, TemplateResult } from 'lit';
import { Structor, StructorType } from '../structor/structor';

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

function formatMidiEvent(event: { status: number, data1: number, data2: number }): string {
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

  return `midi(${status.toString(16)})`;
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

  // Visualize as bars: ▮ for active, ▯ for inactive
  const bars = sequence.map(step => {
    if (step.noteIndex !== null && step.noteIndex !== undefined) {
      return '▮';
    } else {
      return '▯';
    }
  }).join('');

  return html`<span class="chip sequence" style="font-family: 'Menlo', monospace; letter-spacing: 1px;">${bars}</span>`;
}

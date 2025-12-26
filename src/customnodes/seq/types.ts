
export interface Step {
  noteIndex: number | null;
  velocity: number;
  hold: boolean;
}

export type Sequence = Step[];

export interface NoteEvent {
  note: number;
  velocity: number;
}

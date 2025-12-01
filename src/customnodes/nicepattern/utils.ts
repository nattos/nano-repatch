export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  // Mulberry32 algorithm
  next(): number {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

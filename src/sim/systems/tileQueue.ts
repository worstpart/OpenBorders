/**
 * A min-heap of (ready time, tile) pairs for an attack's front. Ties are broken by
 * insertion order, so popping order is fully deterministic. Typed arrays keep it compact
 * and garbage-free; a tile may be queued more than once (the earliest entry wins and
 * later ones are skipped when popped).
 */
export class TileQueue {
  private times = new Float64Array(64);
  private tiles = new Int32Array(64);
  private order = new Float64Array(64);
  private count = 0;
  private inserted = 0;

  get size(): number {
    return this.count;
  }

  push(time: number, tile: number): void {
    if (this.count === this.times.length) this.grow();
    let i = this.count++;
    const seq = this.inserted++;
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(time, seq, this.times[parent]!, this.order[parent]!)) break;
      this.times[i] = this.times[parent]!;
      this.tiles[i] = this.tiles[parent]!;
      this.order[i] = this.order[parent]!;
      i = parent;
    }
    this.times[i] = time;
    this.tiles[i] = tile;
    this.order[i] = seq;
  }

  /** Ready time of the earliest entry (Infinity when empty). */
  peekTime(): number {
    return this.count > 0 ? this.times[0]! : Infinity;
  }

  /** Removes the earliest entry and returns its tile. */
  pop(): number {
    if (this.count === 0) throw new Error("pop() on an empty TileQueue");
    const top = this.tiles[0]!;
    const last = --this.count;
    if (last > 0) {
      const time = this.times[last]!;
      const tile = this.tiles[last]!;
      const seq = this.order[last]!;
      let i = 0;
      // Sift down.
      for (;;) {
        const left = i * 2 + 1;
        if (left >= last) break;
        const right = left + 1;
        const child =
          right < last &&
          this.less(this.times[right]!, this.order[right]!, this.times[left]!, this.order[left]!)
            ? right
            : left;
        if (!this.less(this.times[child]!, this.order[child]!, time, seq)) break;
        this.times[i] = this.times[child]!;
        this.tiles[i] = this.tiles[child]!;
        this.order[i] = this.order[child]!;
        i = child;
      }
      this.times[i] = time;
      this.tiles[i] = tile;
      this.order[i] = seq;
    }
    return top;
  }

  clear(): void {
    this.count = 0;
  }

  private less(timeA: number, seqA: number, timeB: number, seqB: number): boolean {
    return timeA < timeB || (timeA === timeB && seqA < seqB);
  }

  private grow(): void {
    const size = this.times.length * 2;
    const times = new Float64Array(size);
    const tiles = new Int32Array(size);
    const order = new Float64Array(size);
    times.set(this.times);
    tiles.set(this.tiles);
    order.set(this.order);
    this.times = times;
    this.tiles = tiles;
    this.order = order;
  }
}

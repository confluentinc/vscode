import { type PartitionConsumeRecord } from "../clients/sidecar";

export class Stream {
  capacity: number;
  messages: CircularBuffer<PartitionConsumeRecord>;
  timestamp: SkipList<number | undefined>;
  partition: SkipList<number | undefined>;
  bitset: BitSet | null;
  order: SkipList<PartitionConsumeRecord> | null;

  constructor(capacity = 2 ** 24) {
    this.capacity = capacity;

    /* Despite the UI having the ability to do "unbounded" consumption, we set
    the upper limit to make memory management predictable. If I'm wrong about
    this assumptions, I would be happy to receive a bug report "unable to see 
    more than 16m messages in unbounded stream". What a nice problem to have. */
    this.messages = new CircularBuffer(capacity);
    let values = this.messages.values;

    /* Message timestamp is a number that grows continuously. We can't really 
    expect it to repeat often. */
    let timestampOf = (point: number) => values[point].timestamp;
    this.timestamp = new SkipList(capacity, 1 / 4, timestampOf, descending);

    /* Message partition id is a number that represents a category. It often 
    going to be repeated. */
    let partitionOf = (point: number) => values[point].partition_id;
    this.partition = new SkipList(capacity, 1 / 2, partitionOf, ascending);

    this.bitset = null;
    this.order = null;
  }

  insert(message: PartitionConsumeRecord) {
    // if the size of circular buffer is at its capacity,
    // following insert replaces an older existing item
    let isCircular = this.messages.size >= this.messages.capacity;
    let index = this.messages.append(message);
    if (isCircular) {
      this.timestamp.remove(index);
      this.partition.remove(index);
    }
    this.timestamp.insert(index);
    this.partition.insert(index);
    // TEMP (July 12th) disabling this since we don't have sorting feature yet
    // this.order?.insert(index);
  }

  get size() {
    return this.messages.size;
  }

  count() {
    return { total: this.messages.size, filter: this.bitset?.count() ?? null };
  }

  slice(offset: number, limit: number) {
    let results: Array<PartitionConsumeRecord> = [];
    let indices: Array<number> = [];
    let includes = this.bitset?.predicate() ?? ((_: number) => true);
    let local = this.order ?? this.timestamp;
    let messages = this.messages.values;

    let cursor, index;
    for (
      cursor = local.head, index = 0;
      cursor !== local.tail && index < offset + limit;
      cursor = local.next[cursor]
    ) {
      if (includes(cursor) && ++index >= offset && index < offset + limit) {
        indices.push(cursor);
        results.push(messages[cursor]);
      }
    }

    if (includes(cursor) && cursor < messages.length && index < offset + limit) {
      indices.push(cursor);
      results.push(messages[cursor]);
    }
    return { indices, results };
  }
}

/** A subset of DIVA's universal ascending comparator. It doesn't work with NaN. */
export function ascending<Value>(a: Value | undefined, b: Value | undefined) {
  return a === b ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0;
}

/** A subset of DIVA's universal descending comparator. It doesn't work with NaN. */
export function descending<Value>(a: Value | undefined, b: Value | undefined) {
  return a === b ? 0 : a == null ? 1 : b == null ? -1 : a < b ? 1 : a > b ? -1 : 0;
}

export class CircularBuffer<Value> {
  capacity: number;
  values: Array<Value>;
  insertIndex: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.values = [];
    this.insertIndex = 0;
  }

  get size() {
    return this.values.length;
  }

  at(point: number) {
    return this.values[point];
  }

  append(value: Value) {
    if (this.values.length < this.capacity) {
      return this.values.push(value) - 1;
    }
    let index = this.insertIndex++;
    this.values[index] = value;
    this.insertIndex %= this.capacity;
    return index;
  }
}

export class SkipList<Value> {
  /** A number (0..1) that defines size ratio between local and express lanes. */
  ratio: number;
  /** An accessor function that resolves the actual value by pointer. */
  getValue: (point: number) => Value;
  /** A comparator function that establishes desired order of values. */
  compare: (a: Value, b: Value) => -1 | 0 | 1;
  /** Extra skiplist that contains subset (per ratio) of values for faster search. */
  express: SkipList<Value> | null;
  /** BitSet to keep track of indices added to the list. */
  bitset: BitSet;
  /** Max number of items that can be added to the list. */
  capacity: number;

  size: number;
  head: number;
  tail: number;
  next: Uint32Array;
  prev: Uint32Array;

  constructor(
    capacity: number,
    ratio: number,
    getValue: (point: number) => Value,
    compare: (a: Value, b: Value) => -1 | 0 | 1,
  ) {
    this.capacity = capacity;
    this.ratio = ratio;
    this.getValue = getValue;
    this.compare = compare;

    this.size = 0;
    this.head = 0;
    this.tail = 0;
    this.next = new Uint32Array(capacity);
    this.prev = new Uint32Array(capacity);

    this.express = null;
    this.bitset = new BitSet(capacity);
  }

  /**
   * Inserts an item to the local lane (and possibly express) following the
   * order defined by compare function. Returns the insertion point used for
   * inserting the new item (i.e. point to the right).
   */
  insert(index: number): number | null {
    if (this.express == null && this.size >= 1 / this.ratio) {
      this.express = new SkipList(this.capacity, this.ratio, this.getValue, this.compare);
    }

    let point = null;

    // express lane, if created, helps finding insertion point for the item
    if (this.express != null) {
      if (Math.random() < this.ratio) {
        point = this.express.insert(index);
      } else if (this.express.size > 0) {
        point = this.express.search(index);
      }
    }

    this.bitset.set(index);

    let size = this.size++;
    let value = this.getValue(index);

    // adding an item to a list of size > 1 means doing more work to insert the item
    if (size > 1) {
      // item on the left from the head, put it in the head
      if (this.compare(value, this.getValue(this.head)) < 0) {
        this.next[index] = this.head;
        this.prev[this.head] = index;
        this.head = index;
        return this.next[index];
      }

      // item on the right from the tail, or equal, put it in the tail
      if (this.compare(value, this.getValue(this.tail)) >= 0) {
        this.next[this.tail] = index;
        this.prev[index] = this.tail;
        this.tail = index;
        return null;
      }

      // otherwise, look for the insertion point like bisect right does
      for (let i = 0, p = point ?? this.tail; i < size; i++, p = this.prev[p]) {
        // if p is tail, we'll skip this first iteration since it was covered by condition above
        if (this.compare(value, this.getValue(p)) >= 0) {
          point = this.next[p];
          this.next[index] = this.next[p];
          this.prev[index] = p;
          this.prev[this.next[p]] = index;
          this.next[p] = index;
          break;
        }
      }

      return point;
    }

    // if we're adding the second item of the list, just compare it to the head
    if (size === 1) {
      let point;
      if (this.compare(value, this.getValue(this.head)) < 0) {
        this.head = index;
        point = this.tail;
      } else {
        this.tail = index;
        point = null;
      }

      // now that we have 2 items in the list, wire them together
      this.next[this.head] = this.tail;
      this.prev[this.tail] = this.head;
      return point;
    }

    // there was no items added to the list yet, so both head and tail point to the new item
    this.head = index;
    this.tail = index;
    return null;
  }

  /**
   * Following bisect right algorithm, returns an insertion point of an item.
   * Returns null if the item can only be placed on the right of the tail.
   */
  search(index: number): number | null {
    let value = this.getValue(index);

    // the item is on the left from the head, head is insertion point
    if (this.compare(value, this.getValue(this.head)) < 0) {
      return this.head;
    }

    // the item is already the right most one,
    // so should be either inserted at tail or parent list should search from its tail
    if (this.compare(value, this.getValue(this.tail)) >= 0) {
      return null;
    }

    let point = this.express != null && this.express.size > 0 ? this.express.search(index) : null;

    for (let i = 0, p = point ?? this.tail; i < this.size; i++, p = this.prev[p]) {
      // if p falls back to tail, we'll skip this first iteration since it was covered by the condition above
      if (this.compare(value, this.getValue(p)) >= 0) {
        point = this.next[p];
        break;
      }
    }

    return point;
  }

  /** Removes an item from local and express lanes. */
  remove(index: number): void {
    // if the item was never added to the list, nothing to do here
    // early return should happen before asking express lane to remove
    // because if local lane doesn't have an item, it won't be in the express lane either
    if (!this.bitset.includes(index)) {
      return;
    }

    this.bitset.unset(index);

    if (this.express != null) {
      this.express.remove(index);
    }

    // if the size was 1, there's no need to make changes in address space
    // as long as we rely on the size for iterating (see insert and search methods)
    if (this.size-- > 1) {
      if (index === this.head) {
        this.head = this.next[this.head];
      } else if (index === this.tail) {
        this.tail = this.prev[this.tail];
      } else {
        this.next[this.prev[index]] = this.next[index];
        this.prev[this.next[index]] = this.prev[index];
      }
    }
  }

  find(predicate: (index: number) => boolean): number | null {
    let target = null;
    let point = this.express != null && this.express.size > 0 ? this.express.find(predicate) : null;
    let cursor = point ?? this.head;
    let prev = null;

    if (!predicate(this.tail)) return null;

    for (let i = 0; i < this.size; i++) {
      if (predicate(cursor)) {
        target = prev;
        break;
      }
      prev = cursor;
      cursor = this.next[cursor];
    }
    return target;
  }

  range(a: Value, b: Value): [number, number] | null {
    // range input needs to be ordered accordingly to the list metric
    [a, b] = [a, b].sort(this.compare);
    if (
      this.size === 0 ||
      this.compare(a, this.getValue(this.tail)) > 0 ||
      this.compare(b, this.getValue(this.head)) < 0
    ) {
      return null;
    }
    let lo = this.find((index) => this.compare(a, this.getValue(index)) <= 0);
    let hi = this.find((index) => this.compare(b, this.getValue(index)) < 0);
    if (lo != null && lo === hi && this.compare(a, this.getValue(lo)) !== 0) {
      // values in range [a, b] do not exist in the list
      return null;
    }
    return [lo != null ? this.next[lo] : this.head, hi != null ? hi : this.tail];
  }
}

const ONE = 0b10000000000000000000000000000000;

export class BitSet {
  bits: Uint32Array;

  constructor(size: number) {
    this.bits = new Uint32Array(Math.ceil(size / 32));
  }

  /** Set a bit to 1 at index. */
  set(index: number) {
    this.bits[index >>> 5] |= ONE >>> index;
  }

  /** Set a bit to 0 at index. */
  unset(index: number) {
    this.bits[index >>> 5] &= ~(ONE >>> index);
  }

  /** Check if an index is set. */
  includes(index: number) {
    return (this.bits[index >>> 5] & (ONE >>> index)) !== 0;
  }

  /**
   * Acquire a predicate function that checks for an index inclusion in the bits.
   * Avoids property lookup.
   */
  predicate() {
    let bits = this.bits;
    return (index: number) => (bits[index >>> 5] & (ONE >>> index)) !== 0;
  }

  /**
   * Efficiently counting number of bits set to 1.
   * @link https://graphics.stanford.edu/~seander/bithacks.html#CountBitsSetParallel
   */
  count() {
    let count = 0;
    for (let index = 0, value; index < this.bits.length; index++) {
      value = this.bits[index];
      value = value - ((value >> 1) & 0x55555555);
      value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
      count += (((value + (value >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
    }
    return count;
  }
}

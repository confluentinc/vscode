import { deepEqual, equal, notDeepEqual } from "node:assert/strict";
import { CircularBuffer, SkipList, Stream, ascending, descending } from "./stream";

import type { PartitionConsumeRecord } from "../clients/sidecar";
import batches from "./messages.json";
import messages from "./orders-topic.json";

describe("stream", () => {
  it("should provide a slice of messages", () => {
    const stream = new Stream(100);
    for (let i = 0; i < 100; i++) stream.insert(messages[i] as PartitionConsumeRecord);
    const { indices, results } = stream.slice(0, 5);
    const originals = indices.map((index) => messages[index]);
    deepEqual(results, originals);
  });

  it("should circle through memory when reaching capacity", () => {
    const stream = new Stream(100);
    for (let i = 0; i < 100; i++) stream.insert(messages[i] as PartitionConsumeRecord);
    const pageA = stream.slice(0, 5);
    const originalA = pageA.indices.map((index) => messages[index]);
    deepEqual(pageA.results, originalA);
    for (let i = 100; i < 200; i++) stream.insert(messages[i] as PartitionConsumeRecord);
    const pageB = stream.slice(0, 5);
    // indices of original array are now expected to be shifted, because `indices` are from circular buffer
    const originalB = pageB.indices.map((index) => messages[index + 100]);
    deepEqual(pageB.results, originalB);
    notDeepEqual(pageA.results, pageB.results);
  });
});

describe("skiplist", () => {
  it("should maintain order (smoke)", () => {
    const b = new CircularBuffer<number>(20);
    const s = new SkipList(20, 1 / 2, (p) => b.values[p], ascending);
    deepEqual(b.values, []);
    deepEqual(Array.from(inline(s)), []);
    s.insert(b.append(0));
    s.insert(b.append(1));
    s.insert(b.append(3));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(3));
    s.insert(b.append(0));
    s.insert(b.append(1));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(5));
    equal(b.size, b.values.length);
    deepEqual(b.values, [0, 1, 3, 5, 5, 5, 5, 3, 0, 1, 5, 5, 5]);
    deepEqual(Array.from(inline(s)), [0, 0, 1, 1, 3, 3, 5, 5, 5, 5, 5, 5, 5]);
  });

  it("should maintain order", () => {
    type Message = { timestamp: number; partition: number };
    const capacity = 3000;
    const messages = new CircularBuffer<Message>(capacity);
    const values = messages.values;

    const timestampOf = (point: number) => values[point].timestamp;
    const timestamp = new SkipList(capacity, 1 / 4, timestampOf, descending);

    const partitionOf = (point: number) => values[point].partition;
    const partition = new SkipList(capacity, 1 / 16, partitionOf, ascending);

    for (const result of batches) {
      for (const part of result) {
        for (const message of part) {
          const index = messages.append(message);
          timestamp.insert(index);
          partition.insert(index);
        }
      }
    }

    deepEqual(
      Array.from(inline(timestamp)),
      batches.flatMap((b) => b.flatMap((p) => p.flatMap((m) => m.timestamp))).sort(descending),
    );

    deepEqual(
      Array.from(inline(partition)),
      batches.flatMap((b) => b.flatMap((p) => p.flatMap((m) => m.partition))).sort(ascending),
    );
  });

  it("should run in circles", () => {
    type Message = { timestamp: number; partition: number };

    const capacity = 100;
    const messages = new CircularBuffer<Message>(capacity);
    const values = messages.values;

    const timestampOf = (point: number) => values[point].timestamp;
    const timestamp = new SkipList(capacity, 1 / 4, timestampOf, descending);

    const partitionOf = (point: number) => values[point].partition;
    const partition = new SkipList(capacity, 1 / 16, partitionOf, ascending);

    let remove = false;
    for (const result of batches) {
      for (const part of result) {
        for (const message of part) {
          const index = messages.append(message);
          if (remove) {
            timestamp.remove(index);
            partition.remove(index);
          }
          timestamp.insert(index);
          partition.insert(index);
          remove = messages.size === capacity;
        }
      }
    }

    deepEqual(
      Array.from(inline(timestamp)),
      batches
        .flatMap((b) => b.flatMap((p) => p.flatMap((m) => m.timestamp)))
        .slice(-100)
        .sort(descending),
    );

    deepEqual(
      Array.from(inline(partition)),
      batches
        .flatMap((b) => b.flatMap((p) => p.flatMap((m) => m.partition)))
        .slice(-100)
        .sort(ascending),
    );
  });

  it("should allow range searches (smoke)", () => {
    const b = new CircularBuffer<number>(20);
    const s = new SkipList(20, 1 / 2, (p) => b.values[p], ascending);
    deepEqual(b.values, []);
    deepEqual(Array.from(inline(s)), []);
    s.insert(b.append(0));
    s.insert(b.append(1));
    s.insert(b.append(3));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(3));
    s.insert(b.append(0));
    s.insert(b.append(1));
    s.insert(b.append(5));
    s.insert(b.append(5));
    s.insert(b.append(5));
    equal(b.size, b.values.length);
    deepEqual(b.values, [0, 1, 3, 5, 5, 5, 5, 3, 0, 1, 5, 5, 5]);
    deepEqual(Array.from(inline(s)), [0, 0, 1, 1, 3, 3, 5, 5, 5, 5, 5, 5, 5]);
    deepEqual(s.range(5, 5), [3, 12]);
    deepEqual(Array.from(collect(s, 3, 12)), [5, 5, 5, 5, 5, 5, 5]);
    deepEqual(s.range(1, 3), [1, 7]);
    deepEqual(Array.from(collect(s, 1, 7)), [1, 1, 3, 3]);
    deepEqual(s.range(2, 4), [2, 7]);
    deepEqual(Array.from(collect(s, 2, 7)), [3, 3]);
    deepEqual(s.range(2, 6), [2, 12]);
    deepEqual(Array.from(collect(s, 2, 12)), [3, 3, 5, 5, 5, 5, 5, 5, 5]);
    deepEqual(s.range(-1, 6), [0, 12]);
    deepEqual(Array.from(collect(s, 0, 12)), [0, 0, 1, 1, 3, 3, 5, 5, 5, 5, 5, 5, 5]);
    deepEqual(s.range(7, 10), null);
    deepEqual(s.range(-9, -1), null);
    deepEqual(s.range(2, 2), null);
  });

  it("should allow range searches", () => {
    type Message = { timestamp: number; partition: number };
    const capacity = 3000;
    const messages = new CircularBuffer<Message>(capacity);
    const values = messages.values;

    const timestampOf = (point: number) => values[point].timestamp;
    const timestamp = new SkipList(capacity, 1 / 4, timestampOf, descending);

    const partitionOf = (point: number) => values[point].partition;
    const partition = new SkipList(capacity, 1 / 16, partitionOf, ascending);

    for (const result of batches) {
      for (const part of result) {
        for (const message of part) {
          const index = messages.append(message);
          timestamp.insert(index);
          partition.insert(index);
        }
      }
    }

    deepEqual(
      Array.from(collect(timestamp, ...timestamp.range(1719962960009, 1719962960009 + 10_000)!)),
      batches
        .flatMap((b) => b.flatMap((p) => p.flatMap((m) => m.timestamp)))
        .sort(descending)
        .filter((v) => v >= 1719962960009 && v <= 1719962960009 + 10_000),
    );

    deepEqual(
      Array.from(collect(partition, ...partition.range(4, 5)!)),
      batches
        .flatMap((b) => b.flatMap((p) => p.flatMap((m) => m.partition)))
        .sort(ascending)
        .filter((v) => v >= 4 && v <= 5),
    );
  });
});

function* inline<Value>(list: SkipList<Value>) {
  for (let cursor = list.head, index = 0; index < list.size; index++, cursor = list.next[cursor]) {
    yield list.getValue(cursor);
  }
}

function* collect<Value>(list: SkipList<Value>, lo: number, hi: number) {
  let cursor = lo;
  while (true) {
    if (cursor === hi) {
      yield list.getValue(cursor);
      break;
    }
    yield list.getValue(cursor);
    cursor = list.next[cursor];
  }
}

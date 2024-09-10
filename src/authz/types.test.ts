// mocha tests over toKafkaTopicOperations
import assert from "assert";
import "mocha";
import { toKafkaTopicOperations } from "./types";

describe("toKafkaTopicOperations", () => {
  it("happy with good input", () => {
    const input = ["READ", "WRITE"];
    const output = toKafkaTopicOperations(input);
    assert.deepStrictEqual(output, input);
  });

  it("throws with unexpected input", () => {
    // 'bad' not in KAFKA_TOPIC_OPERATIONS
    const input = ["READ", "WRITE", "BAD"];
    // catch error, expect 'BAD' to be the bad input
    assert.throws(() => toKafkaTopicOperations(input), "BAD");
  });

  it("empty yields empty", () => {
    const output = toKafkaTopicOperations([]);
    assert.deepStrictEqual(output, []);
  });
});

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

  it("omits unexpected input", () => {
    const input = ["READ", "WRITE", "UNEXPECTED"];
    const output = toKafkaTopicOperations(input);
    assert.deepStrictEqual(output, ["READ", "WRITE"]);
  });

  it("empty yields empty", () => {
    const output = toKafkaTopicOperations([]);
    assert.deepStrictEqual(output, []);
  });
});

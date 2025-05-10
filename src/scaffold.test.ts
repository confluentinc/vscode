import * as assert from "assert";
import * as scaffold from "./scaffold";

describe("filterSensitiveKeys", () => {
  it("filters out keys containing 'key' or 'secret'", () => {
    const input = {
      api_key: "sensitive",
      secret_token: "sensitive",
      bootstrap_server: "localhost:9092",
      topic_name: "test-topic",
    };

    const result = scaffold.filterSensitiveKeys(input);

    assert.deepStrictEqual(
      result,
      {
        bootstrap_server: "localhost:9092",
        topic_name: "test-topic",
      },
      "Should filter out sensitive keys while preserving others",
    );
  });
});

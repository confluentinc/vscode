import * as assert from "assert";
import { removeProtocolPrefix } from "./bootstrapServers";

describe("utils/bootstrapServers.ts removeProtocolPrefix()", () => {
  it("should remove the prefix from bootstrap servers", () => {
    const servers = "localhost:9092,localhost:9093";
    const input = `PLAIN://${servers}`;

    const result: string = removeProtocolPrefix(input);

    assert.strictEqual(result, servers);
  });

  it("should handle empty input", () => {
    const input = "";

    const result: string = removeProtocolPrefix(input);

    assert.strictEqual(result, "");
  });

  it("should handle input without prefix", () => {
    const servers = "localhost:9092,localhost:9093";

    const result: string = removeProtocolPrefix(servers);

    assert.strictEqual(result, servers);
  });
});

import * as assert from "assert";
import * as vscode from "vscode";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { copyBootstrapServers } from "./kafkaClusters";

describe("copyBootstrapServers", () => {
  let _originalClipboardContents: string | undefined;

  beforeEach(async () => {
    // Try to reduce annoying developer running tests corrupting their clipboard.
    _originalClipboardContents = await vscode.env.clipboard.readText();
  });

  afterEach(async () => {
    if (_originalClipboardContents) {
      await vscode.env.clipboard.writeText(_originalClipboardContents);
    }
  });

  it("should copy protocol-free bootstrap server(s) to the clipboard", async () => {
    const testCluster: CCloudKafkaCluster = CCloudKafkaCluster.create({
      ...TEST_CCLOUD_KAFKA_CLUSTER,
      bootstrapServers: "SASL_SSL://s1.com:2343,FOO://s2.com:1234,s4.com:4455",
    });
    await copyBootstrapServers(testCluster);
    const writtenValue = await vscode.env.clipboard.readText();
    // Look ma, no more protocol:// bits.
    assert.strictEqual(writtenValue, "s1.com:2343,s2.com:1234,s4.com:4455");
  });
});

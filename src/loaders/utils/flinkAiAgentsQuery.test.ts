import assert from "assert";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import type { RawFlinkAIAgentRow } from "./flinkAiAgentsQuery";
import { getFlinkAIAgentsQuery, transformRawFlinkAIAgentRows } from "./flinkAiAgentsQuery";

describe("loaders/utils/flinkAiAgentsQuery", () => {
  describe("getFlinkAIAgentsQuery", () => {
    it("should generate SHOW AGENTS query for a database", () => {
      const query = getFlinkAIAgentsQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
      assert.strictEqual(
        query,
        `SHOW AGENTS FROM \`${TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId}\`.\`${TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id}\``,
      );
    });
  });

  describe("transformRawFlinkAIAgentRows", () => {
    it("should transform raw agent rows into FlinkAIAgent objects", () => {
      const rawRows: RawFlinkAIAgentRow[] = [
        { "Agent Name": "claim_processor" },
        { "Agent Name": "data_analyzer" },
      ];

      const agents = transformRawFlinkAIAgentRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rawRows);

      assert.strictEqual(agents.length, 2);

      assert.strictEqual(agents[0].name, rawRows[0]["Agent Name"]);
      assert.strictEqual(agents[0].environmentId, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId);
      assert.strictEqual(agents[0].databaseId, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id);

      assert.strictEqual(agents[1].name, rawRows[1]["Agent Name"]);
    });

    it("should sort agents by name", () => {
      const rawRows: RawFlinkAIAgentRow[] = [
        { "Agent Name": "zebra_agent" },
        { "Agent Name": "alpha_agent" },
      ];

      const agents = transformRawFlinkAIAgentRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rawRows);

      assert.strictEqual(agents.length, 2);
      assert.strictEqual(agents[0].name, rawRows[1]["Agent Name"]);
      assert.strictEqual(agents[1].name, rawRows[0]["Agent Name"]);
    });

    it("should handle empty result set", () => {
      const agents = transformRawFlinkAIAgentRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, []);
      assert.strictEqual(agents.length, 0);
    });
  });
});

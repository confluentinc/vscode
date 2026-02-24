import * as assert from "assert";
import { createFakeFlinkDatabaseResource } from "../../../tests/unit/testResources/flinkDatabaseResource";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { FlinkDatabaseResource } from "../flinkDatabaseResource";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResourceContainer";

describe("models/flinkDatabaseResourceContainer", () => {
  describe("FlinkDatabaseResourceContainer", () => {
    describe("constructor", () => {
      it("should set connectionId to CCLOUD_CONNECTION_ID", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);

        assert.strictEqual(container.connectionId, CCLOUD_CONNECTION_ID);
      });

      it("should set connectionType to Ccloud", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);

        assert.strictEqual(container.connectionType, ConnectionType.Ccloud);
      });

      it("should set id to connectionId-label", () => {
        const label = "Test Database";
        const container = new FlinkDatabaseResourceContainer(label, [
          createFakeFlinkDatabaseResource(),
        ]);

        assert.strictEqual(container.id, `${CCLOUD_CONNECTION_ID}-${label}`);
      });
    });
  });
});

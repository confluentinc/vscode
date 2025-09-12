import * as assert from "assert";
import { getCommandArgsContext, RESOURCE_ID_FIELDS } from ".";
import { ConnectionType } from "../clients/sidecar";
import { ConnectionId, IResourceBase } from "../models/resource";
import { titleCase } from "../utils";

describe("commands/index.ts", () => {
  describe("registerCommandWithLogging", () => {
    it("should throw if command name does not start with 'confluent.'", () => {
      assert.throws(() => {
        getCommandArgsContext(["not-a-valid-command"]);
      }, /must start with "confluent."/);
    });
  });

  describe("getCommandArgsContext", () => {
    it("should handle no args", () => {
      const result = getCommandArgsContext([]);

      assert.deepStrictEqual(result, {});
    });

    it("should handle undefined first arg", () => {
      const result = getCommandArgsContext([undefined]);

      assert.deepStrictEqual(result, {});
    });

    it("should include 'resourceConnectionType' when the first arg implements IResourceBase", () => {
      const fakeResource: IResourceBase = {
        connectionId: "abc123" as ConnectionId,
        connectionType: ConnectionType.Direct,
      };

      const result = getCommandArgsContext([fakeResource]);

      assert.deepStrictEqual(result, {
        resourceConnectionType: fakeResource.connectionType,
      });
    });

    for (const idField of RESOURCE_ID_FIELDS) {
      const expectedField = `resource${titleCase(idField)}`;

      it(`should include '${expectedField}' if '${idField}' exists on the first arg`, () => {
        const fakeResource = {
          [idField]: "abc123",
        };

        const result = getCommandArgsContext([fakeResource]);

        assert.deepStrictEqual(result, {
          [expectedField]: fakeResource[idField],
        });
      });
    }
  });
});

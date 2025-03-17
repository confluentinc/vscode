import * as assert from "assert";
import { getCommandArgsContext, RESOURCE_ID_FIELDS } from ".";
import { ConnectionType } from "../clients/sidecar";
import { ConnectionId, IResourceBase } from "../models/resource";

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

  it("should include 'resourceType'' when the first arg is one of our resource models");

  for (const idField of RESOURCE_ID_FIELDS) {
    const idFieldTitleCase = idField.charAt(0).toUpperCase() + idField.slice(1);
    const expectedField = `resource${idFieldTitleCase}`;

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

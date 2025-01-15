// tests over isConnectionStable

import * as assert from "assert";

import {
  TEST_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_LOCAL_CONNECTION,
} from "../../tests/unit/testResources/connection";

import { ConnectedState, Status } from "../clients/sidecar/models";
import { ConnectionEventAction, ConnectionEventBody } from "../ws/messageTypes";
import { isConnectionStable } from "./connectionStatusUtils";

describe("isConnectionStable", () => {
  const testAuthStatus = { authentication: { status: Status.NoToken } };

  it("ccloud connection tests", () => {
    type CCloudConnectionStateAndResult = [ConnectedState, boolean];

    // ccloud connection is stable if not in Attempting state
    const testCases: CCloudConnectionStateAndResult[] = [
      [ConnectedState.None, false],
      [ConnectedState.Attempting, true],
      [ConnectedState.Success, true],
      [ConnectedState.Expired, true],
      [ConnectedState.Failed, true],
    ];

    for (const [connectedState, expectedResult] of testCases) {
      const testConnection: ConnectionEventBody = {
        action: ConnectionEventAction.UPDATED,
        connection: {
          ...TEST_CCLOUD_CONNECTION,
          status: {
            ccloud: { state: connectedState },
            ...testAuthStatus,
          },
        },
      };
      assert.strictEqual(isConnectionStable(testConnection), expectedResult);
    }
  });

  it("direct connection tests", () => {
    type LocalConnectionStatesAndResult = [ConnectedState, ConnectedState, boolean];

    // direct connection is stable if neither kafka nor schema registry are attempting
    const testCases: LocalConnectionStatesAndResult[] = [
      [ConnectedState.None, ConnectedState.None, true],
      [ConnectedState.None, ConnectedState.Success, true],
      [ConnectedState.Success, ConnectedState.None, true],
      [ConnectedState.Attempting, ConnectedState.None, false],
      [ConnectedState.None, ConnectedState.Attempting, false],
      [ConnectedState.Attempting, ConnectedState.Attempting, false],
      [ConnectedState.Success, ConnectedState.Success, true],
      [ConnectedState.Expired, ConnectedState.Expired, true],
      [ConnectedState.Failed, ConnectedState.Failed, true],
    ];

    for (const [kafkaState, schemaRegistryState, expectedResult] of testCases) {
      const testConnection = {
        action: ConnectionEventAction.UPDATED,
        connection: {
          ...TEST_DIRECT_CONNECTION,
          status: {
            kafka_cluster: { state: kafkaState },
            schema_registry: { state: schemaRegistryState },
            ...testAuthStatus,
          },
        },
      };
      assert.strictEqual(isConnectionStable(testConnection), expectedResult);
    }
  });

  it("should raise when asked about a local connection (not implemented yet)", () => {
    assert.throws(
      () =>
        isConnectionStable({
          action: ConnectionEventAction.UPDATED,
          connection: TEST_LOCAL_CONNECTION,
        }),
      /Unhandled connection type LOCAL/,
    );
  });
});

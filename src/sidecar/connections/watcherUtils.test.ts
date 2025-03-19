// tests over isConnectionStable

import * as assert from "assert";

import {
  TEST_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_LOCAL_CONNECTION,
} from "../../../tests/unit/testResources/connection";

import sinon from "sinon";
import * as ccloudStateHandling from "../../authn/ccloudStateHandling";
import { ConnectedState, Status } from "../../clients/sidecar/models";
import { connectionStable, directConnectionCreated, environmentChanged } from "../../emitters";
import { ConnectionEventAction, ConnectionEventBody } from "../../ws/messageTypes";
import { connectionEventHandler, isConnectionStable } from "./watcherUtils";

describe("connectionEventHandler", () => {
  // signon sandbox for connectionStable and  environmentChanged event emitters
  let sandbox: sinon.SinonSandbox;
  let connectionStableFireStub: sinon.SinonStub;
  let environmentChangedFireStub: sinon.SinonStub;
  let directConnectionCreatedStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    connectionStableFireStub = sandbox.stub(connectionStable, "fire");
    environmentChangedFireStub = sandbox.stub(environmentChanged, "fire");
    directConnectionCreatedStub = sandbox.stub(directConnectionCreated, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  for (const action of [
    ConnectionEventAction.CREATED,
    ConnectionEventAction.UPDATED,
    ConnectionEventAction.CONNECTED,
    ConnectionEventAction.DISCONNECTED,
  ]) {
    it(`CCloud connection update should cascade through to call ccloudStateHandling.reactToCCloudAuthState on ${action}`, () => {
      // connectionEventHandler() should call through to ccloudStateHandling.reactToCCloudAuthState()
      // upon reciept of a connection event for the CCloud connection.

      // Arrange
      const reactToCCloudAuthStateStub = sandbox
        .stub(ccloudStateHandling, "reactToCCloudAuthState")
        .resolves();

      const testConnectionEvent: ConnectionEventBody = {
        action: action,
        connection: TEST_CCLOUD_CONNECTION,
      };

      // Act
      connectionEventHandler(testConnectionEvent);

      // Assert
      assert.strictEqual(
        reactToCCloudAuthStateStub.calledOnce,
        true,
        "reactToCCloudAuthState called",
      );

      assert.ok(
        reactToCCloudAuthStateStub.calledWith(TEST_CCLOUD_CONNECTION),
        `reactToCCloudAuthState called with ${reactToCCloudAuthStateStub.getCall(0).args[0]}`,
      );

      // ccloud events should never fire directConnectionCreatedStub
      assert.strictEqual(directConnectionCreatedStub.notCalled, true);
    });
  }

  it("CCloud connection DELETED event should not call ccloudStateHandling.reactToCCloudAuthState", () => {
    // Arrange
    const reactToCCloudAuthStateStub = sandbox
      .stub(ccloudStateHandling, "reactToCCloudAuthState")
      .resolves();

    const testConnectionEvent: ConnectionEventBody = {
      action: ConnectionEventAction.DELETED,
      connection: TEST_CCLOUD_CONNECTION,
    };

    // Act
    connectionEventHandler(testConnectionEvent);

    // Assert
    assert.strictEqual(reactToCCloudAuthStateStub.notCalled, true);
  });

  for (const action of [
    ConnectionEventAction.CREATED,
    ConnectionEventAction.UPDATED,
    ConnectionEventAction.CONNECTED,
    ConnectionEventAction.DELETED,
    ConnectionEventAction.DISCONNECTED,
  ]) {
    it(`should fire when stable direct connection ${action} event received`, () => {
      // Arrange
      const testConnectionEvent: ConnectionEventBody = {
        action: action,
        connection: TEST_DIRECT_CONNECTION,
      };

      // Act
      connectionEventHandler(testConnectionEvent);

      // Assert
      assert.strictEqual(connectionStableFireStub.calledOnce, true);
      // called with the connection id
      assert.strictEqual(connectionStableFireStub.calledWith(TEST_DIRECT_CONNECTION.id), true);

      assert.strictEqual(environmentChangedFireStub.calledOnce, true);

      assert.strictEqual(
        environmentChangedFireStub.calledWith({
          id: TEST_DIRECT_CONNECTION.id,
          wasDeleted:
            action === ConnectionEventAction.DELETED ||
            action === ConnectionEventAction.DISCONNECTED,
        }),
        true,
      );

      // directConnectionCreatedStub should be called only for CREATED events
      if (action === ConnectionEventAction.CREATED) {
        assert.strictEqual(
          directConnectionCreatedStub.calledOnce,
          true,
          "directConnectionCreatedStub called",
        );
      } else {
        assert.strictEqual(
          directConnectionCreatedStub.notCalled,
          true,
          "directConnectionCreatedStub not called",
        );
      }
    });
  }

  it("should not fire when unstable direct connection event received", () => {
    // Arrange
    const testConnectionEvent: ConnectionEventBody = {
      action: ConnectionEventAction.UPDATED,
      connection: {
        ...TEST_DIRECT_CONNECTION,
        status: {
          // either one of these being in Attempting state should prevent firing.
          kafka_cluster: { state: ConnectedState.Attempting },
          schema_registry: { state: ConnectedState.Success },
          authentication: { status: Status.NoToken },
        },
      },
    };

    // Act
    connectionEventHandler(testConnectionEvent);

    // Assert
    assert.strictEqual(connectionStableFireStub.notCalled, true);
    assert.strictEqual(environmentChangedFireStub.notCalled, true);
  });
});

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

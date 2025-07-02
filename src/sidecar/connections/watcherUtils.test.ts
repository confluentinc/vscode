// tests over isConnectionStable

import * as assert from "assert";

import {
  TEST_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_LOCAL_CONNECTION,
} from "../../../tests/unit/testResources/connection";

import sinon from "sinon";
import * as ccloudStateHandling from "../../authn/ccloudStateHandling";
import { ConnectedState } from "../../clients/sidecar/models";
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
    it(`CCloud connection update should cascade through to call ccloudStateHandling.handleUpdatedConnection on ${action}`, () => {
      // connectionEventHandler() should call through to ccloudStateHandling.handleUpdatedConnection()
      // upon reciept of a connection event for the CCloud connection.

      // Arrange
      const handleUpdatedConnectionStub = sandbox
        .stub(ccloudStateHandling, "handleUpdatedConnection")
        .resolves();

      const testConnectionEvent: ConnectionEventBody = {
        action: action,
        connection: TEST_CCLOUD_CONNECTION,
      };

      // Act
      connectionEventHandler(testConnectionEvent);

      // Assert
      assert.strictEqual(
        handleUpdatedConnectionStub.calledOnce,
        true,
        "handleUpdatedConnection called",
      );

      assert.ok(
        handleUpdatedConnectionStub.calledWith(TEST_CCLOUD_CONNECTION),
        `handleUpdatedConnection called with ${handleUpdatedConnectionStub.getCall(0).args[0]}`,
      );

      // ccloud events should never fire directConnectionCreatedStub
      sinon.assert.notCalled(directConnectionCreatedStub);
    });
  }

  it("CCloud connection DELETED event should not call ccloudStateHandling.handleUpdatedConnection", () => {
    // Arrange
    const handleUpdatedConnectionStub = sandbox
      .stub(ccloudStateHandling, "handleUpdatedConnection")
      .resolves();

    const testConnectionEvent: ConnectionEventBody = {
      action: ConnectionEventAction.DELETED,
      connection: TEST_CCLOUD_CONNECTION,
    };

    // Act
    connectionEventHandler(testConnectionEvent);

    // Assert
    assert.strictEqual(handleUpdatedConnectionStub.notCalled, true);
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
        sinon.assert.calledOnce(directConnectionCreatedStub);
      } else {
        sinon.assert.notCalled(directConnectionCreatedStub);
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
  it("ccloud connection tests", () => {
    type CCloudConnectionStateAndResult = [ConnectedState, boolean];

    const testCases: CCloudConnectionStateAndResult[] = [
      [ConnectedState.None, true],
      [ConnectedState.Success, true],
      [ConnectedState.Expired, false],
      [ConnectedState.Failed, true],
      // CCloud connections don't use ATTEMPTING like direct connections do, see
      // https://github.com/confluentinc/ide-sidecar/blob/b2dd9932849fd758f489661c0b8aebcde8681616/src/main/java/io/confluent/idesidecar/restapi/connections/CCloudConnectionState.java#L57-L82
    ];

    for (const [connectedState, expectedResult] of testCases) {
      const testConnection: ConnectionEventBody = {
        action: ConnectionEventAction.UPDATED,
        connection: {
          ...TEST_CCLOUD_CONNECTION,
          status: {
            ccloud: { state: connectedState },
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

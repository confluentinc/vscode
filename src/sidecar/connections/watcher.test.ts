import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_DIRECT_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import { TEST_AUTHTYPES_AND_CREDS } from "../../../tests/unit/testResources/authCredentials";
import {
  TEST_AUTHENTICATED_CCLOUD_CONNECTION,
  TEST_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_DIRECT_CONNECTION_FORM_SPEC,
  TEST_DIRECT_CONNECTION_ID,
  TEST_LOCAL_CONNECTION,
} from "../../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import {
  ConnectedState,
  Connection,
  ConnectionFromJSON,
  ConnectionType,
  instanceOfConnection,
  Status,
} from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import { connectionStable } from "../../emitters";
import * as errors from "../../errors";
import { ConnectionId } from "../../models/resource";
import * as notifications from "../../notifications";
import { getResourceManager } from "../../storage/resourceManager";
import {
  ConnectionEventAction,
  ConnectionEventBody,
  Message,
  MessageType,
  newMessageHeaders,
} from "../../ws/messageTypes";
import {
  ConnectionStateWatcher,
  ConnectionSummary,
  getConnectionSummaries,
  reportUsableState,
  SingleConnectionEntry,
  waitForConnectionToBeStable,
} from "./watcher";
import * as watcherUtils from "./watcherUtils";

describe("sidecar/connections/watcher.ts ConnectionStateWatcher handleConnectionUpdateEvent()", () => {
  let sandbox: sinon.SinonSandbox;
  let connectionEventHandlerStub: sinon.SinonStub;
  let logErrorStub: sinon.SinonStub;

  let connectionStateWatcher: ConnectionStateWatcher;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    connectionStateWatcher = ConnectionStateWatcher.getInstance();
    connectionEventHandlerStub = sandbox.stub(watcherUtils, "connectionEventHandler").returns();
    logErrorStub = sandbox.stub(errors, "logError").resolves();
  });

  afterEach(() => {
    connectionStateWatcher.purgeCachedConnectionState(CCLOUD_CONNECTION_ID);
    sandbox.restore();
  });

  it("should basically work when given good message", async () => {
    const message: Message<MessageType.CONNECTION_EVENT> = {
      headers: newMessageHeaders(MessageType.CONNECTION_EVENT),
      body: {
        action: ConnectionEventAction.UPDATED,
        connection: TEST_AUTHENTICATED_CCLOUD_CONNECTION,
      },
    };

    await connectionStateWatcher.handleConnectionUpdateEvent(message);

    assert.ok(connectionEventHandlerStub.calledOnce);
    assert.ok(logErrorStub.notCalled);
    const cachedEvent = connectionStateWatcher.getLatestConnectionEvent(
      TEST_AUTHENTICATED_CCLOUD_CONNECTION.id as ConnectionId,
    );
    assert.ok(cachedEvent);
    assert.ok(instanceOfConnection(cachedEvent.connection));
    assert.deepEqual(cachedEvent.connection, TEST_AUTHENTICATED_CCLOUD_CONNECTION);
  });
});

describe("sidecar/connections/watcher.ts waitForConnectionToBeStable()", () => {
  const connectionStateWatcher = ConnectionStateWatcher.getInstance();

  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let connectionStableFireStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub the event emitter
    connectionStableFireStub = sandbox.stub(connectionStable, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  function announceConnectionState(connection: Connection): void {
    // inject a event to updated the connection state
    // as if sent from sidecar from websocket.
    const websocketMessage: Message<MessageType.CONNECTION_EVENT> = {
      headers: newMessageHeaders(MessageType.CONNECTION_EVENT),
      body: {
        action: ConnectionEventAction.UPDATED,
        connection: connection,
      },
    };

    // As if had been just sent from sidecar.
    connectionStateWatcher.handleConnectionUpdateEvent(websocketMessage);
  }

  // dynamically set up tests for `waitForConnectionToBeStable()` using different connections and states
  type ConnectionStateMatches = [
    Connection,
    ConnectedState,
    ConnectedState,
    ConnectedState,
    ConnectedState,
  ];
  const connectionStateMatches: ConnectionStateMatches[] = [
    [
      TEST_CCLOUD_CONNECTION,
      ConnectedState.None,
      ConnectedState.None,
      ConnectedState.None,
      ConnectedState.Success,
    ],
    [
      TEST_DIRECT_CONNECTION,
      ConnectedState.Attempting,
      ConnectedState.Success,
      ConnectedState.Success,
      ConnectedState.None,
    ],
  ];

  for (const [
    baseConnection,
    pendingState,
    usableKafkaClusterState,
    usableSchemaRegistryState,
    usableCcloudState,
  ] of connectionStateMatches) {
    const testConnectionId = baseConnection.id as ConnectionId;
    // we aren't worried about `status.authentication` for this function, but it's required for the
    // ConnectionStatus interface, e.g.:
    // "Property 'authentication' is missing in type ... but required in type 'ConnectionStatus'."
    const testAuthStatus = { authentication: { status: Status.NoToken } };

    it(`${baseConnection.spec.type}: waitForConnectionToBeStable() should return the connection when it becomes usable`, async () => {
      const testConnection: Connection = ConnectionFromJSON({
        ...baseConnection,
        status: {
          kafka_cluster: { state: usableKafkaClusterState },
          schema_registry: { state: usableSchemaRegistryState },
          ccloud: { state: usableCcloudState },
          ...testAuthStatus,
        },
      });

      announceConnectionState(testConnection);

      const connection = await waitForConnectionToBeStable(testConnectionId);

      assert.deepStrictEqual(connection, testConnection);
    });

    it(`${baseConnection.spec.type}: waitForConnectionToBeStable() should return null if the connection does not become usable within the timeout`, async () => {
      // use fake timers so we can control the time and "time out" quickly
      clock = sandbox.useFakeTimers(Date.now());

      const testConnection: Connection = ConnectionFromJSON({
        ...baseConnection,
        status: {
          kafka_cluster: { state: pendingState },
          schema_registry: { state: pendingState },
          ccloud: { state: pendingState },
          ...testAuthStatus,
        },
      });
      announceConnectionState(testConnection);

      // set a short timeout, even though we're using fake timers
      const shortTimeoutMs = 10;
      const connectionPromise: Promise<Connection | null> = waitForConnectionToBeStable(
        testConnectionId,
        shortTimeoutMs,
      );
      // "wait" for the timeout to occur
      await clock.tickAsync(300);
      await assert.doesNotReject(connectionPromise);
      const result = await connectionPromise;
      assert.strictEqual(result, null);
      // even if we hit a timeout, we need to stop the "loading" state
      assert.ok(connectionStableFireStub.calledOnce);
    });

    it(`${baseConnection.spec.type}: waitForConnectionToBeStable() should wait for websocket event if the connection is not found initially`, async () => {
      const testConnection = ConnectionFromJSON({
        ...baseConnection,
        status: {
          kafka_cluster: { state: usableKafkaClusterState },
          schema_registry: { state: usableSchemaRegistryState },
          ccloud: { state: usableCcloudState },
          ...testAuthStatus,
        },
      });

      // wrap a spy around isConnectionStable so we can check when it's called
      const isConnectionStableSpy = sandbox.spy(watcherUtils, "isConnectionStable");

      // clear out prior connection state so that top of ConnectionStateWatcher.waitForConnectionUpdate will be a cache
      // miss and it has to wait for an update.
      connectionStateWatcher.purgeCachedConnectionState(testConnectionId);

      clock = sandbox.useFakeTimers(Date.now());

      async function scriptEventFlow() {
        // let time pass some ...
        await clock.tickAsync(100);

        // isConnectionStableSpy should not have been called yet.
        assert.ok(isConnectionStableSpy.notCalled);

        // simulate a websocket event that updates the connection state to this new stable state.
        announceConnectionState(testConnection);

        // And now isConnectionStable should have been called.
        assert.ok(isConnectionStableSpy.calledOnce);
        // and it should have returned true
        assert.ok(isConnectionStableSpy.returned(true));
      }

      // await both the script and waitForConnectionToBeStable
      const results = await Promise.all([
        scriptEventFlow(),
        waitForConnectionToBeStable(testConnectionId),
      ]);

      // waitForConnectionToBeStable should have returned the connection
      assert.deepStrictEqual(results[1], testConnection);
      // and that isDirectConnectionStable was called (after the websocket event)
      // log number of calls.
      assert.ok(isConnectionStableSpy.calledOnce);
    });
  }
});

describe("sidecar/connections/watcher.ts SingleConnectionEntry", () => {
  let sandbox: sinon.SinonSandbox;
  let eventEmitterFireSub: sinon.SinonStub;
  let singleConnectionEntry: SingleConnectionEntry;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    singleConnectionEntry = new SingleConnectionEntry(TEST_DIRECT_CONNECTION_ID);
    eventEmitterFireSub = sandbox.stub(singleConnectionEntry.eventEmitter, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("constructor tests", () => {
    // as derived from the connection id
    assert.strictEqual(ConnectionType.Direct, singleConnectionEntry.connectionType);
    // won't be set until we get a connection
    assert.strictEqual(null, singleConnectionEntry.connection);
  });

  it("SingleConnectionEntry handleUpdate tests", () => {
    // Arrange
    const firstEvent: ConnectionEventBody = {
      action: ConnectionEventAction.CREATED,
      connection: {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafka_cluster: { state: ConnectedState.Attempting },
          schema_registry: { state: ConnectedState.Attempting },
          authentication: { status: Status.NoToken },
        },
      },
    };

    // edging from no prior state to a new state should retain the new state
    // and fire the event.
    singleConnectionEntry.handleUpdate(firstEvent);

    assert.deepEqual(firstEvent, singleConnectionEntry.mostRecentEvent);
    assert.ok(eventEmitterFireSub.calledOnce);
    // Now assigned.
    assert.deepEqual(firstEvent.connection, singleConnectionEntry.connection);

    eventEmitterFireSub.reset();

    // A new event about the same connection should trigger a subsequent fire.
    const secondEvent: ConnectionEventBody = {
      action: ConnectionEventAction.UPDATED,
      connection: {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafka_cluster: { state: ConnectedState.Success },
          schema_registry: { state: ConnectedState.Success },
          authentication: { status: Status.ValidToken },
        },
      },
    };

    singleConnectionEntry.handleUpdate(secondEvent);
    assert.ok(eventEmitterFireSub.calledOnce);
    // reassigned.
    assert.deepEqual(secondEvent.connection, singleConnectionEntry.connection);
  });

  it("handleUpdate throws error if called with a mismatched connection", () => {
    const badEvent: ConnectionEventBody = {
      action: ConnectionEventAction.CREATED,
      connection: {
        // wrong connection id from what singleConnectionEntry created to track.
        ...TEST_CCLOUD_CONNECTION,
        status: {
          kafka_cluster: { state: ConnectedState.Attempting },
          schema_registry: { state: ConnectedState.Attempting },
          authentication: { status: Status.NoToken },
        },
      },
    };

    assert.throws(() => singleConnectionEntry.handleUpdate(badEvent));
  });
});

describe("sidecar/connections/watcher.ts reportUsableState() notifications", () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorNotificationStub: sinon.SinonStub;

  const fakeDirectConnectionButtonLabel = "View Connection Details";

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should not show a notification if a DIRECT connection does not have any FAILED states", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Success },
        schema_registry: { state: ConnectedState.Success },
        authentication: { status: Status.NoToken },
      },
    };

    await reportUsableState(connection);

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("should show a notification if a DIRECT connection has a FAILED `kafka_cluster` state", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Failed },
        schema_registry: { state: ConnectedState.Success },
        authentication: { status: Status.NoToken },
      },
    };

    await reportUsableState(connection);

    sinon.assert.calledOnce(showErrorNotificationStub);
    const callArgs = showErrorNotificationStub.getCall(0).args;
    assert.strictEqual(
      callArgs[0],
      `Failed to establish connection to Kafka for "${connection.spec.name}".`,
    );
    // a button should be provided
    assert.ok(callArgs[1][fakeDirectConnectionButtonLabel]);
  });

  it("should show a notification if a DIRECT connection has a FAILED `schema_registry` state", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Success },
        schema_registry: { state: ConnectedState.Failed },
        authentication: { status: Status.NoToken },
      },
    };

    await reportUsableState(connection);

    assert.ok(showErrorNotificationStub.calledOnce);
    const callArgs = showErrorNotificationStub.getCall(0).args;
    assert.strictEqual(
      callArgs[0],
      `Failed to establish connection to Schema Registry for "${connection.spec.name}".`,
    );
    assert.ok(callArgs[1][fakeDirectConnectionButtonLabel]);
  });

  it("should show a notification if a DIRECT connection has FAILED `kafka_cluster` and FAILED `schema_registry` states", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Failed },
        schema_registry: { state: ConnectedState.Failed },
        authentication: { status: Status.NoToken },
      },
    };

    await reportUsableState(connection);

    assert.ok(showErrorNotificationStub.calledOnce);
    const callArgs = showErrorNotificationStub.getCall(0).args;
    assert.strictEqual(
      callArgs[0],
      `Failed to establish connection to Kafka and Schema Registry for "${connection.spec.name}".`,
    );
    assert.ok(callArgs[1][fakeDirectConnectionButtonLabel]);
  });

  it("should not show a notification if a DIRECT connection has a FAILED `ccloud` state", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        // these should not be possible with a DIRECT connection type, but still:
        ccloud: { state: ConnectedState.Failed },
        authentication: { status: Status.Failed },
      },
    };

    await reportUsableState(connection);

    assert.ok(showErrorNotificationStub.notCalled);
  });

  it("should not show a notification if a CCLOUD connection does not have a FAILED `ccloud` state", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Success },
        authentication: { status: Status.ValidToken },
      },
    };

    await reportUsableState(connection);

    assert.ok(showErrorNotificationStub.notCalled);
  });

  it("should show a notification if a CCLOUD connection has a FAILED `ccloud` state", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Failed },
        authentication: { status: Status.Failed },
      },
    };

    await reportUsableState(connection);

    assert.ok(showErrorNotificationStub.calledOnce);
    const callArgs = showErrorNotificationStub.getCall(0).args;
    assert.strictEqual(
      callArgs[0],
      `Failed to establish connection to Confluent Cloud for "${connection.spec.name}".`,
    );
    assert.strictEqual(callArgs[1], undefined);
  });

  it("should not show a notification if a CCLOUD connection has FAILED `kafka_cluster` and FAILED `schema_registry` states", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        // these should not be possible with a CCLOUD connection type, but still:
        kafka_cluster: { state: ConnectedState.Failed },
        schema_registry: { state: ConnectedState.Failed },
        authentication: { status: Status.ValidToken },
      },
    };

    await reportUsableState(connection);

    assert.ok(showErrorNotificationStub.notCalled);
  });

  // TODO(shoup): remove this after the LOCAL connection migrates to a DIRECT connection
  it("should not show a notification for a LOCAL connection, even with FAILED states", async () => {
    const connection: Connection = {
      ...TEST_LOCAL_CONNECTION,
      spec: { type: ConnectionType.Local },
      status: {
        // none of this should be possible with a LOCAL connection type, but still:
        kafka_cluster: { state: ConnectedState.Failed },
        schema_registry: { state: ConnectedState.Failed },
        ccloud: { state: ConnectedState.Failed },
        authentication: { status: Status.Failed },
      },
    };

    await reportUsableState(connection);

    assert.ok(showErrorNotificationStub.notCalled);
  });
});

describe("sidecar/connections/watcher.ts getConnectionSummaries()", () => {
  let sandbox: sinon.SinonSandbox;

  let getDirectConnectionStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    getDirectConnectionStub = sandbox.stub(getResourceManager(), "getDirectConnection");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return a Kafka config summary when state matches for a DIRECT connection", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Success },
        schema_registry: { state: ConnectedState.Failed }, // not checked in this test, ignore it
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].connectionType, ConnectionType.Direct);
    assert.strictEqual(summaries[0].configType, "Kafka");
    assert.strictEqual(summaries[0].connectedState, ConnectedState.Success);
    assert.strictEqual(summaries[0].failedReason, undefined);
  });

  it("should return a Schema Registry config summary when state matches for a DIRECT connection", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Failed }, // not checked in this test, ignore it
        schema_registry: { state: ConnectedState.Success },
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].connectionType, ConnectionType.Direct);
    assert.strictEqual(summaries[0].configType, "Schema Registry");
    assert.strictEqual(summaries[0].connectedState, ConnectedState.Success);
    assert.strictEqual(summaries[0].failedReason, undefined);
  });

  it("should return Kafka+SR summaries when both states match for a DIRECT connection", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Success },
        schema_registry: { state: ConnectedState.Success },
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 2);
    const configTypes = summaries.map((summary) => summary.configType);
    assert.ok(configTypes.includes("Kafka"));
    assert.ok(configTypes.includes("Schema Registry"));
    assert.strictEqual(summaries[0].connectionType, ConnectionType.Direct);
    assert.strictEqual(summaries[1].connectionType, ConnectionType.Direct);
  });

  it("should return no summaries when no states match for DIRECT connection", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Failed },
        schema_registry: { state: ConnectedState.Failed },
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 0);
  });

  it("should include the form connection type when state matches for a DIRECT connection", async () => {
    // stored CustomConnectionType
    getDirectConnectionStub.resolves(TEST_DIRECT_CONNECTION_FORM_SPEC);

    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      // the ids here should be the same anyway, but just in case
      id: TEST_DIRECT_CONNECTION_FORM_SPEC.id,
      status: {
        kafka_cluster: { state: ConnectedState.Success },
        schema_registry: { state: ConnectedState.Failed },
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].connectionType, ConnectionType.Direct);
    assert.strictEqual(summaries[0].type, TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType);
  });

  for (const [authType, credentials] of TEST_AUTHTYPES_AND_CREDS.entries())
    it(`should include SSL and auth type (${authType}) in the summary for DIRECT connection`, async () => {
      const connection: Connection = {
        ...TEST_DIRECT_CONNECTION,
        spec: {
          ...TEST_DIRECT_CONNECTION.spec,
          kafka_cluster: {
            bootstrap_servers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
            credentials,
            ssl: { enabled: true },
          },
        },
        status: {
          kafka_cluster: { state: ConnectedState.Success },
          authentication: { status: Status.NoToken },
        },
      };

      const summaries: ConnectionSummary[] = await getConnectionSummaries(
        connection,
        ConnectedState.Success,
      );

      assert.strictEqual(summaries.length, 1);
      assert.strictEqual(summaries[0].sslEnabled, true);
      assert.strictEqual(summaries[0].authType, authType);
    });

  it("should return a summary when CCloud state matches for CCLOUD connection", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Success },
        authentication: { status: Status.ValidToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].connectionType, ConnectionType.Ccloud);
    assert.strictEqual(summaries[0].configType, "Confluent Cloud");
    assert.strictEqual(summaries[0].authType, "Browser");
    assert.strictEqual(summaries[0].connectedState, ConnectedState.Success);
  });

  it("should return no summary when CCloud state doesn't match for CCLOUD connection", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Failed },
        authentication: { status: Status.ValidToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 0);
  });

  it("should handle undefined statuses gracefully", async () => {
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        // missing kafka_cluster and schema_registry
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Success,
    );

    assert.strictEqual(summaries.length, 0);
  });

  it("should include failedReason for DIRECT connection summaries where Kafka state is FAILED", async () => {
    const kafkaFailedMessage = "Failed to connect to Kafka";
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: {
          state: ConnectedState.Failed,
          errors: { sign_in: { message: kafkaFailedMessage } },
        },
        schema_registry: { state: ConnectedState.Success },
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Failed,
    );

    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].failedReason, kafkaFailedMessage);
  });

  it("should include failedReason for DIRECT connection summaries where Schema Registry state is FAILED", async () => {
    const srFailedMessage = "Failed to connect to Schema Registry";
    const connection: Connection = {
      ...TEST_DIRECT_CONNECTION,
      status: {
        kafka_cluster: { state: ConnectedState.Success },
        schema_registry: {
          state: ConnectedState.Failed,
          errors: { sign_in: { message: srFailedMessage } },
        },
        authentication: { status: Status.NoToken },
      },
    };

    const summaries: ConnectionSummary[] = await getConnectionSummaries(
      connection,
      ConnectedState.Failed,
    );

    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].failedReason, srFailedMessage);
  });
});

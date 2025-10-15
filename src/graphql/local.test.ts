import * as assert from "assert";
import * as sinon from "sinon";

import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { getSidecarStub } from "../../tests/stubs/sidecar";

import { LOCAL_CONNECTION_ID } from "../constants";
import type { SidecarHandle } from "../sidecar";
import { getLocalResources } from "./local";

describe("local.ts getLocalResources()", () => {
  let sandbox: sinon.SinonSandbox;
  let sidecarStub: sinon.SinonStubbedInstance<SidecarHandle>;

  let showErrorNotificationStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sidecarStub = getSidecarStub(sandbox);
    showErrorNotificationStub = getShowErrorNotificationWithButtonsStub(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("returns empty array and shows notification if error making graphql call", async () => {
    sidecarStub.query.rejects(new Error("Query failed"));

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.calledOnce(showErrorNotificationStub);
  });

  it("calls query with showPartialErrors=false so that if we have kafka, but not schema reg, we won't show popup about it", async () => {
    sidecarStub.query.resolves({ localConnections: [] });

    await getLocalResources();

    sinon.assert.calledOnce(sidecarStub.query);
    assert.strictEqual(sidecarStub.query.firstCall.args[1], LOCAL_CONNECTION_ID);
    assert.strictEqual(sidecarStub.query.firstCall.args[2], false); // suppress partial error notifications
  });

  it("returns empty array if no local connections are returned", async () => {
    sidecarStub.query.resolves({ localConnections: null });

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns empty array if no local connections are found (null within array)", async () => {
    sidecarStub.query.resolves({ localConnections: [null] });

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns empty array if local connection described w/o a kafka cluster", async () => {
    sidecarStub.query.resolves({ localConnections: [{ somethingUnexpected: true }] });

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("returns local resources with a kafka cluster", async () => {
    sidecarStub.query.resolves({
      localConnections: [
        {
          id: "local-connection-id",
          kafkaCluster: {
            id: "kafka-cluster-id",
            name: "Local Kafka Cluster",
            bootstrapServers: "localhost:9092",
            uri: "kafka://localhost:9092",
          },
        },
      ],
    });

    const result = await getLocalResources();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "local-connection-id");
    assert.strictEqual(result[0].kafkaClusters[0].id, "kafka-cluster-id");
    assert.strictEqual(result[0].schemaRegistry, undefined);

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("returns local resources with both a kafka cluster and a schema registry", async () => {
    sidecarStub.query.resolves({
      localConnections: [
        {
          id: "local-connection-id",
          kafkaCluster: {
            id: "kafka-cluster-id",
            name: "Local Kafka Cluster",
            bootstrapServers: "localhost:9092",
            uri: "kafka://localhost:9092",
          },
          schemaRegistry: {
            id: "schema-registry-id",
            uri: "http://localhost:8081",
          },
        },
      ],
    });

    const result = await getLocalResources();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "local-connection-id");
    assert.strictEqual(result[0].kafkaClusters[0].id, "kafka-cluster-id");
    assert.strictEqual(result[0].schemaRegistry!.id, "schema-registry-id");

    sinon.assert.notCalled(showErrorNotificationStub);
  });
});

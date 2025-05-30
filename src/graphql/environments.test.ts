import * as assert from "assert";
import * as sinon from "sinon";

import { getSidecarStub } from "../../tests/stubs/sidecar";

import { SidecarHandle } from "../sidecar";

import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { getEnvironments } from "./environments";

describe("environments.ts getEnvironments()", () => {
  let sandbox: sinon.SinonSandbox;
  let sidecar: sinon.SinonStubbedInstance<SidecarHandle>;
  let showErrorNotificationStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sidecar = getSidecarStub(sandbox);
    showErrorNotificationStub = getShowErrorNotificationWithButtonsStub(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Returns empty array and shows notification if query raises an error", async () => {
    sidecar.query.rejects(new Error("Query failed"));

    const result = await getEnvironments();

    assert.deepStrictEqual(result, []);
    sinon.assert.calledOnce(showErrorNotificationStub);
  });

  it("Returns empty array if no environments are returned", async () => {
    sidecar.query.resolves({ ccloudConnectionById: { environments: null } });
    const result = await getEnvironments();
    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns empty array if no environments are found", async () => {
    sidecar.query.resolves({ ccloudConnectionById: { environments: [] } });

    const result = await getEnvironments();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Handles degenerate environments from graphql", async () => {
    sidecar.query.resolves({ ccloudConnectionById: { environments: [null, null] } });

    const result = await getEnvironments();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns environments with sorted Kafka clusters", async () => {
    const mockEnvironments = {
      ccloudConnectionById: {
        environments: [
          {
            id: "env1",
            name: "Environment 1",
            governancePackage: "package1",
            kafkaClusters: [
              // Note: The order of these clusters is reversed to test sorting
              {
                id: "kafka2",
                name: "Kafka Cluster 2",
                provider: "aws",
                region: "us-west-2",
                bootstrapServers: "kafka2.example.com",
                uri: "kafka2-uri",
              },
              {
                id: "kafka1",
                name: "Kafka Cluster 1",
                provider: "aws",
                region: "us-east-1",
                bootstrapServers: "kafka1.example.com",
                uri: "kafka1-uri",
              },
            ],
          },
        ],
      },
    };

    sidecar.query.resolves(mockEnvironments);

    const result = await getEnvironments();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "env1");
    assert.strictEqual(result[0].name, "Environment 1");
    assert.strictEqual(result[0].kafkaClusters.length, 2);
    assert.strictEqual(result[0].kafkaClusters[0].name, "Kafka Cluster 1");
    assert.strictEqual(result[0].kafkaClusters[0].environmentId, "env1");
    assert.strictEqual(result[0].kafkaClusters[1].name, "Kafka Cluster 2");
    assert.strictEqual(result[0].kafkaClusters[0].environmentId, "env1");

    assert.strictEqual(result[0].schemaRegistry, undefined);

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns environments with schema registries", async () => {
    const mockEnvironments = {
      ccloudConnectionById: {
        environments: [
          {
            id: "env1",
            name: "Environment 1",
            governancePackage: "package1",
            kafkaClusters: [
              {
                id: "kafka1",
                name: "Kafka Cluster 1",
                provider: "aws",
                region: "us-east-1",
                bootstrapServers: "kafka1.example.com",
                uri: "kafka1-uri",
              },
            ],
            schemaRegistry: {
              id: "schema1",
              provider: "aws",
              region: "us-east-1",
              uri: "schema1-uri",
            },
          },
        ],
      },
    };

    sidecar.query.resolves(mockEnvironments);
    const result = await getEnvironments();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].kafkaClusters.length, 1);
    assert.strictEqual(result[0].schemaRegistry!.environmentId, "env1");

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns environments with Flink compute pools", async () => {
    const mockEnvironments = {
      ccloudConnectionById: {
        environments: [
          {
            id: "env1",
            name: "Environment 1",
            governancePackage: "package1",
            kafkaClusters: null,
            schemaRegistry: null,
            flinkComputePools: [
              {
                id: "flink1",
                display_name: "Flink Pool 1",
                provider: "aws",
                region: "us-east-1",
                max_cfu: 1000,
              },
            ],
          },
        ],
      },
    };

    sidecar.query.resolves(mockEnvironments);
    const result = await getEnvironments();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].flinkComputePools.length, 1);
    assert.strictEqual(result[0].flinkComputePools[0].id, "flink1");
    assert.strictEqual(result[0].flinkComputePools[0].environmentId, "env1");

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns environments sorted by name", async () => {
    const mockEnvironments = {
      ccloudConnectionById: {
        environments: [
          // Note: The order of these environments is reversed to test sorting
          {
            id: "env2",
            name: "Environment 2",
            governancePackage: "package",
            kafkaClusters: [],
            schemaRegistry: null,
          },
          {
            id: "env1",
            name: "Environment 1",
            governancePackage: "package",
            kafkaClusters: [],
            schemaRegistry: null,
          },
        ],
      },
    };

    sidecar.query.resolves(mockEnvironments);
    const result = await getEnvironments();
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, "Environment 1");
    assert.strictEqual(result[1].name, "Environment 2");
    sinon.assert.notCalled(showErrorNotificationStub);
  });
});

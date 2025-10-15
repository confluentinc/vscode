import * as assert from "assert";
import * as sinon from "sinon";

import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { getSidecarStub } from "../../tests/stubs/sidecar";

import type { SidecarHandle } from "../sidecar";
import { getCCloudResources } from "./ccloud";

describe("ccloud.ts getCCloudResources()", () => {
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

  it("Returns empty array and shows notification if query raises an error", async () => {
    sidecarStub.query.rejects(new Error("Query failed"));

    const result = await getCCloudResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.calledOnce(showErrorNotificationStub);
  });

  it("Returns empty array if no environments are returned", async () => {
    sidecarStub.query.resolves({ ccloudConnectionById: { environments: null } });

    const result = await getCCloudResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns empty array if no environments are found", async () => {
    sidecarStub.query.resolves({ ccloudConnectionById: { environments: [] } });

    const result = await getCCloudResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Handles degenerate environments from graphql", async () => {
    sidecarStub.query.resolves({ ccloudConnectionById: { environments: [null, null] } });

    const result = await getCCloudResources();

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
    sidecarStub.query.resolves(mockEnvironments);

    const result = await getCCloudResources();

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
    sidecarStub.query.resolves(mockEnvironments);

    const result = await getCCloudResources();

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
    sidecarStub.query.resolves(mockEnvironments);

    const result = await getCCloudResources();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].flinkComputePools.length, 1);
    assert.strictEqual(result[0].flinkComputePools[0].id, "flink1");
    assert.strictEqual(result[0].flinkComputePools[0].environmentId, "env1");

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Correlates Flink compute pools with Kafka clusters by matching provider/region, ACROSS environments", async () => {
    // Two environments, each with one Kafka cluster and one Flink pool
    // The Flink pool in env1 matches the Kafka cluster in env2 by provider/region
    // The Flink pool in env2 matches the Kafka cluster in env1 by provider/region
    // This tests that Flink pools are associated across environments, not just within the same environment
    // (This is a somewhat contrived example, but it tests the logic thoroughly)

    const kafkaOneProviderRegion = { provider: "gcp", region: "us-central1" };
    const kafkaTwoProviderRegion = { provider: "aws", region: "us-west-2" };

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
                ...kafkaOneProviderRegion,
                bootstrapServers: "kafka1.example.com",
                uri: "kafka1-uri",
              },
            ],
            flinkComputePools: [
              {
                id: "flink1",
                display_name: "Flink Pool 1",
                // Yes, this pool matches the *other* environment's Kafka cluster.
                ...kafkaTwoProviderRegion,
                max_cfu: 10,
              },
            ],
            schemaRegistry: null,
          },
          {
            id: "env2",
            name: "Environment 2",
            governancePackage: "package2",
            kafkaClusters: [
              {
                id: "kafka2",
                name: "Kafka Cluster 2",
                ...kafkaTwoProviderRegion,
                bootstrapServers: "kafka2.example.com",
                uri: "kafka2-uri",
              },
            ],
            flinkComputePools: [
              {
                id: "flink2",
                display_name: "Flink Pool 2",
                ...kafkaOneProviderRegion,
                max_cfu: 15,
              },
            ],
            schemaRegistry: null,
          },
        ],
      },
    };
    sidecarStub.query.resolves(mockEnvironments);

    const result = await getCCloudResources();

    assert.strictEqual(result.length, 2);

    const env1 = result.find((e) => e.id === "env1")!;
    const env2 = result.find((e) => e.id === "env2")!;
    assert.ok(env1, "Environment 1 should exist");
    assert.ok(env2, "Environment 2 should exist");

    // Each environment has one Kafka cluster and one Flink pool
    assert.strictEqual(env1.kafkaClusters.length, 1);
    assert.strictEqual(env1.flinkComputePools.length, 1);
    // the flink pool in env1 should be flink1
    assert.strictEqual(env1.flinkComputePools[0].id, "flink1");
    assert.strictEqual(env1.flinkComputePools[0].name, "Flink Pool 1");
    assert.strictEqual(env1.flinkComputePools[0].environmentId, "env1");

    assert.strictEqual(env2.kafkaClusters.length, 1);
    assert.strictEqual(env2.flinkComputePools.length, 1);
    // the flink pool in env2 should be flink2
    assert.strictEqual(env2.flinkComputePools[0].id, "flink2");
    assert.strictEqual(env2.flinkComputePools[0].name, "Flink Pool 2");
    assert.strictEqual(env2.flinkComputePools[0].environmentId, "env2");

    const kafka1 = env1.kafkaClusters[0];
    const kafka2 = env2.kafkaClusters[0];

    // Check that the Kafka clusters have the correct Flink pools associated
    // Kafka cluster 1 (gcp/us-central1) should have Flink pool 2 associated (from env2)
    assert.ok(kafka1.isFlinkable());
    assert.strictEqual(kafka1.flinkPools?.length, 1);
    assert.strictEqual(kafka1.flinkPools?.[0].id, "flink2");
    assert.strictEqual(kafka1.flinkPools?.[0].name, "Flink Pool 2");
    assert.strictEqual(kafka1.flinkPools?.[0].environmentId, "env2");

    // Kafka cluster 2 (aws/us-west-2) should have Flink pool 1 associated (from env1)
    assert.ok(kafka2.isFlinkable());
    assert.strictEqual(kafka2.flinkPools?.length, 1);
    assert.strictEqual(kafka2.flinkPools?.[0].id, "flink1");
    assert.strictEqual(kafka2.flinkPools?.[0].name, "Flink Pool 1");
    assert.strictEqual(kafka2.flinkPools?.[0].environmentId, "env1");

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
    sidecarStub.query.resolves(mockEnvironments);

    const result = await getCCloudResources();

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, "Environment 1");
    assert.strictEqual(result[1].name, "Environment 2");

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Associates Flink compute pools with Kafka clusters by matching provider/region", async () => {
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
                region: "us-west-2",
                bootstrapServers: "kafka1.example.com",
                uri: "kafka1-uri",
              },
              {
                id: "kafka2",
                name: "Kafka Cluster 2",
                provider: "gcp",
                region: "us-central1",
                bootstrapServers: "kafka2.example.com",
                uri: "kafka2-uri",
              },
            ],
            flinkComputePools: [
              {
                id: "flink1",
                display_name: "Flink Pool 1",
                provider: "aws",
                region: "us-west-2",
                max_cfu: 10,
              },
              {
                id: "flink2",
                display_name: "Flink Pool 2",
                provider: "aws",
                region: "us-east-1",
                max_cfu: 5,
              },
              {
                id: "flink3",
                display_name: "Flink Pool 3",
                provider: "gcp",
                region: "us-central1",
                max_cfu: 15,
              },
            ],
            schemaRegistry: null,
          },
        ],
      },
    };
    sidecarStub.query.resolves(mockEnvironments);

    const result = await getCCloudResources();

    assert.strictEqual(result.length, 1);
    const environment = result[0];

    // Check Kafka clusters have correct flinkPools associations
    const kafka1 = environment.kafkaClusters.find((k) => k.id === "kafka1");
    const kafka2 = environment.kafkaClusters.find((k) => k.id === "kafka2");

    assert.ok(kafka1, "Kafka cluster 1 should exist");
    assert.ok(kafka2, "Kafka cluster 2 should exist");

    // Kafka cluster 1 (aws/us-west-2) should have 1 matching Flink pool
    assert.strictEqual(kafka1.flinkPools?.length, 1);
    assert.strictEqual(kafka1.flinkPools?.[0].id, "flink1");
    assert.strictEqual(kafka1.flinkPools?.[0].name, "Flink Pool 1");

    // Kafka cluster 2 (gcp/us-central1) should have 1 matching Flink pool
    assert.strictEqual(kafka2.flinkPools?.length, 1);
    assert.strictEqual(kafka2.flinkPools?.[0].id, "flink3");
    assert.strictEqual(kafka2.flinkPools?.[0].name, "Flink Pool 3");

    sinon.assert.notCalled(showErrorNotificationStub);
  });
});

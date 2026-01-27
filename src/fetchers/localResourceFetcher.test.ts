import * as assert from "assert";
import * as sinon from "sinon";
import { createLocalResourceFetcher } from "./localResourceFetcher";
import * as dockerConfigs from "../docker/configs";
import * as dockerContainers from "../docker/containers";
import { ContainerStateStatusEnum, type ContainerSummary } from "../clients/docker";
import { LOCAL_CONNECTION_ID } from "../constants";
import { LocalEnvironment } from "../models/environment";

describe("fetchers/localResourceFetcher", function () {
  let isDockerAvailableStub: sinon.SinonStub;
  let getContainersForImageStub: sinon.SinonStub;

  function createMockContainer(options: {
    id: string;
    name: string;
    ports?: Array<{ PrivatePort: number; PublicPort?: number }>;
  }): ContainerSummary {
    return {
      Id: options.id,
      Names: [`/${options.name}`],
      State: ContainerStateStatusEnum.Running,
      Ports: options.ports?.map((p) => ({
        PrivatePort: p.PrivatePort,
        PublicPort: p.PublicPort,
        Type: "tcp",
      })),
    };
  }

  beforeEach(function () {
    isDockerAvailableStub = sinon.stub(dockerConfigs, "isDockerAvailable");
    getContainersForImageStub = sinon.stub(dockerContainers, "getContainersForImage");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("createLocalResourceFetcher()", function () {
    it("should create a local resource fetcher", function () {
      const fetcher = createLocalResourceFetcher();
      assert.ok(fetcher);
      assert.ok(typeof fetcher.discoverResources === "function");
      assert.ok(typeof fetcher.discoverKafkaClusters === "function");
      assert.ok(typeof fetcher.discoverSchemaRegistries === "function");
      assert.ok(typeof fetcher.discoverMedusa === "function");
      assert.ok(typeof fetcher.isDockerAvailable === "function");
    });
  });

  describe("isDockerAvailable()", function () {
    it("should return true when Docker is available", async function () {
      isDockerAvailableStub.resolves(true);

      const fetcher = createLocalResourceFetcher();
      const result = await fetcher.isDockerAvailable();

      assert.strictEqual(result, true);
    });

    it("should return false when Docker is not available", async function () {
      isDockerAvailableStub.resolves(false);

      const fetcher = createLocalResourceFetcher();
      const result = await fetcher.isDockerAvailable();

      assert.strictEqual(result, false);
    });
  });

  describe("discoverKafkaClusters()", function () {
    it("should return empty array when Docker is not available", async function () {
      isDockerAvailableStub.resolves(false);

      const fetcher = createLocalResourceFetcher();
      const clusters = await fetcher.discoverKafkaClusters();

      assert.deepStrictEqual(clusters, []);
    });

    it("should return empty array when no Kafka containers found", async function () {
      isDockerAvailableStub.resolves(true);
      getContainersForImageStub.resolves([]);

      const fetcher = createLocalResourceFetcher();
      const clusters = await fetcher.discoverKafkaClusters();

      assert.deepStrictEqual(clusters, []);
    });

    it("should discover Kafka cluster from running container", async function () {
      isDockerAvailableStub.resolves(true);
      getContainersForImageStub.resolves([
        createMockContainer({
          id: "abc123def456",
          name: "confluent-local-kafka",
          ports: [
            { PrivatePort: 9092, PublicPort: 9092 },
            { PrivatePort: 8082, PublicPort: 8082 },
          ],
        }),
      ]);

      const fetcher = createLocalResourceFetcher();
      const clusters = await fetcher.discoverKafkaClusters();

      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].id, "abc123def456");
      assert.strictEqual(clusters[0].name, "confluent-local-kafka");
      assert.strictEqual(clusters[0].bootstrapServers, "localhost:9092");
      assert.strictEqual(clusters[0].uri, "http://localhost:8082");
    });

    it("should skip containers without bootstrap port", async function () {
      isDockerAvailableStub.resolves(true);
      getContainersForImageStub.resolves([
        createMockContainer({
          id: "abc123def456",
          name: "kafka-no-bootstrap",
          ports: [{ PrivatePort: 8082, PublicPort: 8082 }],
        }),
      ]);

      const fetcher = createLocalResourceFetcher();
      const clusters = await fetcher.discoverKafkaClusters();

      assert.strictEqual(clusters.length, 0);
    });
  });

  describe("discoverSchemaRegistries()", function () {
    it("should return empty array when Docker is not available", async function () {
      isDockerAvailableStub.resolves(false);

      const fetcher = createLocalResourceFetcher();
      const registries = await fetcher.discoverSchemaRegistries();

      assert.deepStrictEqual(registries, []);
    });

    it("should return empty array when no Schema Registry containers found", async function () {
      isDockerAvailableStub.resolves(true);
      getContainersForImageStub.resolves([]);

      const fetcher = createLocalResourceFetcher();
      const registries = await fetcher.discoverSchemaRegistries();

      assert.deepStrictEqual(registries, []);
    });

    it("should discover Schema Registry from running container", async function () {
      isDockerAvailableStub.resolves(true);
      getContainersForImageStub.resolves([
        createMockContainer({
          id: "sr123def456",
          name: "schema-registry",
          ports: [{ PrivatePort: 8081, PublicPort: 8081 }],
        }),
      ]);

      const fetcher = createLocalResourceFetcher();
      const registries = await fetcher.discoverSchemaRegistries();

      assert.strictEqual(registries.length, 1);
      assert.strictEqual(registries[0].id, "sr123def456");
      assert.strictEqual(registries[0].uri, "http://localhost:8081");
    });
  });

  describe("discoverResources()", function () {
    it("should return undefined when Docker is not available", async function () {
      isDockerAvailableStub.resolves(false);

      const fetcher = createLocalResourceFetcher();
      const environment = await fetcher.discoverResources();

      assert.strictEqual(environment, undefined);
    });

    it("should return undefined when no resources found", async function () {
      isDockerAvailableStub.resolves(true);
      getContainersForImageStub.resolves([]);

      const fetcher = createLocalResourceFetcher();
      const environment = await fetcher.discoverResources();

      assert.strictEqual(environment, undefined);
    });

    it("should build LocalEnvironment with discovered resources", async function () {
      isDockerAvailableStub.resolves(true);

      // First call for Kafka, second for SR, third for Medusa (empty)
      getContainersForImageStub.onCall(0).resolves([
        createMockContainer({
          id: "kafka123",
          name: "local-kafka",
          ports: [
            { PrivatePort: 9092, PublicPort: 9092 },
            { PrivatePort: 8082, PublicPort: 8082 },
          ],
        }),
      ]);
      getContainersForImageStub.onCall(1).resolves([
        createMockContainer({
          id: "sr123",
          name: "schema-registry",
          ports: [{ PrivatePort: 8081, PublicPort: 8081 }],
        }),
      ]);
      getContainersForImageStub.onCall(2).resolves([]);

      const fetcher = createLocalResourceFetcher();
      const environment = await fetcher.discoverResources();

      assert.ok(environment);
      assert.ok(environment instanceof LocalEnvironment);
      assert.strictEqual(environment.id, LOCAL_CONNECTION_ID);
      assert.strictEqual(environment.kafkaClusters.length, 1);
      assert.strictEqual(environment.kafkaClusters[0].name, "local-kafka");
      assert.ok(environment.schemaRegistry);
      assert.strictEqual(environment.schemaRegistry.uri, "http://localhost:8081");
    });

    it("should return environment with only Kafka cluster", async function () {
      isDockerAvailableStub.resolves(true);

      getContainersForImageStub.onCall(0).resolves([
        createMockContainer({
          id: "kafka123",
          name: "local-kafka",
          ports: [{ PrivatePort: 9092, PublicPort: 9092 }],
        }),
      ]);
      getContainersForImageStub.onCall(1).resolves([]);
      getContainersForImageStub.onCall(2).resolves([]);

      const fetcher = createLocalResourceFetcher();
      const environment = await fetcher.discoverResources();

      assert.ok(environment);
      assert.strictEqual(environment.kafkaClusters.length, 1);
      assert.strictEqual(environment.schemaRegistry, undefined);
    });
  });
});

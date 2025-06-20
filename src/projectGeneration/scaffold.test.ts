import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as projectGen from ".";
import { ResourceLoader } from "../loaders";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { KafkaCluster } from "../models/kafkaCluster";
import { CCloudOrganization } from "../models/organization";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { KafkaTopic } from "../models/topic";
import * as notifications from "../notifications";
import { registerProjectGenerationCommands, resourceScaffoldProjectRequest } from "./scaffold";

describe("projectGeneration/scaffold", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("registerProjectGenerationCommands", () => {
    it("should register both scaffold commands", () => {
      const stub = sandbox.stub(vscode.commands, "registerCommand");
      registerProjectGenerationCommands();
      sinon.assert.calledWith(stub, "confluent.resources.scaffold", sinon.match.func);
      sinon.assert.calledWith(stub, "confluent.scaffold", sinon.match.func);
    });
  });

  describe("resourceScaffoldProjectRequest", () => {
    const postResponse = { status: 200, success: true, message: "ok" };

    it("should scaffold project for KafkaCluster", async () => {
      const cluster = {
        bootstrapServers: "PLAINTEXT://localhost:9092",
        // minimal mock for instanceof check
        __proto__: KafkaCluster.prototype,
      } as unknown as KafkaCluster;
      const scaffoldStub = sandbox
        .stub(projectGen, "scaffoldProjectRequest")
        .resolves(postResponse as any);
      const result = await resourceScaffoldProjectRequest(cluster as any);
      sinon.assert.calledOnce(scaffoldStub);
      assert.strictEqual(result, postResponse);
    });

    it("should scaffold project for KafkaTopic", async () => {
      const topic = {
        name: "test-topic",
        connectionId: "conn" as ConnectionId,
        environmentId: "env" as EnvironmentId,
        clusterId: "cluster" as unknown as string,
        // minimal mock for instanceof check
        __proto__: KafkaTopic.prototype,
      } as unknown as KafkaTopic;
      const cluster = {
        id: "cluster",
        bootstrapServers: "PLAINTEXT://localhost:9092",
        __proto__: KafkaCluster.prototype,
      } as unknown as KafkaCluster;
      sandbox.stub(ResourceLoader, "getInstance").returns({
        getKafkaClustersForEnvironmentId: sandbox.stub().resolves([cluster]),
      } as unknown as ResourceLoader);
      const scaffoldStub = sandbox
        .stub(projectGen, "scaffoldProjectRequest")
        .resolves(postResponse as any);
      const result = await resourceScaffoldProjectRequest(topic as any);
      sinon.assert.calledOnce(scaffoldStub);
      assert.strictEqual(result, postResponse);
    });

    it("should show error if KafkaTopic cluster not found", async () => {
      const topic = {
        name: "test-topic",
        connectionId: "conn" as ConnectionId,
        environmentId: "env" as EnvironmentId,
        clusterId: "cluster" as unknown as string,
        __proto__: KafkaTopic.prototype,
      } as unknown as KafkaTopic;
      sandbox.stub(ResourceLoader, "getInstance").returns({
        getKafkaClustersForEnvironmentId: sandbox.stub().resolves([]),
      } as unknown as ResourceLoader);
      const errorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
      await resourceScaffoldProjectRequest(topic as any);
      sinon.assert.calledOnce(errorStub);
    });

    it("should scaffold project for CCloudFlinkComputePool", async () => {
      const pool = {
        environmentId: "env" as EnvironmentId,
        region: "us-west",
        provider: "aws",
        id: "pool",
        __proto__: CCloudFlinkComputePool.prototype,
      } as unknown as CCloudFlinkComputePool;
      const org = {
        id: "org" as any,
        __proto__: CCloudOrganization.prototype,
      } as unknown as CCloudOrganization;
      sandbox.stub(CCloudResourceLoader, "getInstance").returns({
        getOrganization: sandbox.stub().resolves(org),
      } as unknown as CCloudResourceLoader);
      const scaffoldStub = sandbox
        .stub(projectGen, "scaffoldProjectRequest")
        .resolves(postResponse as any);
      const result = await resourceScaffoldProjectRequest(pool as any);
      sinon.assert.calledOnce(scaffoldStub);
      assert.strictEqual(result, postResponse);
    });

    it("should show error for unsupported resource type", async () => {
      const errorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
      await resourceScaffoldProjectRequest({} as any);
      sinon.assert.calledOnce(errorStub);
    });
  });
});

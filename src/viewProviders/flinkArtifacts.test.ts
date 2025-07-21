import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { CCloudResourceLoader } from "../loaders";
import { FlinkArtifact } from "../models/flinkArtifact";
import { FlinkArtifactsViewProvider } from "./flinkArtifacts";

describe("FlinkArtifactsViewProvider", () => {
  let sandbox: sinon.SinonSandbox;
  let viewProvider: FlinkArtifactsViewProvider;

  before(async () => {
    // required for all subclasses of BaseViewProvider since they deal with extension storage
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    viewProvider = FlinkArtifactsViewProvider.getInstance();
  });

  afterEach(() => {
    sandbox.restore();
    // reset singleton instances between tests
    FlinkArtifactsViewProvider["instanceMap"].clear();
  });

  describe("refresh()", () => {
    let changeFireStub: sinon.SinonStub;

    beforeEach(() => {
      changeFireStub = sandbox.stub(viewProvider["_onDidChangeTreeData"], "fire");
    });

    it("clears when no resource is selected", async () => {
      // Should clear the artifacts array and fire the change event.
      await viewProvider.refresh();

      sinon.assert.calledOnce(changeFireStub);
      assert.deepStrictEqual(viewProvider["_artifacts"], []);
    });

    it("fetches new artifacts when a resource is selected", async () => {
      const windowWithProgressStub = sandbox
        .stub(window, "withProgress")
        .callsFake((_, callback) => {
          // Call the callback immediately with a resolved promise
          return Promise.resolve(callback({} as any, {} as any));
        });

      const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      viewProvider["resource"] = resource;

      const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
        getStubbedCCloudResourceLoader(sandbox);

      const mockArtifacts = [
        new FlinkArtifact({
          connectionId: resource.connectionId,
          connectionType: resource.connectionType,
          environmentId: resource.environmentId,
          id: "artifact1",
          name: "Test Artifact 1",
          description: "Test artifact description",
          provider: "aws",
          region: "us-east-1",
        }),
        new FlinkArtifact({
          connectionId: resource.connectionId,
          connectionType: resource.connectionType,
          environmentId: resource.environmentId,
          id: "artifact2",
          name: "Test Artifact 2",
          description: "Another test artifact",
          provider: "aws",
          region: "us-east-1",
        }),
      ];

      stubbedLoader.getFlinkArtifacts.resolves(mockArtifacts);

      await viewProvider.refresh();

      sinon.assert.calledOnce(windowWithProgressStub);
      sinon.assert.calledTwice(changeFireStub);
      sinon.assert.calledOnce(stubbedLoader.getFlinkArtifacts);
      sinon.assert.calledWith(stubbedLoader.getFlinkArtifacts, resource);
      assert.deepStrictEqual(viewProvider["_artifacts"], mockArtifacts);
    });
  });

  it("returns artifacts when compute pool is selected", () => {
    const mockArtifacts = [
      new FlinkArtifact({
        connectionId: TEST_CCLOUD_FLINK_COMPUTE_POOL.connectionId,
        connectionType: "ccloud" as any,
        environmentId: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
        id: "artifact1",
        name: "Test Artifact 1",
        description: "Test artifact description",
        provider: "aws",
        region: "us-east-1",
      }),
    ];

    viewProvider["resource"] = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    viewProvider["_artifacts"] = mockArtifacts;

    const children = viewProvider.getChildren();
    assert.deepStrictEqual(children, mockArtifacts);
  });
});

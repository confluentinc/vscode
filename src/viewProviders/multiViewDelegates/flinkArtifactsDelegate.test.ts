import * as assert from "assert";
import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { createFlinkArtifact } from "../../../tests/unit/testResources/flinkArtifact";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../../tests/unit/testResources/flinkComputePool";
import { ResponseError } from "../../clients/flinkArtifacts";
import * as errors from "../../errors";
import { CCloudResourceLoader } from "../../loaders";
import * as notifications from "../../notifications";
import { FlinkArtifactsDelegate } from "./flinkArtifactsDelegate";

describe("multiViewDelegates/flinkArtifactsDelegate.ts (delegate only)", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("FlinkArtifactsDelegate", () => {
    // Minimal fake parent providing only what's used by the delegate
    const fakeParent = {
      computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      logger: { debug: () => undefined },
    } as unknown as {
      computePool: typeof TEST_CCLOUD_FLINK_COMPUTE_POOL;
      logger: { debug: (m: string, e: unknown) => void };
    };

    let artifactsDelegate: FlinkArtifactsDelegate;

    beforeEach(() => {
      artifactsDelegate = new FlinkArtifactsDelegate();
    });

    describe("fetchChildren()", () => {
      let logErrorStub: sinon.SinonStub;
      let showErrorNotificationStub: sinon.SinonStub;

      beforeEach(() => {
        logErrorStub = sandbox.stub(errors, "logError");
        showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
      });

      it("fetches artifacts from the loader and returns them", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);

        const mockArtifacts = [
          createFlinkArtifact({ id: "artifact1", name: "Test Artifact 1" }),
          createFlinkArtifact({ id: "artifact2", name: "Test Artifact 2" }),
        ];

        stubbedLoader.getFlinkArtifacts.resolves(mockArtifacts);

        const children = await artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL);

        assert.deepStrictEqual(children, mockArtifacts);
        assert.deepStrictEqual(artifactsDelegate["children"], mockArtifacts);
        sinon.assert.calledOnce(stubbedLoader.getFlinkArtifacts);
        sinon.assert.calledWith(stubbedLoader.getFlinkArtifacts, fakeParent.computePool);
      });

      it("clears children and rethrows when loader fails (431 -> default message)", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("some other 4xx err", { status: 431 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );

        assert.deepStrictEqual(artifactsDelegate["children"], []);
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnce(showErrorNotificationStub);
      });

      it("handles 503 with service unavailable message", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("Service unavailable", { status: 503 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnce(showErrorNotificationStub);
      });

      it("handles non-HTTP errors with generic message", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new Error("Failed to load Flink artifacts");
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnce(showErrorNotificationStub);
      });

      it("does not show notification for non-error HTTP status (300)", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("oh no", { status: 300 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.notCalled(showErrorNotificationStub);
      });

      it("clears children at start of fetch when error occurs", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("test error", { status: undefined }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        artifactsDelegate["children"] = [
          createFlinkArtifact({ id: "artifact1", name: "Initial Artifact" }),
        ];

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        assert.deepStrictEqual(artifactsDelegate["children"], []);
      });

      it("does not show notification for 400 but still logs", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("Bad request", { status: 400 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.notCalled(showErrorNotificationStub);
      });

      it("handles 401 with auth message", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("Unauthorized", { status: 401 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnce(showErrorNotificationStub);
      });

      it("handles 404 with not found message", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("Not found", { status: 404 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnce(showErrorNotificationStub);
      });

      it("handles 429 with rate limit message", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("Too many requests", { status: 429 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnce(showErrorNotificationStub);
      });

      it("handles unknown HTTP error with default message", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);
        const mockError = new ResponseError(new Response("I'm a teapot", { status: 418 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          mockError,
        );
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnce(showErrorNotificationStub);
      });

      it("handles null data parsing error without showing notification", async () => {
        const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
          getStubbedCCloudResourceLoader(sandbox);

        const nullDataParsingError = new TypeError(
          "Cannot read properties of null (reading 'map')",
        );

        stubbedLoader.getFlinkArtifacts.rejects(nullDataParsingError);

        await assert.rejects(
          () => artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL),
          nullDataParsingError,
        );

        assert.deepStrictEqual(artifactsDelegate.children, []);
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWithExactly(
          logErrorStub,
          nullDataParsingError,
          "Failed to load Flink artifacts - empty response",
        );
        sinon.assert.notCalled(showErrorNotificationStub);
      });
    });
  });
});

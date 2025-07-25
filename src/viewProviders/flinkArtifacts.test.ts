import * as assert from "assert";
import * as sinon from "sinon";
import { CancellationToken, Progress, window } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { createFlinkArtifact } from "../../tests/unit/testResources/flinkArtifact";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ResponseError } from "../clients/flinkArtifacts";
import * as errors from "../errors";
import { CCloudResourceLoader } from "../loaders";
import * as notifications from "../notifications";
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
    viewProvider.dispose();
    // reset singleton instances between tests
    FlinkArtifactsViewProvider["instanceMap"].clear();
    sandbox.restore();
  });

  describe("refresh()", () => {
    let changeFireStub: sinon.SinonStub;
    let logErrorStub: sinon.SinonStub;
    let showErrorNotificationStub: sinon.SinonStub;
    let windowWithProgressStub: sinon.SinonStub;

    beforeEach(() => {
      changeFireStub = sandbox.stub(viewProvider["_onDidChangeTreeData"], "fire");
      logErrorStub = sandbox.stub(errors, "logError");
      showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
      windowWithProgressStub = sandbox.stub(window, "withProgress").callsFake((_, callback) => {
        const mockProgress = {} as Progress<unknown>;
        const mockToken = {} as CancellationToken;
        return Promise.resolve(callback(mockProgress, mockToken));
      });
    });

    it("clears when no resource is selected", async () => {
      // Should clear the artifacts array and fire the change event.
      await viewProvider.refresh();

      sinon.assert.calledOnce(changeFireStub);
      assert.deepStrictEqual(viewProvider["_artifacts"], []);
    });

    it("fetches new artifacts when a resource is selected", async () => {
      const resource = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      viewProvider["resource"] = resource;

      const stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader> =
        getStubbedCCloudResourceLoader(sandbox);

      const mockArtifacts = [
        createFlinkArtifact({
          id: "artifact1",
          name: "Test Artifact 1",
        }),
        createFlinkArtifact({
          id: "artifact2",
          name: "Test Artifact 2",
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

    it("returns artifacts when compute pool is selected", () => {
      const mockArtifacts = [
        createFlinkArtifact({
          id: "artifact1",
          name: "Test Artifact 1",
        }),
      ];

      viewProvider["resource"] = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      viewProvider["_artifacts"] = mockArtifacts;

      const children = viewProvider.getChildren();
      assert.deepStrictEqual(children, mockArtifacts);
    });

    describe("error handling", () => {
      let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

      beforeEach(() => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_COMPUTE_POOL;
        stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      });

      it("should handle 4xx HTTP errors with appropriate message", async () => {
        // Use a 431 status, which is not explicitly handled in the switch statement,
        // so it should use the default message: "Failed to load Flink artifacts due to an unexpected error."
        const mockError = new ResponseError(new Response("some other 4xx err", { status: 431 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Failed to load Flink artifacts due to an unexpected error.",
        );
      });
      it("should handle 5xx HTTP errors with appropriate message", async () => {
        const mockError = new ResponseError(new Response("Service unavailable", { status: 503 }));

        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Failed to load Flink artifacts. The service is temporarily unavailable. Please try again later.",
        );
      });

      it("should handle non-HTTP errors with generic message", async () => {
        const mockError = new Error("Failed to load Flink artifacts");
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Failed to load Flink artifacts. Please check your connection and try again.",
        );
      });

      it("should not show error notification for HTTP status outside 400-599 range", async () => {
        const mockError = new ResponseError(new Response("oh no", { status: 300 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        // Should not show error notification for non-error HTTP status
        sinon.assert.notCalled(showErrorNotificationStub);
      });

      it("should clear artifacts and fire change events on error", async () => {
        const mockError = new ResponseError(new Response("test error", { status: undefined }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        viewProvider["_artifacts"] = [
          createFlinkArtifact({
            id: "artifact1",
            name: "Initial Artifact",
          }),
        ];

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        // Artifacts should be cleared at the start of refresh
        assert.deepStrictEqual(viewProvider["_artifacts"], []);

        // Should fire change event once at start to clear (error prevents final fire call)
        sinon.assert.calledOnce(changeFireStub);
      });

      it("should handle 401 HTTP error with authentication message", async () => {
        const mockError = new ResponseError(new Response("Unauthorized", { status: 401 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Authentication required to load Flink artifacts.",
        );
      });

      it("should handle 404 HTTP error with not found message", async () => {
        const mockError = new ResponseError(new Response("Not found", { status: 404 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Flink artifacts not found for this compute pool.",
        );
      });

      it("should handle 429 HTTP error with rate limit message", async () => {
        const mockError = new ResponseError(new Response("Too many requests", { status: 429 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Too many requests. Please try again later.",
        );
      });

      it("should handle 400 HTTP error with check request message", async () => {
        const mockError = new ResponseError(new Response("Bad request", { status: 400 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Failed to load Flink artifacts. Please check your request and try again.",
        );
      });

      it("should handle unknown HTTP error with default message", async () => {
        const mockError = new ResponseError(new Response("I'm a teapot", { status: 418 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(async () => {
          await viewProvider.refresh();
        }, mockError);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(logErrorStub, mockError, "Failed to load Flink artifacts");

        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          "Failed to load Flink artifacts due to an unexpected error.",
        );
      });
    });
  });
});

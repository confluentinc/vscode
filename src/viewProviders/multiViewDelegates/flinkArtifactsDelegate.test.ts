import * as assert from "assert";
import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import { createFlinkArtifact } from "../../../tests/unit/testResources/flinkArtifact";
import { ResponseError } from "../../clients/flinkArtifacts";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkArtifactsDelegate, getFlinkArtifactsErrorMessage } from "./flinkArtifactsDelegate";

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
      kafkaCluster: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      logger: { debug: () => undefined },
    } as unknown as {
      kafkaCluster: typeof TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
      logger: { debug: (m: string, e: unknown) => void };
    };

    let artifactsDelegate: FlinkArtifactsDelegate;
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    beforeEach(() => {
      artifactsDelegate = new FlinkArtifactsDelegate();
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    describe("fetchChildren()", () => {
      it("fetches artifacts from the loader and returns them", async () => {
        const mockArtifacts = [
          createFlinkArtifact({ id: "artifact1", name: "Test Artifact 1" }),
          createFlinkArtifact({ id: "artifact2", name: "Test Artifact 2" }),
        ];

        stubbedLoader.getFlinkArtifacts.resolves(mockArtifacts);

        const children = await artifactsDelegate.fetchChildren(
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          false,
        );

        assert.deepStrictEqual(children, mockArtifacts);
        assert.deepStrictEqual(artifactsDelegate["children"], mockArtifacts);
        sinon.assert.calledOnce(stubbedLoader.getFlinkArtifacts);
        sinon.assert.calledWith(stubbedLoader.getFlinkArtifacts, fakeParent.kafkaCluster);
      });
      it("passes forceDeepRefresh to the loader", async () => {
        const mockArtifacts = [
          createFlinkArtifact({ id: "artifact1", name: "Test Artifact 1" }),
          createFlinkArtifact({ id: "artifact2", name: "Test Artifact 2" }),
        ];

        stubbedLoader.getFlinkArtifacts.resolves(mockArtifacts);

        await artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);

        sinon.assert.calledOnce(stubbedLoader.getFlinkArtifacts);
        sinon.assert.calledWith(stubbedLoader.getFlinkArtifacts, fakeParent.kafkaCluster, true);
      });
      it("clears children and rethrows when loader fails (431 -> default message)", async () => {
        const mockError = new ResponseError(new Response("some other 4xx err", { status: 431 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );

        assert.deepStrictEqual(artifactsDelegate["children"], []);
      });
      it("clears children at start of fetch when error occurs", async () => {
        const mockError = new ResponseError(new Response("test error", { status: undefined }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        artifactsDelegate["children"] = [
          createFlinkArtifact({ id: "artifact1", name: "Initial Artifact" }),
        ];

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.deepStrictEqual(artifactsDelegate["children"], []);
      });
    });

    describe("getFlinkArtifactsErrorMessage()", () => {
      it("handles 503 with service unavailable message", async () => {
        const mockError = new ResponseError(new Response("Service unavailable", { status: 503 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        const message = await getFlinkArtifactsErrorMessage(mockError);
        assert.strictEqual(
          message,
          "Failed to load Flink artifacts. The service is temporarily unavailable. Please try again later.",
        );
      });

      it("handles non-HTTP errors with generic message", async () => {
        const mockError = new Error("Failed to load Flink artifacts");
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.strictEqual(
          await getFlinkArtifactsErrorMessage(mockError),
          "Failed to load Flink artifacts.",
        );
      });

      it("does not show notification for non-error HTTP status (300)", async () => {
        const mockError = new ResponseError(new Response("oh no", { status: 300 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.strictEqual(
          await getFlinkArtifactsErrorMessage(mockError),
          "Failed to load Flink artifacts.",
        );
      });

      it("extracts the error details for 400 status", async () => {
        const mockResponseBody = JSON.stringify({
          errors: [{ detail: "artifacts not supported in region ABC", code: "400" }],
        });
        const mockError = new ResponseError(new Response(mockResponseBody, { status: 400 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.strictEqual(
          await getFlinkArtifactsErrorMessage(mockError),
          "Bad request when loading Flink artifacts: artifacts not supported in region ABC",
        );
      });

      it("handles 401 with auth message", async () => {
        const mockError = new ResponseError(new Response("Unauthorized", { status: 401 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.strictEqual(
          await getFlinkArtifactsErrorMessage(mockError),
          "Authentication required to load Flink artifacts.",
        );
      });

      it("handles 404 with not found message", async () => {
        const mockError = new ResponseError(new Response("Not found", { status: 404 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.strictEqual(
          await getFlinkArtifactsErrorMessage(mockError),
          "Flink artifacts not found for this compute pool.",
        );
      });

      it("handles 429 with rate limit message", async () => {
        const mockError = new ResponseError(new Response("Too many requests", { status: 429 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.strictEqual(
          await getFlinkArtifactsErrorMessage(mockError),
          "Too many requests. Please try again later.",
        );
      });

      it("handles unknown HTTP error with default message", async () => {
        const mockError = new ResponseError(new Response("I'm a teapot", { status: 418 }));
        stubbedLoader.getFlinkArtifacts.rejects(mockError);

        await assert.rejects(
          artifactsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false),
          mockError,
        );
        assert.strictEqual(
          await getFlinkArtifactsErrorMessage(mockError),
          "Failed to load Flink artifacts due to an unexpected error.",
        );
      });
    });
  });
});

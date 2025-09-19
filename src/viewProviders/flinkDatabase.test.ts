import * as assert from "assert";
import * as sinon from "sinon";
import { CancellationToken, Progress, window } from "vscode";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import * as errors from "../errors";
import { CCloudFlinkDbKafkaCluster, CCloudKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import * as notifications from "../notifications";
import { FlinkDatabaseViewProvider } from "./flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "./multiViewDelegates/constants";

describe("viewProviders/flinkDatabase.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("FlinkDatabaseViewProvider", () => {
    let viewProvider: FlinkDatabaseViewProvider;

    beforeEach(() => {
      viewProvider = FlinkDatabaseViewProvider.getInstance();
    });

    afterEach(() => {
      viewProvider.dispose();
      // reset singleton instances between tests
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    describe("refresh()", () => {
      let changeFireStub: sinon.SinonStub;
      let logErrorStub: sinon.SinonStub;
      let showErrorNotificationStub: sinon.SinonStub;
      let windowWithProgressStub: sinon.SinonStub;
      let delegateFetchStub: sinon.SinonStub;

      beforeEach(() => {
        changeFireStub = sandbox.stub(viewProvider["_onDidChangeTreeData"], "fire");
        logErrorStub = sandbox.stub(errors, "logError");
        showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
        windowWithProgressStub = sandbox.stub(window, "withProgress").callsFake((_, callback) => {
          const mockProgress = {} as Progress<unknown>;
          const mockToken = {} as CancellationToken;
          return Promise.resolve(callback(mockProgress, mockToken));
        });

        // stub delegate behavior so provider tests don't exercise delegate logic
        delegateFetchStub = sandbox.stub(viewProvider["currentDelegate"], "fetchChildren");
        // also add a fake loading message
        sandbox
          .stub(viewProvider["currentDelegate"], "loadingMessage")
          .value("Loading from delegate...");
      });

      it("should clear when no compute pool is selected", async () => {
        await viewProvider.refresh();

        sinon.assert.calledOnce(changeFireStub);
        sinon.assert.notCalled(windowWithProgressStub);
        sinon.assert.notCalled(delegateFetchStub);
        assert.deepStrictEqual(viewProvider["children"], []);
      });

      it("should call the current delegate to fetch children when a compute pool is selected", async () => {
        const resource = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
        viewProvider["resource"] = resource;

        const fakeChildren = [{ id: "x" }];
        delegateFetchStub.resolves(fakeChildren);

        await viewProvider.refresh();

        sinon.assert.calledOnce(windowWithProgressStub);
        sinon.assert.calledWithMatch(windowWithProgressStub, sinon.match.any, sinon.match.func);
        sinon.assert.calledTwice(changeFireStub);
        sinon.assert.calledOnce(delegateFetchStub);
        assert.deepStrictEqual(viewProvider["children"], fakeChildren);
      });

      for (const forceDeepRefresh of [true, false]) {
        it(`should pass forceDeepRefresh:${forceDeepRefresh} to delegate::fetchChildren()`, async () => {
          const resource = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
          viewProvider["resource"] = resource;

          await viewProvider.refresh(forceDeepRefresh);
          sinon.assert.calledWith(delegateFetchStub, resource, forceDeepRefresh);
        });
      }

      it("should show an error notification when the delegate's fetchChildren() fails", async () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
        const fakeError = new Error("uh oh");
        delegateFetchStub.rejects(fakeError);

        await viewProvider.refresh().catch(() => undefined);

        sinon.assert.calledOnce(windowWithProgressStub);
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledWith(
          logErrorStub,
          fakeError,
          `Failed to load Flink ${viewProvider["currentDelegate"].mode}`,
        );
        sinon.assert.calledOnce(showErrorNotificationStub);
        sinon.assert.calledWith(
          showErrorNotificationStub,
          `Failed to load Flink ${viewProvider["currentDelegate"].mode}`,
        );
      });

      it("should use the current delegate's loading message in progress indicator", async () => {
        viewProvider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
        delegateFetchStub.resolves([]);

        await viewProvider.refresh();

        const firstArg = windowWithProgressStub.firstCall.args[0];
        assert.strictEqual(firstArg.title ?? firstArg, "Loading from delegate...");
      });
    });

    describe("artifactsChangedHandler", () => {
      let refreshStub: sinon.SinonStub;
      let artifactsDelegateFetchChildrenStub: sinon.SinonStub;

      const someOtherEnvRegion = {
        provider: "aws",
        region: "us-west-2",
        environmentId: "env-123" as EnvironmentId,
      };

      beforeEach(async () => {
        refreshStub = sandbox.stub(viewProvider, "refresh").resolves();
        const artifactsDelegate = viewProvider["artifactsDelegate"];
        artifactsDelegateFetchChildrenStub = sandbox.stub(artifactsDelegate, "fetchChildren");

        // Ensure we're in artifacts mode
        await viewProvider.switchMode(FlinkDatabaseViewProviderMode.Artifacts);
        refreshStub.resetHistory(); // from the mode switch
      });

      it("should do nothing if no database is selected", async () => {
        // no database selected
        viewProvider["resource"] = null;
        await viewProvider.artifactsChangedHandler(someOtherEnvRegion);

        sinon.assert.notCalled(refreshStub);
        sinon.assert.notCalled(artifactsDelegateFetchChildrenStub);
      });

      describe("when viewing a database", () => {
        const sameDbEnvRegion = {
          environmentId: "env-999" as EnvironmentId,
          provider: "gcp",
          region: "us-central1",
        };
        const db = CCloudKafkaCluster.create({
          ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          ...sameDbEnvRegion,
        }) as CCloudFlinkDbKafkaCluster;

        beforeEach(() => {
          viewProvider["resource"] = db;
        });

        it("should do nothing if the changed env/provider/region does not match the selected database", async () => {
          // select a database in a different env/provider/region
          await viewProvider.artifactsChangedHandler(someOtherEnvRegion);

          sinon.assert.notCalled(refreshStub);
          sinon.assert.notCalled(artifactsDelegateFetchChildrenStub);
        });

        it("should refresh if the changed env/provider/region matches and we're viewing artifacts", async () => {
          await viewProvider.artifactsChangedHandler(sameDbEnvRegion);

          sinon.assert.calledOnce(refreshStub);
          sinon.assert.calledWith(refreshStub, true); // deep refresh
          sinon.assert.notCalled(artifactsDelegateFetchChildrenStub);
        });

        it("should tell the artifacts delegate to refresh its cache if the changed env/provider/region matches but we're NOT viewing artifacts", async () => {
          await viewProvider.switchMode(FlinkDatabaseViewProviderMode.UDFs);
          refreshStub.resetHistory(); // from the mode switch

          await viewProvider.artifactsChangedHandler(sameDbEnvRegion);

          sinon.assert.notCalled(refreshStub);
          sinon.assert.calledOnce(artifactsDelegateFetchChildrenStub);
          sinon.assert.calledWith(artifactsDelegateFetchChildrenStub, db, true);
        });
      });
    });

    describe("udfsChangedHandler", () => {
      let refreshStub: sinon.SinonStub;
      let udfsDelegateFetchChildrenStub: sinon.SinonStub;

      beforeEach(async () => {
        refreshStub = sandbox.stub(viewProvider, "refresh").resolves();
        const udfsDelegate = viewProvider["udfsDelegate"];
        udfsDelegateFetchChildrenStub = sandbox.stub(udfsDelegate, "fetchChildren");

        // Ensure we're in UDFs mode
        await viewProvider.switchMode(FlinkDatabaseViewProviderMode.UDFs);
        refreshStub.resetHistory(); // from the mode switch
      });

      it("should do nothing if no database is selected", async () => {
        // no database selected
        viewProvider["resource"] = null;
        await viewProvider.udfsChangedHandler({ id: "db-123" } as CCloudFlinkDbKafkaCluster);
        sinon.assert.notCalled(refreshStub);
        sinon.assert.notCalled(udfsDelegateFetchChildrenStub);
      });

      describe("when viewing a database", () => {
        const db = CCloudKafkaCluster.create({
          ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          id: "db-999",
        }) as CCloudFlinkDbKafkaCluster;

        beforeEach(() => {
          viewProvider["resource"] = db;
        });

        it("should do nothing if the changed database does not match the selected database", async () => {
          await viewProvider.udfsChangedHandler({ id: "db-123" } as CCloudFlinkDbKafkaCluster);
          sinon.assert.notCalled(refreshStub);
          sinon.assert.notCalled(udfsDelegateFetchChildrenStub);
        });

        it("should refresh if the changed database matches and we're viewing UDFs", async () => {
          await viewProvider.udfsChangedHandler(db);
          sinon.assert.calledOnce(refreshStub);
          sinon.assert.calledWith(refreshStub, true); // deep refresh
          sinon.assert.notCalled(udfsDelegateFetchChildrenStub);
        });

        it("should tell the UDFs delegate to refresh its cache if the changed database matches but we're NOT viewing UDFs", async () => {
          await viewProvider.switchMode(FlinkDatabaseViewProviderMode.Artifacts);
          refreshStub.resetHistory(); // from the mode switch
          await viewProvider.udfsChangedHandler(db);
          sinon.assert.notCalled(refreshStub);
          sinon.assert.calledOnce(udfsDelegateFetchChildrenStub);
          sinon.assert.calledWith(udfsDelegateFetchChildrenStub, db, true);
        });
      });
    });
  });
});

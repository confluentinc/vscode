import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { createFlinkUDF } from "../../../tests/unit/testResources/flinkUDF";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources/kafkaCluster";
import * as emitters from "../../emitters";
import { type CCloudResourceLoader } from "../../loaders";
import { FlinkDatabaseResourceContainer } from "../../models/flinkDatabaseResourceContainer";
import type { FlinkUdf } from "../../models/flinkUDF";
import * as notifications from "../../notifications";
import * as kafkaClusterQuickpicks from "../../quickpicks/kafkaClusters";
import * as jarInspector from "../../utils/jarInspector";
import { FlinkDatabaseViewProvider } from "../../viewProviders/flinkDatabase";
import {
  detectClassesAndRegisterUDFs,
  executeUdfRegistrations,
  type ProgressReport,
  promptForFunctionNames,
  registerMultipleUdfs,
  reportRegistrationResults,
  selectClassesForUdfRegistration,
  type UdfRegistrationData,
} from "./udfRegistration";

// test helper for creating UdfRegistrationData stubs
function makeUdfReg(name: string): UdfRegistrationData {
  return {
    classInfo: { className: `com.acme.${name}Class`, simpleName: `${name}Class` },
    functionName: name,
  };
}

// Test constants for cloud/region
const TEST_CLOUD = "AWS";
const TEST_REGION = "us-east-1";

describe("commands/utils/udfRegistration", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("detectClassesAndRegisterUDFs", () => {
    it("inspects jar, shows quick pick, and handles user cancellation (no selection)", async () => {
      const testUri = vscode.Uri.file("/tmp/example.jar");
      const jarClasses: jarInspector.JarClassInfo[] = [
        { className: "org.example.FlinkFn", simpleName: "FlinkFn" },
      ];
      const inspectStub = sandbox.stub(jarInspector, "inspectJarClasses").resolves(jarClasses);
      const quickPickStub = sandbox
        .stub(vscode.window, "showQuickPick")
        // Simulate user cancelling w/o selection
        .resolves(undefined as any);

      await detectClassesAndRegisterUDFs(testUri, "artifact123", TEST_CLOUD, TEST_REGION);

      sinon.assert.calledOnce(inspectStub);
      sinon.assert.calledOnce(quickPickStub);
    });

    it("does not show quick pick when no classes found", async () => {
      const testUri = vscode.Uri.file("/tmp/empty.jar");
      const inspectStub = sandbox.stub(jarInspector, "inspectJarClasses").resolves([]);
      const quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined as any);

      await detectClassesAndRegisterUDFs(testUri, "artifact123", TEST_CLOUD, TEST_REGION);

      sinon.assert.calledOnce(inspectStub);
      sinon.assert.notCalled(quickPickStub);
    });

    it("exits quietly when no function names are provided in user input", async () => {
      const testUri = vscode.Uri.file("/tmp/functions.jar");
      const jarClasses: jarInspector.JarClassInfo[] = [
        { className: "org.example.AlphaFn", simpleName: "AlphaFn" },
        { className: "org.example.BetaFn", simpleName: "BetaFn" },
      ];
      const inspectStub = sandbox.stub(jarInspector, "inspectJarClasses").resolves(jarClasses);
      const quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves([
        { label: "AlphaFn", description: "org.example.AlphaFn", classInfo: jarClasses[0] },
        { label: "BetaFn", description: "org.example.BetaFn", classInfo: jarClasses[1] },
      ] as any);
      sandbox
        .stub(vscode.window, "showInputBox")
        .onFirstCall()
        .resolves(undefined)
        .onSecondCall()
        .resolves(undefined);

      const result = await detectClassesAndRegisterUDFs(
        testUri,
        "artifact123",
        TEST_CLOUD,
        TEST_REGION,
      );
      sinon.assert.calledOnce(inspectStub);
      sinon.assert.calledOnce(quickPickStub);
      assert.strictEqual(result, undefined);
    });
  });

  describe("selectClassesForUdfRegistration", () => {
    it("returns selected class infos when user picks multiple items", async () => {
      const classInfos: jarInspector.JarClassInfo[] = [
        { className: "com.acme.Alpha", simpleName: "Alpha" },
        { className: "com.acme.Beta", simpleName: "Beta" },
      ];

      const showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves([
        { label: "Alpha", description: "com.acme.Alpha", classInfo: classInfos[0] },
        { label: "Beta", description: "com.acme.Beta", classInfo: classInfos[1] },
      ] as any);

      const result = await selectClassesForUdfRegistration(classInfos);

      sinon.assert.calledOnce(showQuickPickStub);
      assert.deepStrictEqual(
        result,
        classInfos,
        "Should map back to underlying JarClassInfo objects",
      );
    });
  });

  describe("promptForFunctionNames", () => {
    it("returns registrations for each selected class + trims input", async () => {
      const classInfos: jarInspector.JarClassInfo[] = [
        { className: "com.acme.FooUdf", simpleName: "FooUdf" },
        { className: "com.acme.BarUdf", simpleName: "BarUdf" },
      ];

      const showInputStub = sandbox
        .stub(vscode.window, "showInputBox")
        .onFirstCall()
        .resolves("foo_fn")
        .onSecondCall()
        .resolves("  bar_fn  "); //intentional whitespace

      const result = await promptForFunctionNames(classInfos);

      sinon.assert.calledTwice(showInputStub);
      const expected: UdfRegistrationData[] = [
        { classInfo: classInfos[0], functionName: "foo_fn" },
        { classInfo: classInfos[1], functionName: "bar_fn" },
      ];
      assert.deepStrictEqual(result, expected);
    });

    it("skips classes when user cancels input while keeping any other names entered", async () => {
      const classInfos: jarInspector.JarClassInfo[] = [
        { className: "com.acme.Foo", simpleName: "Foo" },
        { className: "com.acme.Bar", simpleName: "Bar" },
        { className: "com.acme.Baz", simpleName: "Baz" },
      ];

      const showInputStub = sandbox
        .stub(vscode.window, "showInputBox")
        // First class simpulate user Esc
        .onFirstCall()
        .resolves(undefined)
        // Second input provided
        .onSecondCall()
        .resolves("bar")
        // Third cancelled/Esc
        .onThirdCall()
        .resolves(undefined);

      const result = await promptForFunctionNames(classInfos);

      sinon.assert.calledThrice(showInputStub);
      const expected: UdfRegistrationData[] = [{ classInfo: classInfos[1], functionName: "bar" }];
      assert.deepStrictEqual(result, expected);
    });

    it("returns empty array when user cancels all inputs", async () => {
      const classInfos: jarInspector.JarClassInfo[] = [
        { className: "c.A", simpleName: "A" },
        { className: "c.B", simpleName: "B" },
      ];

      const showInputStub = sandbox
        .stub(vscode.window, "showInputBox")
        .onFirstCall()
        .resolves(undefined)
        .onSecondCall()
        .resolves(undefined);

      const result = await promptForFunctionNames(classInfos);

      sinon.assert.calledTwice(showInputStub);
      assert.deepStrictEqual(result, []);
    });
  });

  describe("registerMultipleUdfs", () => {
    const exampleDatabase = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
    let withProgressStub: sinon.SinonStub;
    let getDbViewStub: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;
    let loaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let infoNotifStub: sinon.SinonStub;
    let errorMsgStub: sinon.SinonStub;
    let fireStub: sinon.SinonStub;

    beforeEach(() => {
      withProgressStub = sandbox
        .stub(vscode.window, "withProgress")
        .callsFake(async (_o: any, task: any) => task({ report: () => {} }));
      getDbViewStub = sandbox.createStubInstance(FlinkDatabaseViewProvider);
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(getDbViewStub);
      getDbViewStub.resource = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

      loaderStub = getStubbedCCloudResourceLoader(sandbox);

      infoNotifStub = sandbox.stub(notifications, "showInfoNotificationWithButtons").resolves();
      errorMsgStub = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
      fireStub = sandbox.stub(emitters.udfsChanged, "fire");
    });

    it("returns undefined when no database selected", async () => {
      getDbViewStub.resource = null; // no Flink Database selected
      const qpStub = sandbox
        .stub(kafkaClusterQuickpicks, "flinkDatabaseQuickpick")
        .resolves(undefined); // user chose not to select a Flink Database
      const result = await registerMultipleUdfs(
        [makeUdfReg("foo")],
        "artifact123",
        TEST_CLOUD,
        TEST_REGION,
      );
      sinon.assert.calledOnce(qpStub);
      assert.strictEqual(
        result,
        undefined,
        "Should return undefined when user cancels database selection",
      );
    });

    it("returns empty results when registrations empty", async () => {
      const result = await registerMultipleUdfs([], "artifact123", TEST_CLOUD, TEST_REGION);
      sinon.assert.calledOnce(withProgressStub);
      assert.deepStrictEqual(result, { successes: [], failures: [] });
      sinon.assert.calledOnce(fireStub);
      sinon.assert.notCalled(infoNotifStub);
      sinon.assert.notCalled(errorMsgStub);
    });

    it("registers each UDF successfully returning successes", async () => {
      const regs = [makeUdfReg("foo"), makeUdfReg("bar")];
      const result = await registerMultipleUdfs(regs, "artifact123", TEST_CLOUD, TEST_REGION);
      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledTwice(loaderStub.executeBackgroundFlinkStatement);
      sinon.assert.calledOnce(fireStub);
      assert.deepStrictEqual(result?.successes, ["foo", "bar"]);
      assert.deepStrictEqual(result?.failures, []);
    });

    it("handles partial failures returning mixed results", async () => {
      const regs = [makeUdfReg("okFn"), makeUdfReg("failFn")];
      loaderStub.executeBackgroundFlinkStatement
        .onFirstCall()
        .resolves(undefined)
        .onSecondCall()
        .rejects(new Error("boom failure"));

      const result = await registerMultipleUdfs(regs, "artifact123", TEST_CLOUD, TEST_REGION);

      sinon.assert.calledTwice(loaderStub.executeBackgroundFlinkStatement);
      assert.deepStrictEqual(result?.successes, ["okFn"]);
      assert.strictEqual(result?.failures.length, 1);
      assert.strictEqual(result?.failures[0].functionName, "failFn");
    });

    it("calls the flinkDatabaseQuickpick function when no database is selected", async () => {
      getDbViewStub.resource = null; // no Flink Database selected
      const qpStub = sandbox
        .stub(kafkaClusterQuickpicks, "flinkDatabaseQuickpick")
        .resolves(exampleDatabase);
      await registerMultipleUdfs([makeUdfReg("foo")], "artifact123", TEST_CLOUD, TEST_REGION);
      sinon.assert.calledOnce(qpStub);
    });
  });

  describe("executeUdfRegistrations", () => {
    const db = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
    let loaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let fireStub: sinon.SinonStub;

    beforeEach(() => {
      loaderStub = getStubbedCCloudResourceLoader(sandbox);
      fireStub = sandbox.stub(emitters.udfsChanged, "fire");
    });
    it("executes statements and returns all successes", async () => {
      const regs = [makeUdfReg("alpha"), makeUdfReg("beta")];
      const progress: vscode.Progress<ProgressReport> = { report: () => {} };
      const result = await executeUdfRegistrations(regs, "artifactABC", db, progress);
      sinon.assert.calledTwice(loaderStub.executeBackgroundFlinkStatement);
      assert.deepStrictEqual(result.successes, ["alpha", "beta"]);
      assert.deepStrictEqual(result.failures, []);
      sinon.assert.calledOnce(fireStub);
    });

    it("records failures while continuing processing", async () => {
      const regs = [makeUdfReg("okFn"), makeUdfReg("badFn"), makeUdfReg("alsoOk")];

      loaderStub.executeBackgroundFlinkStatement
        .onFirstCall()
        .resolves(undefined)
        .onSecondCall()
        .rejects(new Error("boom"))
        .onThirdCall()
        .resolves(undefined);

      const progress: vscode.Progress<ProgressReport> = { report: () => {} };
      const result = await executeUdfRegistrations(regs, "artifactZ", db, progress);

      assert.deepStrictEqual(result.successes, ["okFn", "alsoOk"]);
      assert.strictEqual(result.failures.length, 1);
      assert.strictEqual(result.failures[0].functionName, "badFn");
      sinon.assert.calledOnce(fireStub);
    });

    it("extracts Flink detail from error message when present", async () => {
      const regs = [makeUdfReg("detailFn")];
      loaderStub.executeBackgroundFlinkStatement.rejects(
        new Error("Some wrapper msg Error detail: Specific failure reason here"),
      );

      const progress: vscode.Progress<ProgressReport> = { report: () => {} };
      const result = await executeUdfRegistrations(regs, "artifactY", db, progress);

      assert.strictEqual(result.successes.length, 0);
      assert.strictEqual(result.failures.length, 1);
      assert.strictEqual(result.failures[0].error, "Specific failure reason here");
    });

    it("reports progress messages", async () => {
      const regs = [makeUdfReg("one")];
      const reports: string[] = [];
      const progress: vscode.Progress<ProgressReport> = {
        report: (v) => {
          if (v.message) reports.push(v.message);
        },
      };
      await executeUdfRegistrations(regs, "artifactP", db, progress);
      assert.ok(
        reports.some((m) => m.includes("Registering one")),
        "Should log register message",
      );
      assert.ok(
        reports.some((m) => m.includes("Updating UDF view")),
        "Should log update message",
      );
    });
  });

  describe("reportRegistrationResults", () => {
    let infoStub: sinon.SinonStub;
    let errStub: sinon.SinonStub;
    let flinkDbViewProviderStub: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;
    let stubbedUdfContainer: sinon.SinonStubbedInstance<FlinkDatabaseResourceContainer<FlinkUdf>>;

    beforeEach(() => {
      infoStub = sandbox.stub(notifications, "showInfoNotificationWithButtons").resolves();
      errStub = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);

      flinkDbViewProviderStub = sandbox.createStubInstance(FlinkDatabaseViewProvider);
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(flinkDbViewProviderStub);
      stubbedUdfContainer = sandbox.createStubInstance(FlinkDatabaseResourceContainer<FlinkUdf>);
      // no preloaded UDFs in the view's UDFs container by default
      stubbedUdfContainer.gatherResources.resolves([]);
      flinkDbViewProviderStub.udfsContainer = stubbedUdfContainer;
    });

    it("shows single success message with a 'View UDF' button", async () => {
      const testUdf = createFlinkUDF("fooFn");
      stubbedUdfContainer.gatherResources.resolves([testUdf]);

      await reportRegistrationResults(1, { successes: ["fooFn"], failures: [] });
      sinon.assert.calledOnce(infoStub);
      const msg = infoStub.firstCall.args[0] as string;
      assert.ok(msg.includes("UDF registered successfully"), "Should indicate single success");

      const buttons = infoStub.firstCall.args[1] as Record<string, () => void>;
      assert.ok(buttons["View UDF"], "Should include a 'View UDF' button");
      sinon.assert.match(buttons["View UDF"], sinon.match.func);
      sinon.assert.notCalled(errStub);
    });

    it("'View UDF' button reveals the UDF in the Flink Database view", async () => {
      const testUdf = createFlinkUDF("fooFn");
      stubbedUdfContainer.gatherResources.resolves([testUdf]);

      await reportRegistrationResults(1, { successes: ["fooFn"], failures: [] });

      const buttons = infoStub.firstCall.args[1] as Record<string, () => void>;
      await buttons["View UDF"]();

      sinon.assert.calledOnce(flinkDbViewProviderStub.revealResource);
      sinon.assert.calledWith(flinkDbViewProviderStub.revealResource, testUdf);
    });

    it("'View UDF' button handles when the view provider isn't tracking a UDF", async () => {
      stubbedUdfContainer.gatherResources.resolves([]);

      await reportRegistrationResults(1, { successes: ["nonexistent"], failures: [] });

      const buttons = infoStub.firstCall.args[1] as Record<string, () => void>;
      assert.strictEqual(buttons["View UDFs"], undefined);
      sinon.assert.notCalled(flinkDbViewProviderStub.revealResource);
    });

    it("shows all success message for multiple UDFs with a 'View UDFs' button", async () => {
      const testUdfs = [createFlinkUDF("a"), createFlinkUDF("b")];
      stubbedUdfContainer.gatherResources.resolves(testUdfs);

      await reportRegistrationResults(2, { successes: ["a", "b"], failures: [] });
      sinon.assert.calledOnce(infoStub);
      const msg = infoStub.firstCall.args[0] as string;
      assert.ok(msg.includes("All 2 UDF(s) registered successfully"));

      const buttons = infoStub.firstCall.args[1] as Record<string, () => void>;
      assert.ok(buttons["View UDFs"], "Should include a 'View UDFs' button");
      sinon.assert.notCalled(errStub);
    });

    it("'View UDFs' button reveals the UDFs container with expand=true", async () => {
      const testUdfs = [createFlinkUDF("a"), createFlinkUDF("b")];
      // separate container since we can't multi-reveal individual UDFs at once
      const testContainer = new FlinkDatabaseResourceContainer<FlinkUdf>("UDFs", testUdfs);
      flinkDbViewProviderStub.udfsContainer = testContainer;
      sandbox.stub(testContainer, "gatherResources").resolves(testUdfs);

      await reportRegistrationResults(2, { successes: ["a", "b"], failures: [] });

      const buttons = infoStub.firstCall.args[1] as Record<string, () => void>;
      await buttons["View UDFs"]();

      sinon.assert.calledOnce(flinkDbViewProviderStub.revealResource);
      sinon.assert.calledWith(flinkDbViewProviderStub.revealResource, testContainer, {
        expand: true,
      });
    });

    it("shows partial success message and error details without notification buttons", async () => {
      await reportRegistrationResults(3, {
        successes: ["good1", "good2"],
        failures: [{ functionName: "bad1", error: "some error" }],
      });
      sinon.assert.calledOnce(infoStub);
      sinon.assert.calledOnce(errStub);
      const infoMsg = infoStub.firstCall.args[0] as string;
      const errMsg = errStub.firstCall.args[0] as string;
      assert.ok(infoMsg.includes("2 of 3"), "Should indicate partial success");
      assert.ok(errMsg.includes("bad1: some error"), "Should include failure detail");

      const buttons = infoStub.firstCall.args[1] as Record<string, () => void>;
      assert.strictEqual(
        Object.keys(buttons).length,
        0,
        "Should not include buttons for partial success",
      );
    });

    it("shows only failure message when all fail", async () => {
      await reportRegistrationResults(2, {
        successes: [],
        failures: [
          { functionName: "x", error: "boom" },
          { functionName: "y", error: "fail" },
        ],
      });
      sinon.assert.notCalled(infoStub);
      sinon.assert.calledOnce(errStub);
      const errMsg = errStub.firstCall.args[0] as string;
      assert.ok(errMsg.includes("Failed to register 2 UDF"), "Should report count");
      assert.ok(errMsg.includes("x: boom"), "Should list first error");
      assert.ok(errMsg.includes("y: fail"), "Should list second error");
    });
  });
});

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as emitters from "../../emitters";
import { CCloudResourceLoader } from "../../loaders";
import * as notifications from "../../notifications";
import * as kafkaClusterQuickpicks from "../../quickpicks/kafkaClusters";
import * as jarInspector from "../../utils/jarInspector";
import { FlinkDatabaseViewProvider } from "../../viewProviders/flinkDatabase";
import {
  detectClassesAndRegisterUDFs,
  executeUdfRegistrations,
  ProgressReporter,
  promptForFunctionNames,
  registerMultipleUdfs,
  reportRegistrationResults,
  selectClassesForUdfRegistration,
  UdfRegistrationData,
} from "./udfRegistration";

describe("commands/utils/udfRegistration", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("detectClassesAndRegisterUDFs", () => {
    it("exits and shows error when artifact ID not provided", async () => {
      const testUri = vscode.Uri.file("/tmp/example.jar");
      const artifactId = undefined; // Missing artifact ID
      const errorStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();
      const result = await detectClassesAndRegisterUDFs(testUri, artifactId);
      sinon.assert.calledOnce(errorStub);
      assert.strictEqual(result, undefined);
    });

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

      await detectClassesAndRegisterUDFs(testUri, "artifact123");

      sinon.assert.calledOnce(inspectStub);
      sinon.assert.calledOnce(quickPickStub);
    });

    it("does not show quick pick when no classes found", async () => {
      const testUri = vscode.Uri.file("/tmp/empty.jar");
      const inspectStub = sandbox.stub(jarInspector, "inspectJarClasses").resolves([]);
      const quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined as any);

      await detectClassesAndRegisterUDFs(testUri, "artifact123");

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

      const result = await detectClassesAndRegisterUDFs(testUri, "artifact123");
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
    const exampleDatabase = { provider: "aws", region: "us-east-1" } as any;
    function makeRegistration(name: string): UdfRegistrationData {
      return {
        classInfo: { className: `com.acme.${name}Class`, simpleName: `${name}Class` },
        functionName: name,
      };
    }
    let withProgressStub: sinon.SinonStub;
    let getDbStub: sinon.SinonStub;
    let loaderStub: sinon.SinonStub;
    let infoNotifStub: sinon.SinonStub;
    let errorMsgStub: sinon.SinonStub;
    let fireStub: sinon.SinonStub;

    beforeEach(() => {
      withProgressStub = sandbox
        .stub(vscode.window, "withProgress")
        .callsFake(async (_o: any, task: any) => task({ report: () => {} }));
      getDbStub = sandbox
        .stub(FlinkDatabaseViewProvider, "getInstance")
        .returns({ database: exampleDatabase } as unknown as FlinkDatabaseViewProvider);
      loaderStub = sandbox.stub(CCloudResourceLoader, "getInstance").returns({
        executeBackgroundFlinkStatement: sandbox.stub().resolves(undefined),
      } as unknown as CCloudResourceLoader);
      infoNotifStub = sandbox.stub(notifications, "showInfoNotificationWithButtons").resolves();
      errorMsgStub = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
      fireStub = sandbox.stub(emitters.udfsChanged, "fire");
    });

    it("throws when no database selected", async () => {
      getDbStub.returns({ database: undefined } as unknown as FlinkDatabaseViewProvider);
      const qpStub = sandbox
        .stub(kafkaClusterQuickpicks, "flinkDatabaseQuickpick")
        .resolves(undefined); // user did not select a db
      await assert.rejects(
        () => registerMultipleUdfs([makeRegistration("foo")], "artifact123"),
        /No Flink database selected/,
      );
      sinon.assert.calledOnce(qpStub);
    });

    it("returns empty results when registrations empty", async () => {
      const result = await registerMultipleUdfs([], "artifact123");
      sinon.assert.calledOnce(withProgressStub);
      assert.deepStrictEqual(result, { successes: [], failures: [] });
      sinon.assert.calledOnce(fireStub);
      sinon.assert.notCalled(infoNotifStub);
      sinon.assert.notCalled(errorMsgStub);
    });

    it("registers each UDF successfully returning successes", async () => {
      const regs = [makeRegistration("foo"), makeRegistration("bar")];
      const result = await registerMultipleUdfs(regs, "artifact123");
      sinon.assert.calledOnce(withProgressStub);
      const execStub = loaderStub.returnValues[0]
        .executeBackgroundFlinkStatement as sinon.SinonStub;
      sinon.assert.callCount(execStub, 2);
      sinon.assert.calledOnce(fireStub);
      assert.deepStrictEqual(result.successes, ["foo", "bar"]);
      assert.deepStrictEqual(result.failures, []);
    });

    it("handles partial failures returning mixed results", async () => {
      const regs = [makeRegistration("okFn"), makeRegistration("failFn")];
      const execStub = sandbox
        .stub()
        .onFirstCall()
        .resolves(undefined)
        .onSecondCall()
        .rejects(new Error("boom failure"));
      loaderStub.returns({
        executeBackgroundFlinkStatement: execStub,
      } as unknown as CCloudResourceLoader);

      const result = await registerMultipleUdfs(regs, "artifact123");
      assert.deepStrictEqual(result.successes, ["okFn"]);
      assert.strictEqual(result.failures.length, 1);
      assert.strictEqual(result.failures[0].functionName, "failFn");
    });

    it("calls the flinkDatabaseQuickpick function when no database is selected", async () => {
      getDbStub.returns({ database: undefined } as unknown as FlinkDatabaseViewProvider);
      const qpStub = sandbox
        .stub(kafkaClusterQuickpicks, "flinkDatabaseQuickpick")
        .resolves(exampleDatabase);
      await registerMultipleUdfs([makeRegistration("foo")], "artifact123");
      sinon.assert.calledOnce(qpStub);
    });
  });

  describe("executeUdfRegistrations", () => {
    let sandboxExec: sinon.SinonSandbox;
    let loaderStub: sinon.SinonStub;
    let fireStub: sinon.SinonStub;

    const db = { provider: "aws", region: "us-west-2" } as any;

    function makeReg(name: string): UdfRegistrationData {
      return {
        classInfo: { className: `com.acme.${name}Cls`, simpleName: `${name}Cls` },
        functionName: name,
      };
    }

    beforeEach(() => {
      sandboxExec = sandbox;
      loaderStub = sandboxExec.stub(CCloudResourceLoader, "getInstance").returns({
        executeBackgroundFlinkStatement: sandboxExec.stub().resolves(undefined),
      } as unknown as CCloudResourceLoader);
      fireStub = sandboxExec.stub(emitters.udfsChanged, "fire");
    });

    it("executes statements and returns all successes", async () => {
      const regs = [makeReg("alpha"), makeReg("beta")];
      const progress: ProgressReporter = { report: () => {} };
      const result = await executeUdfRegistrations(regs, "artifactABC", db, progress);
      const execStub = loaderStub.returnValues[0]
        .executeBackgroundFlinkStatement as sinon.SinonStub;
      sinon.assert.callCount(execStub, 2);
      assert.deepStrictEqual(result.successes, ["alpha", "beta"]);
      assert.deepStrictEqual(result.failures, []);
      sinon.assert.calledOnce(fireStub);
    });

    it("records failures while continuing processing", async () => {
      const regs = [makeReg("okFn"), makeReg("badFn"), makeReg("alsoOk")];
      const execStub = sandboxExec
        .stub()
        .onFirstCall()
        .resolves(undefined)
        .onSecondCall()
        .rejects(new Error("boom"))
        .onThirdCall()
        .resolves(undefined);
      loaderStub.returns({
        executeBackgroundFlinkStatement: execStub,
      } as unknown as CCloudResourceLoader);

      const progress: ProgressReporter = { report: () => {} };
      const result = await executeUdfRegistrations(regs, "artifactZ", db, progress);

      assert.deepStrictEqual(result.successes, ["okFn", "alsoOk"]);
      assert.strictEqual(result.failures.length, 1);
      assert.strictEqual(result.failures[0].functionName, "badFn");
      sinon.assert.calledOnce(fireStub);
    });

    it("extracts Flink detail from error message when present", async () => {
      const regs = [makeReg("detailFn")];
      const execStub = sandboxExec
        .stub()
        .rejects(new Error("Some wrapper msg Error detail: Specific failure reason here"));
      loaderStub.returns({
        executeBackgroundFlinkStatement: execStub,
      } as unknown as CCloudResourceLoader);

      const progress: ProgressReporter = { report: () => {} };
      const result = await executeUdfRegistrations(regs, "artifactY", db, progress);

      assert.strictEqual(result.successes.length, 0);
      assert.strictEqual(result.failures.length, 1);
      assert.strictEqual(result.failures[0].error, "Specific failure reason here");
    });

    it("reports progress messages", async () => {
      const regs = [makeReg("one")];
      const reports: string[] = [];
      const progress: ProgressReporter = {
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

    beforeEach(() => {
      infoStub = sandbox.stub(notifications, "showInfoNotificationWithButtons").resolves();
      errStub = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
    });

    it("shows single success message", () => {
      reportRegistrationResults(1, { successes: ["fooFn"], failures: [] });
      sinon.assert.calledOnce(infoStub);
      const msg = infoStub.firstCall.args[0] as string;
      assert.ok(msg.includes("UDF registered successfully"), "Should indicate single success");
      sinon.assert.notCalled(errStub);
    });

    it("shows all success message for multiple UDFs", () => {
      reportRegistrationResults(2, { successes: ["a", "b"], failures: [] });
      sinon.assert.calledOnce(infoStub);
      const msg = infoStub.firstCall.args[0] as string;
      assert.ok(
        msg.includes("All 2 UDF(s) registered successfully"),
        "Should indicate all success",
      );
      sinon.assert.notCalled(errStub);
    });

    it("shows partial success message and error details", () => {
      reportRegistrationResults(3, {
        successes: ["good1", "good2"],
        failures: [{ functionName: "bad1", error: "some error" }],
      });
      sinon.assert.calledOnce(infoStub);
      sinon.assert.calledOnce(errStub);
      const infoMsg = infoStub.firstCall.args[0] as string;
      const errMsg = errStub.firstCall.args[0] as string;
      assert.ok(infoMsg.includes("2 of 3"), "Should indicate partial success");
      assert.ok(errMsg.includes("bad1: some error"), "Should include failure detail");
    });

    it("shows only failure message when all fail", () => {
      reportRegistrationResults(2, {
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

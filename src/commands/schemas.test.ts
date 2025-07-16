import * as assert from "assert";
import * as sinon from "sinon";
import { commands, env, Uri, window, workspace } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SCHEMA_REVISED,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ResponseError } from "../clients/sidecar";
import * as schemaDocumentProvider from "../documentProviders/schema";
import { CCloudResourceLoader } from "../loaders";
import { SchemaType, Subject } from "../models/schema";
import * as notifications from "../notifications";
import * as quickpicks from "../quickpicks/schemas";
import * as uriQuickpicks from "../quickpicks/uris";
import * as telemetry from "../telemetry/events";
import * as fileUtils from "../utils/file";
import * as schemasViewProvider from "../viewProviders/schemas";
import * as schemas from "./schemas";
import {
  copySubjectCommand,
  diffLatestSchemasCommand,
  uploadSchemaFromFileCommand,
} from "./schemas";
import * as schemaManagementDeletion from "./utils/schemaManagement/deletion";
import * as schemaManagementUpload from "./utils/schemaManagement/upload";

describe.only("commands/schemas.ts", function () {
  let sandbox: sinon.SinonSandbox;

  before(async function () {
    await getTestExtensionContext();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("viewLocallyCommand()", function () {
    let withProgressStub: sinon.SinonStub;
    let loadOrCreateSchemaViewerStub: sinon.SinonStub;

    beforeEach(function () {
      withProgressStub = sandbox.stub(window, "withProgress").resolves();
      loadOrCreateSchemaViewerStub = sandbox
        .stub(schemaDocumentProvider, "loadOrCreateSchemaViewer")
        .resolves();
    });

    it("should load schema in viewer with progress notification", async function () {
      withProgressStub.callsFake(async (options, task) => await task());
      loadOrCreateSchemaViewerStub.resolves();

      await schemas.viewLocallyCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledOnceWithExactly(loadOrCreateSchemaViewerStub, TEST_CCLOUD_SCHEMA);
    });

    it("should return early if called if the passed argument is not a Schema", async function () {
      await schemas.viewLocallyCommand("invalid-argument" as any);

      sinon.assert.notCalled(withProgressStub);
      sinon.assert.notCalled(loadOrCreateSchemaViewerStub);
    });
  });

  describe("copySchemaRegistryIdCommand()", function () {
    let _originalClipboardContents: string | undefined;

    let getSchemasViewProviderStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;

    beforeEach(async function () {
      _originalClipboardContents = await env.clipboard.readText();
      // no need to stub the whole SchemasViewProvider instance, just the property we use
      getSchemasViewProviderStub = sandbox.stub(schemasViewProvider, "getSchemasViewProvider");
      showInformationMessageStub = sandbox.stub(window, "showInformationMessage").resolves();
    });

    afterEach(async () => {
      if (_originalClipboardContents !== undefined) {
        await env.clipboard.writeText(_originalClipboardContents);
      }
    });

    it("should copy a Schema Registry ID to the clipboard and show an info notification", async function () {
      getSchemasViewProviderStub.returns({ schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY });

      await schemas.copySchemaRegistryIdCommand();

      const copiedValue = await env.clipboard.readText();
      assert.strictEqual(copiedValue, TEST_CCLOUD_SCHEMA_REGISTRY.id);
      sinon.assert.calledOnceWithExactly(
        showInformationMessageStub,
        `Copied "${TEST_CCLOUD_SCHEMA_REGISTRY.id}" to clipboard.`,
      );
    });

    it("should return early if no Schema Registry is available", async function () {
      getSchemasViewProviderStub.returns({ schemaRegistry: null });

      await schemas.copySchemaRegistryIdCommand();

      const copiedValue = await env.clipboard.readText();
      assert.strictEqual(copiedValue, _originalClipboardContents);
      sinon.assert.notCalled(showInformationMessageStub);
    });
  });

  describe("copySubjectCommand()", () => {
    let _originalClipboardContents: string | undefined;
    let showInformationMessageStub: sinon.SinonStub;

    beforeEach(async () => {
      _originalClipboardContents = await env.clipboard.readText();
      showInformationMessageStub = sandbox.stub(window, "showInformationMessage").resolves();
    });

    afterEach(async () => {
      if (_originalClipboardContents !== undefined) {
        await env.clipboard.writeText(_originalClipboardContents);
      }
    });

    it("should copy the subject name to the clipboard", async () => {
      await copySubjectCommand(TEST_CCLOUD_SUBJECT);

      const writtenValue = await env.clipboard.readText();
      assert.strictEqual(writtenValue, TEST_CCLOUD_SUBJECT.name);
      sinon.assert.calledOnceWithExactly(
        showInformationMessageStub,
        `Copied subject name "${TEST_CCLOUD_SUBJECT.name}" to clipboard.`,
      );
    });

    it("should return early if a subject isn't provided", async () => {
      await copySubjectCommand(undefined as any);

      const writtenValue = await env.clipboard.readText();
      assert.strictEqual(writtenValue, _originalClipboardContents);
      sinon.assert.notCalled(showInformationMessageStub);
    });
  });

  describe("createSchemaCommand()", function () {
    let schemaTypeQuickPickStub: sinon.SinonStub;
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setEditorLanguageForSchemaStub: sinon.SinonStub;

    beforeEach(function () {
      schemaTypeQuickPickStub = sandbox.stub(quickpicks, "schemaTypeQuickPick").resolves();
      openTextDocumentStub = sandbox.stub(workspace, "openTextDocument").resolves();
      showTextDocumentStub = sandbox.stub(window, "showTextDocument").resolves();
      setEditorLanguageForSchemaStub = sandbox
        .stub(schemaDocumentProvider, "setEditorLanguageForSchema")
        .resolves();
    });

    it("should open a new editor with the selected schema type", async function () {
      const fakeDocument = { uri: { path: "untitled:1" } };
      const fakeEditor = { document: fakeDocument };
      schemaTypeQuickPickStub.resolves(SchemaType.Avro);
      openTextDocumentStub.resolves(fakeDocument);
      showTextDocumentStub.resolves(fakeEditor);

      await schemas.createSchemaCommand();

      sinon.assert.calledOnce(schemaTypeQuickPickStub);
      sinon.assert.calledOnceWithExactly(openTextDocumentStub, { language: SchemaType.Avro });
      sinon.assert.calledOnceWithExactly(showTextDocumentStub, fakeDocument.uri, {
        preview: false,
      });
      sinon.assert.calledOnceWithExactly(
        setEditorLanguageForSchemaStub,
        fakeEditor,
        SchemaType.Avro,
      );
    });

    it("should return early if the user cancels the schema type quickpick", async function () {
      schemaTypeQuickPickStub.resolves(undefined);

      await schemas.createSchemaCommand();

      sinon.assert.calledOnce(schemaTypeQuickPickStub);
      sinon.assert.notCalled(openTextDocumentStub);
      sinon.assert.notCalled(showTextDocumentStub);
    });
  });

  describe("diffLatestSchemasCommand()", function () {
    let executeCommandStub: sinon.SinonStub;

    beforeEach(() => {
      executeCommandStub = sandbox.stub(commands, "executeCommand").resolves();
    });

    it("should call 'Select for Compare' for the second newest schema version and 'Compare with Selected' for the newest schema version", async () => {
      await diffLatestSchemasCommand(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);

      sinon.assert.calledWithExactly(
        executeCommandStub,
        "confluent.diff.selectForCompare",
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![1],
      );
      sinon.assert.calledWithExactly(
        executeCommandStub,
        "confluent.diff.compareWithSelected",
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![0],
      );
    });

    it("should not call any diff-related commands if there are fewer than two schemas for a subject", async () => {
      const schemaGroup = new Subject(
        TEST_CCLOUD_SUBJECT.name,
        TEST_CCLOUD_SUBJECT.connectionId,
        TEST_CCLOUD_SUBJECT.environmentId,
        TEST_CCLOUD_SUBJECT.schemaRegistryId,
        [TEST_CCLOUD_SCHEMA_REVISED],
      );

      await diffLatestSchemasCommand(schemaGroup);

      sinon.assert.notCalled(executeCommandStub);
    });
  });

  describe("openLatestSchemasCommand()", function () {
    let getLatestSchemasForTopicStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let loadOrCreateSchemaViewerStub: sinon.SinonStub;

    beforeEach(function () {
      getLatestSchemasForTopicStub = sandbox.stub(
        schemaManagementUpload,
        "getLatestSchemasForTopic",
      );
      withProgressStub = sandbox.stub(window, "withProgress").resolves();
      showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
      loadOrCreateSchemaViewerStub = sandbox
        .stub(schemaDocumentProvider, "loadOrCreateSchemaViewer")
        .resolves();
    });

    it("should open read-only documents of the latest schema versions for a topic", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA_REVISED];
      getLatestSchemasForTopicStub.resolves(schemaGroup);
      withProgressStub.callsFake(async (options, task) => await task());
      loadOrCreateSchemaViewerStub.resolves();

      await schemas.openLatestSchemasCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.calledOnceWithExactly(getLatestSchemasForTopicStub, TEST_CCLOUD_KAFKA_TOPIC);
      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledTwice(loadOrCreateSchemaViewerStub);
    });

    it("should show an error notification when schemas cannot be loaded", async function () {
      const error = new schemaManagementUpload.CannotLoadSchemasError("Cannot load schemas");

      getLatestSchemasForTopicStub.rejects(error);

      await schemas.openLatestSchemasCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.calledOnceWithExactly(showErrorMessageStub, error.message);
      sinon.assert.notCalled(withProgressStub);
    });
  });

  describe("viewLatestLocallyCommand()", function () {
    let determineLatestSchemaStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;

    beforeEach(function () {
      determineLatestSchemaStub = sandbox.stub(schemaManagementUpload, "determineLatestSchema");
      withProgressStub = sandbox.stub(window, "withProgress").resolves();
    });

    it("should return early if the passed argument is not a Subject", async function () {
      await schemas.viewLatestLocallyCommand("not-subject" as any);

      sinon.assert.notCalled(determineLatestSchemaStub);
      sinon.assert.notCalled(withProgressStub);
    });

    it("should open the latest schema version in a viewer", async function () {
      determineLatestSchemaStub.resolves(TEST_CCLOUD_SCHEMA);

      await schemas.viewLatestLocallyCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithExactly(
        determineLatestSchemaStub,
        "viewLatestLocallyCommand",
        TEST_CCLOUD_SUBJECT,
      );
      // only check that we didn't exit from viewLocallyCommand early, since the tests for the
      // viewLocallyCommand() function already cover the rest of the logic
      sinon.assert.calledOnce(withProgressStub);
    });
  });

  describe("evolveSchemaCommand()", function () {
    let fetchSchemaBodyStub: sinon.SinonStub;
    let determineDraftSchemaUriStub: sinon.SinonStub;
    let applyEditStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setEditorLanguageForSchemaStub: sinon.SinonStub;

    beforeEach(function () {
      fetchSchemaBodyStub = sandbox.stub(schemaDocumentProvider, "fetchSchemaBody").resolves();
      determineDraftSchemaUriStub = sandbox
        .stub(schemaManagementUpload, "determineDraftSchemaUri")
        .resolves();
      applyEditStub = sandbox.stub(workspace, "applyEdit").resolves();
      showTextDocumentStub = sandbox.stub(window, "showTextDocument").resolves();
      setEditorLanguageForSchemaStub = sandbox
        .stub(schemaDocumentProvider, "setEditorLanguageForSchema")
        .resolves();
    });

    it("should a new editor with the latest schema version as the document body", async function () {
      const schemaBody = '{"type": "record", "name": "Test"}';
      const draftUri = Uri.parse("untitled:schema-draft");
      const fakeEditor = { document: { uri: draftUri } };
      fetchSchemaBodyStub.resolves(schemaBody);
      determineDraftSchemaUriStub.resolves(draftUri);
      applyEditStub.resolves(true);
      showTextDocumentStub.resolves(fakeEditor);

      await schemas.evolveSchemaCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnceWithExactly(fetchSchemaBodyStub, TEST_CCLOUD_SCHEMA);
      sinon.assert.calledOnceWithExactly(determineDraftSchemaUriStub, TEST_CCLOUD_SCHEMA);
      sinon.assert.calledOnce(applyEditStub);
      sinon.assert.calledOnceWithExactly(showTextDocumentStub, draftUri, { preview: false });
      sinon.assert.calledOnceWithExactly(
        setEditorLanguageForSchemaStub,
        fakeEditor,
        TEST_CCLOUD_SCHEMA.type,
      );
    });

    it("should return early if the passed argument is not a Schema", async function () {
      await schemas.evolveSchemaCommand("not-schema" as any);

      sinon.assert.notCalled(fetchSchemaBodyStub);
      sinon.assert.notCalled(determineDraftSchemaUriStub);
      sinon.assert.notCalled(applyEditStub);
      sinon.assert.notCalled(showTextDocumentStub);
      sinon.assert.notCalled(setEditorLanguageForSchemaStub);
    });
  });

  describe("evolveSchemaSubjectCommand()", function () {
    let determineLatestSchemaStub: sinon.SinonStub;
    let fetchSchemaBodyStub: sinon.SinonStub;

    beforeEach(function () {
      determineLatestSchemaStub = sandbox
        .stub(schemaManagementUpload, "determineLatestSchema")
        .resolves();
      fetchSchemaBodyStub = sandbox.stub(schemaDocumentProvider, "fetchSchemaBody").resolves();
    });

    it("should return early if the passed argument is not a Subject", async function () {
      await schemas.evolveSchemaSubjectCommand("not-subject" as any);

      sinon.assert.notCalled(determineLatestSchemaStub);
      sinon.assert.notCalled(fetchSchemaBodyStub);
    });

    it("should a new editor with the latest schema version as the document body for a given Subject", async function () {
      const schemaBody = '{"type": "record", "name": "Test"}';
      determineLatestSchemaStub.resolves(TEST_CCLOUD_SCHEMA);
      fetchSchemaBodyStub.resolves(schemaBody);

      await schemas.evolveSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithExactly(
        determineLatestSchemaStub,
        "evolveSchemaSubjectCommand",
        TEST_CCLOUD_SUBJECT,
      );
      // only check that we didn't exit from evolveSchemaCommand early, since the tests for the
      // evolveSchemaCommand() function already cover the rest of the logic
      sinon.assert.calledOnceWithExactly(fetchSchemaBodyStub, TEST_CCLOUD_SCHEMA);
    });
  });

  describe("deleteSchemaVersionCommand()", function () {
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let hardDeletionQuickPickStub: sinon.SinonStub;
    let confirmSchemaVersionDeletionStub: sinon.SinonStub;
    let showHardDeleteWarningModalStub: sinon.SinonStub;
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    let logUsageStub: sinon.SinonStub;

    beforeEach(function () {
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);

      hardDeletionQuickPickStub = sandbox
        .stub(schemaManagementDeletion, "hardDeletionQuickPick")
        .resolves();
      confirmSchemaVersionDeletionStub = sandbox
        .stub(schemaManagementDeletion, "confirmSchemaVersionDeletion")
        .resolves();
      showHardDeleteWarningModalStub = sandbox
        .stub(schemaManagementDeletion, "showHardDeleteWarningModal")
        .resolves();
      showErrorNotificationWithButtonsStub = sandbox
        .stub(notifications, "showErrorNotificationWithButtons")
        .resolves();
      withProgressStub = sandbox.stub(window, "withProgress").resolves();
      logUsageStub = sandbox.stub(telemetry, "logUsage");
    });

    it("should return early if the passed argument is not a Schema", async function () {
      await schemas.deleteSchemaVersionCommand("invalid-argument" as any);

      sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
      sinon.assert.notCalled(hardDeletionQuickPickStub);
    });

    it("should show an error notification and exit early if the schema version isn't found for the subject", async function () {
      stubbedLoader.getSchemasForSubject.resolves([TEST_CCLOUD_SCHEMA_REVISED]);

      await schemas.deleteSchemaVersionCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnceWithMatch(
        showErrorNotificationWithButtonsStub,
        "Schema not found in registry.",
        {
          "Refresh Schemas": sinon.match.func,
          "Open Logs": sinon.match.func,
          "File Issue": sinon.match.func,
        },
      );
    });

    it("should show an error notification and exit early if fetching/loading schemas for the associated subject returns a 404 ResponseError", async function () {
      stubbedLoader.getSchemasForSubject.rejects(
        new ResponseError(new Response("Not found", { status: 404 })),
      );

      await schemas.deleteSchemaVersionCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnceWithMatch(
        showErrorNotificationWithButtonsStub,
        "Schema not found in registry.",
        {
          "Refresh Schemas": sinon.match.func,
          "Open Logs": sinon.match.func,
          "File Issue": sinon.match.func,
        },
      );
      sinon.assert.notCalled(hardDeletionQuickPickStub);
    });

    it("should return early if the user cancels the hard/soft deletion quickpick", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(undefined);

      await schemas.deleteSchemaVersionCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnce(hardDeletionQuickPickStub);
      sinon.assert.notCalled(confirmSchemaVersionDeletionStub);
      sinon.assert.notCalled(showHardDeleteWarningModalStub);
      sinon.assert.notCalled(stubbedLoader.deleteSchemaVersion);
    });

    it("should return early if user cancels the deletion confirmation input box (version number of subject name)", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(false);
      confirmSchemaVersionDeletionStub.resolves(false);

      await schemas.deleteSchemaVersionCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnce(confirmSchemaVersionDeletionStub);
      sinon.assert.notCalled(stubbedLoader.deleteSchemaVersion);
    });

    it("should soft-delete a schema version after user confirmation", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA_REVISED];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(false); // soft delete
      confirmSchemaVersionDeletionStub.resolves(true);
      withProgressStub.callsFake(async (options, task) => await task());
      stubbedLoader.deleteSchemaVersion.resolves();

      await schemas.deleteSchemaVersionCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnceWithExactly(
        stubbedLoader.getSchemasForSubject,
        TEST_CCLOUD_SCHEMA.environmentId!,
        TEST_CCLOUD_SCHEMA.subject,
      );
      sinon.assert.calledOnceWithExactly(hardDeletionQuickPickStub, "Schema Version");
      sinon.assert.calledOnceWithExactly(
        confirmSchemaVersionDeletionStub,
        false,
        TEST_CCLOUD_SCHEMA,
        schemaGroup,
      );
      sinon.assert.notCalled(showHardDeleteWarningModalStub);
      sinon.assert.calledOnce(stubbedLoader.deleteSchemaVersion);
      sinon.assert.calledOnceWithExactly(
        stubbedLoader.deleteSchemaVersion,
        TEST_CCLOUD_SCHEMA,
        false,
        false,
      );
      sinon.assert.calledOnce(logUsageStub);
    });

    it("should hard-delete a schema version after user confirmation", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA_REVISED];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(true); // hard delete
      confirmSchemaVersionDeletionStub.resolves(true);
      withProgressStub.callsFake(async (options, task) => await task());
      showHardDeleteWarningModalStub.resolves(true);
      stubbedLoader.deleteSchemaVersion.resolves();

      await schemas.deleteSchemaVersionCommand(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnceWithExactly(
        stubbedLoader.getSchemasForSubject,
        TEST_CCLOUD_SCHEMA.environmentId!,
        TEST_CCLOUD_SCHEMA.subject,
      );
      sinon.assert.calledOnceWithExactly(hardDeletionQuickPickStub, "Schema Version");
      sinon.assert.calledOnceWithExactly(
        confirmSchemaVersionDeletionStub,
        true,
        TEST_CCLOUD_SCHEMA,
        schemaGroup,
      );
      sinon.assert.calledOnceWithExactly(showHardDeleteWarningModalStub, "schema version");
      sinon.assert.calledOnce(stubbedLoader.deleteSchemaVersion);
      sinon.assert.calledOnceWithExactly(
        stubbedLoader.deleteSchemaVersion,
        TEST_CCLOUD_SCHEMA,
        true,
        false,
      );
      sinon.assert.calledOnce(logUsageStub);
    });
  });

  describe("deleteSchemaSubjectCommand()", function () {
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let getSchemasViewProviderStub: sinon.SinonStub;
    let schemaSubjectQuickPickStub: sinon.SinonStub;
    let hardDeletionQuickPickStub: sinon.SinonStub;
    let confirmSchemaSubjectDeletionStub: sinon.SinonStub;
    let confirmSchemaVersionDeletionStub: sinon.SinonStub;
    let showHardDeleteWarningModalStub: sinon.SinonStub;
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    let logUsageStub: sinon.SinonStub;

    beforeEach(function () {
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      getSchemasViewProviderStub = sandbox.stub(schemasViewProvider, "getSchemasViewProvider");
      schemaSubjectQuickPickStub = sandbox.stub(quickpicks, "schemaSubjectQuickPick").resolves();
      hardDeletionQuickPickStub = sandbox
        .stub(schemaManagementDeletion, "hardDeletionQuickPick")
        .resolves();
      confirmSchemaSubjectDeletionStub = sandbox
        .stub(schemaManagementDeletion, "confirmSchemaSubjectDeletion")
        .resolves();
      confirmSchemaVersionDeletionStub = sandbox
        .stub(schemaManagementDeletion, "confirmSchemaVersionDeletion")
        .resolves();
      showHardDeleteWarningModalStub = sandbox
        .stub(schemaManagementDeletion, "showHardDeleteWarningModal")
        .resolves();
      showErrorNotificationWithButtonsStub = sandbox
        .stub(notifications, "showErrorNotificationWithButtons")
        .resolves();
      withProgressStub = sandbox.stub(window, "withProgress").resolves();
      logUsageStub = sandbox.stub(telemetry, "logUsage");
    });

    // shoup: we won't need this once https://github.com/confluentinc/vscode/issues/1875 is done
    // and the quickpick is removed
    it("should show a subject quickpick when no subject is provided", async function () {
      getSchemasViewProviderStub.returns({ schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY });
      schemaSubjectQuickPickStub.resolves("test-subject");
      stubbedLoader.getSchemasForSubject.resolves([TEST_CCLOUD_SCHEMA]);
      hardDeletionQuickPickStub.resolves(false);
      confirmSchemaVersionDeletionStub.resolves(true);
      withProgressStub.callsFake(async (options, task) => await task());

      await schemas.deleteSchemaSubjectCommand(undefined as any);

      sinon.assert.calledOnceWithExactly(
        schemaSubjectQuickPickStub,
        TEST_CCLOUD_SCHEMA_REGISTRY,
        false,
        "Choose a subject to delete",
      );
      sinon.assert.calledOnce(stubbedLoader.deleteSchemaSubject);
    });

    // shoup: we won't need this once https://github.com/confluentinc/vscode/issues/1875 is done
    // and the quickpick is removed
    it("should return early if no schema registry is available when showing the subject quickpick", async function () {
      getSchemasViewProviderStub.returns({ schemaRegistry: null });

      await schemas.deleteSchemaSubjectCommand(undefined as any);

      sinon.assert.notCalled(schemaSubjectQuickPickStub);
      sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
    });

    // shoup: we won't need this once https://github.com/confluentinc/vscode/issues/1875 is done
    // and the quickpick is removed
    it("should return early if user cancels subject quickpick", async function () {
      getSchemasViewProviderStub.returns({ schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY });
      schemaSubjectQuickPickStub.resolves(undefined);

      await schemas.deleteSchemaSubjectCommand(undefined as any);

      sinon.assert.calledOnce(schemaSubjectQuickPickStub);
      sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
    });

    it("should return early if the passed argument is not a Subject", async function () {
      await schemas.deleteSchemaSubjectCommand("invalid-argument" as any);

      sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
      sinon.assert.notCalled(hardDeletionQuickPickStub);
    });

    it("should show an error notification and exit early if the loader doesn't return schemas for the subject", async function () {
      stubbedLoader.getSchemasForSubject.resolves([]);

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithMatch(
        showErrorNotificationWithButtonsStub,
        "Schema subject not found in registry.",
        {
          "Refresh Schemas": sinon.match.func,
          "Open Logs": sinon.match.func,
          "File Issue": sinon.match.func,
        },
      );
      sinon.assert.notCalled(hardDeletionQuickPickStub);
    });

    it("should show an error notification and exit early if fetching schemas for the subject returns a 404 ResponseError", async function () {
      stubbedLoader.getSchemasForSubject.rejects(
        new ResponseError(new Response("Not found", { status: 404 })),
      );

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithMatch(
        showErrorNotificationWithButtonsStub,
        "Schema subject not found in registry.",
        {
          "Refresh Schemas": sinon.match.func,
          "Open Logs": sinon.match.func,
          "File Issue": sinon.match.func,
        },
      );
      sinon.assert.notCalled(hardDeletionQuickPickStub);
    });

    it("should return early if the user cancels the hard/soft deletion quickpick", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA_REVISED];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(undefined);

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnce(hardDeletionQuickPickStub);
      sinon.assert.notCalled(confirmSchemaSubjectDeletionStub);
      sinon.assert.notCalled(confirmSchemaVersionDeletionStub);
      sinon.assert.notCalled(stubbedLoader.deleteSchemaSubject);
    });

    it("should call confirmSchemaSubjectDeletion() for multiple schema versions", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA_REVISED];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(false);
      confirmSchemaSubjectDeletionStub.resolves(true);
      withProgressStub.callsFake(async (options, task) => await task());

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithExactly(
        confirmSchemaSubjectDeletionStub,
        false,
        TEST_CCLOUD_SUBJECT,
        schemaGroup,
      );
      sinon.assert.notCalled(confirmSchemaVersionDeletionStub);
      sinon.assert.calledOnce(stubbedLoader.deleteSchemaSubject);
    });

    it("should call confirmSchemaVersionDeletion() for a single schema version", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(false);
      confirmSchemaVersionDeletionStub.resolves(true);
      withProgressStub.callsFake(async (options, task) => await task());

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithExactly(
        confirmSchemaVersionDeletionStub,
        false,
        TEST_CCLOUD_SCHEMA,
        schemaGroup,
      );
      sinon.assert.notCalled(confirmSchemaSubjectDeletionStub);
      sinon.assert.calledOnce(stubbedLoader.deleteSchemaSubject);
    });

    it("should return early if the user cancels the deletion confirmation input box (version number of subject name)", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA_REVISED];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(false);
      confirmSchemaSubjectDeletionStub.resolves(false);

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnce(confirmSchemaSubjectDeletionStub);
      sinon.assert.notCalled(stubbedLoader.deleteSchemaSubject);
    });

    it("should soft-delete a schema subject after confirmation", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA_REVISED];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(false);
      confirmSchemaSubjectDeletionStub.resolves(true);
      withProgressStub.callsFake(async (options, task) => await task());
      stubbedLoader.deleteSchemaSubject.resolves();

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithExactly(hardDeletionQuickPickStub, "Schema Subject");
      sinon.assert.calledOnceWithExactly(
        confirmSchemaSubjectDeletionStub,
        false,
        TEST_CCLOUD_SUBJECT,
        schemaGroup,
      );
      sinon.assert.notCalled(showHardDeleteWarningModalStub);
      sinon.assert.calledOnceWithExactly(
        stubbedLoader.deleteSchemaSubject,
        TEST_CCLOUD_SUBJECT,
        false,
      );
      sinon.assert.calledOnce(logUsageStub);
    });

    it("should hard-delete a schema subject after user confirmation and warning modal", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(true);
      confirmSchemaVersionDeletionStub.resolves(true);
      showHardDeleteWarningModalStub.resolves(true);
      withProgressStub.callsFake(async (options, task) => await task());
      stubbedLoader.deleteSchemaSubject.resolves();

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithExactly(hardDeletionQuickPickStub, "Schema Subject");
      sinon.assert.calledOnceWithExactly(showHardDeleteWarningModalStub, "schema subject");
      sinon.assert.calledOnceWithExactly(
        stubbedLoader.deleteSchemaSubject,
        TEST_CCLOUD_SUBJECT,
        true,
      );
      sinon.assert.calledOnce(logUsageStub);
    });

    it("should return early if user cancels the hard-delete warning modal", async function () {
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      stubbedLoader.getSchemasForSubject.resolves(schemaGroup);
      hardDeletionQuickPickStub.resolves(true);
      confirmSchemaVersionDeletionStub.resolves(true);
      showHardDeleteWarningModalStub.resolves(false);

      await schemas.deleteSchemaSubjectCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnce(showHardDeleteWarningModalStub);
      sinon.assert.notCalled(stubbedLoader.deleteSchemaSubject);
    });
  });

  describe("uploadSchemaForSubjectFromFileCommand()", function () {
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let uriQuickpickStub: sinon.SinonStub;

    beforeEach(function () {
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      uriQuickpickStub = sandbox.stub(uriQuickpicks, "uriQuickpick").resolves();
    });

    it("should return early if the passed argument is not a Subject", async function () {
      await schemas.uploadSchemaForSubjectFromFileCommand("not-subject" as any);

      sinon.assert.notCalled(stubbedLoader.getSchemaRegistryForEnvironmentId);
      sinon.assert.notCalled(uriQuickpickStub);
    });

    it("should call uploadSchemaFromFileCommand() with the schema registry and subject name", async function () {
      stubbedLoader.getSchemaRegistryForEnvironmentId.resolves(TEST_CCLOUD_SCHEMA_REGISTRY);

      await schemas.uploadSchemaForSubjectFromFileCommand(TEST_CCLOUD_SUBJECT);

      sinon.assert.calledOnceWithExactly(
        stubbedLoader.getSchemaRegistryForEnvironmentId,
        TEST_CCLOUD_SUBJECT.environmentId,
      );
      // only check that we didn't exit from uploadSchemaFromFileCommand early,
      // since the tests for the uploadSchemaFromFileCommand() function already cover the rest of
      // the logic
      sinon.assert.calledOnce(uriQuickpickStub);
    });
  });

  describe("uploadSchemaFromFileCommand()", function () {
    let uriQuickpickStub: sinon.SinonStub;
    let documentHasErrorsStub: sinon.SinonStub;
    let getEditorOrFileContentsStub: sinon.SinonStub;
    let determineSchemaTypeStub: sinon.SinonStub;
    let chooseSubjectStub: sinon.SinonStub;
    let uploadSchemaStub: sinon.SinonStub;

    const fakeUri = Uri.file("/path/to/schema.avsc");
    const fakeDocContent = { content: '{"type": "record"}', openDocument: null };

    beforeEach(function () {
      uriQuickpickStub = sandbox.stub(uriQuickpicks, "uriQuickpick");
      documentHasErrorsStub = sandbox.stub(schemaManagementUpload, "documentHasErrors");
      getEditorOrFileContentsStub = sandbox.stub(fileUtils, "getEditorOrFileContents");
      determineSchemaTypeStub = sandbox.stub(schemaManagementUpload, "determineSchemaType");
      chooseSubjectStub = sandbox.stub(schemaManagementUpload, "chooseSubject");
      uploadSchemaStub = sandbox.stub(schemaManagementUpload, "uploadSchema");
    });

    it("should return early if the user cancels the file/document quickpick", async function () {
      uriQuickpickStub.resolves(undefined);

      await uploadSchemaFromFileCommand(TEST_CCLOUD_SCHEMA_REGISTRY);

      sinon.assert.calledOnce(uriQuickpickStub);
      sinon.assert.notCalled(documentHasErrorsStub);
      sinon.assert.notCalled(getEditorOrFileContentsStub);
      sinon.assert.notCalled(determineSchemaTypeStub);
      sinon.assert.notCalled(chooseSubjectStub);
      sinon.assert.notCalled(uploadSchemaStub);
    });

    it("should return early if the schema document has error diagnostics", async function () {
      uriQuickpickStub.resolves(fakeUri);
      documentHasErrorsStub.resolves(true);

      await uploadSchemaFromFileCommand(TEST_CCLOUD_SCHEMA_REGISTRY);

      sinon.assert.calledOnceWithExactly(documentHasErrorsStub, fakeUri);
      sinon.assert.notCalled(getEditorOrFileContentsStub);
      sinon.assert.notCalled(determineSchemaTypeStub);
      sinon.assert.notCalled(chooseSubjectStub);
      sinon.assert.notCalled(uploadSchemaStub);
    });

    it("should return early if schema type cannot be determined", async function () {
      uriQuickpickStub.resolves(fakeUri);
      documentHasErrorsStub.resolves(false);
      getEditorOrFileContentsStub.resolves(fakeDocContent);
      determineSchemaTypeStub.resolves(undefined);

      await uploadSchemaFromFileCommand(TEST_CCLOUD_SCHEMA_REGISTRY);

      sinon.assert.calledOnceWithExactly(determineSchemaTypeStub, fakeUri, undefined);
      sinon.assert.notCalled(chooseSubjectStub);
      sinon.assert.notCalled(uploadSchemaStub);
    });

    it("should upload a schema from a file successfully", async function () {
      uriQuickpickStub.resolves(fakeUri);
      documentHasErrorsStub.resolves(false);
      getEditorOrFileContentsStub.resolves(fakeDocContent);
      determineSchemaTypeStub.resolves(SchemaType.Avro);
      chooseSubjectStub.resolves("test-subject");
      uploadSchemaStub.resolves();

      await uploadSchemaFromFileCommand(TEST_CCLOUD_SCHEMA_REGISTRY, "test-subject");

      sinon.assert.calledOnce(uriQuickpickStub);
      sinon.assert.calledOnceWithExactly(documentHasErrorsStub, fakeUri);
      sinon.assert.calledOnceWithExactly(getEditorOrFileContentsStub, fakeUri);
      sinon.assert.calledOnceWithExactly(determineSchemaTypeStub, fakeUri, undefined);
      sinon.assert.calledOnceWithExactly(
        uploadSchemaStub,
        TEST_CCLOUD_SCHEMA_REGISTRY,
        "test-subject",
        SchemaType.Avro,
        fakeDocContent.content,
      );
    });

    it("should exit early if no subject is provided and the user exits chooseSubject early", async function () {
      uriQuickpickStub.resolves(fakeUri);
      documentHasErrorsStub.resolves(false);
      getEditorOrFileContentsStub.resolves(fakeDocContent);
      determineSchemaTypeStub.resolves(SchemaType.Avro);
      chooseSubjectStub.resolves(undefined);

      await uploadSchemaFromFileCommand(TEST_CCLOUD_SCHEMA_REGISTRY);

      sinon.assert.calledOnceWithExactly(chooseSubjectStub, TEST_CCLOUD_SCHEMA_REGISTRY);
      sinon.assert.notCalled(uploadSchemaStub);
    });

    it("should upload a schema from a file without a specified subject", async function () {
      uriQuickpickStub.resolves(fakeUri);
      documentHasErrorsStub.resolves(false);
      getEditorOrFileContentsStub.resolves(fakeDocContent);
      determineSchemaTypeStub.resolves(SchemaType.Avro);
      chooseSubjectStub.resolves("test-subject");

      await uploadSchemaFromFileCommand(TEST_CCLOUD_SCHEMA_REGISTRY);

      sinon.assert.calledOnceWithExactly(chooseSubjectStub, TEST_CCLOUD_SCHEMA_REGISTRY);
      sinon.assert.calledOnceWithExactly(
        uploadSchemaStub,
        TEST_CCLOUD_SCHEMA_REGISTRY,
        "test-subject",
        SchemaType.Avro,
        fakeDocContent.content,
      );
    });
  });
});

import * as assert from "assert";
import * as sinon from "sinon";
import { InputBoxValidationSeverity, window } from "vscode";

import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SUBJECT,
  TEST_LOCAL_SCHEMA,
} from "../../../../tests/unit/testResources";
import { Schema } from "../../../models/schema";
import {
  confirmSchemaSubjectDeletion,
  confirmSchemaVersionDeletion,
  getDeleteSchemaSubjectPrompt,
  getDeleteSchemaVersionPrompt,
  getSchemaDeletionValidatorAndPlaceholder,
  getSubjectDeletionValidatorAndPlaceholder,
  hardDeletionQuickPick,
  showHardDeleteWarningModal,
} from "./deletion";

describe("commands/utils/schemaManagement/deletion.ts", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("getDeleteSchemaVersionPrompt()", function () {
    it("should handle a single schema version", async function () {
      const schemaGroup = [TEST_LOCAL_SCHEMA];

      for (const hardDeletion of [true, false]) {
        const prompt = await getDeleteSchemaVersionPrompt(
          hardDeletion,
          TEST_LOCAL_SCHEMA,
          schemaGroup,
        );
        const expectedPrompt = `Are you sure you want to ${hardDeletion ? "hard" : "soft"} delete the only version of subject ${TEST_LOCAL_SCHEMA.subject}?`;
        assert.strictEqual(prompt, expectedPrompt);
      }
    });

    it("should handle the latest version of multiple versions", async function () {
      const toDelete: Schema = Schema.create({ ...TEST_LOCAL_SCHEMA, version: 2 });
      const schemaGroup = [toDelete, Schema.create({ ...TEST_LOCAL_SCHEMA, version: 1 })];

      for (const hardDeletion of [true, false]) {
        const prompt = await getDeleteSchemaVersionPrompt(hardDeletion, toDelete, schemaGroup);
        const expectedPrompt = `Are you sure you want to ${hardDeletion ? "hard" : "soft"} delete the latest version of subject ${TEST_LOCAL_SCHEMA.subject}? Version 1 will become the latest.`;
        assert.strictEqual(prompt, expectedPrompt);
      }
    });

    it("should handle an earlier (not latest) version of multiple versions", async function () {
      const toDelete: Schema = Schema.create({ ...TEST_LOCAL_SCHEMA, version: 2 });
      const schemaGroup = [Schema.create({ ...TEST_LOCAL_SCHEMA, version: 3 }), toDelete];

      for (const hardDeletion of [true, false]) {
        const prompt = await getDeleteSchemaVersionPrompt(hardDeletion, toDelete, schemaGroup);
        const expectedPrompt = `Are you sure you want to ${hardDeletion ? "hard" : "soft"} delete version ${toDelete.version} of subject ${TEST_LOCAL_SCHEMA.subject}?`;
        assert.strictEqual(prompt, expectedPrompt);
      }
    });
  });

  describe("getDeleteSchemaSubjectPrompt()", function () {
    it("should handle a single schema version", function () {
      // single version.
      const subject = TEST_CCLOUD_SUBJECT;
      for (const hardDeletion of [true, false]) {
        const prompt = getDeleteSchemaSubjectPrompt(hardDeletion, subject, 1);
        const expectedPrompt = `Are you sure you want to ${hardDeletion ? "hard" : "soft"} delete subject "${subject.name}" and its single schema version?`;
        assert.strictEqual(prompt, expectedPrompt);
      }
    });

    it("should handle multiple schema versions", function () {
      // multiple versions.
      const subject = TEST_CCLOUD_SUBJECT;
      for (const hardDeletion of [true, false]) {
        const prompt = getDeleteSchemaSubjectPrompt(hardDeletion, subject, 2);
        const expectedPrompt = `Are you sure you want to ${hardDeletion ? "hard" : "soft"} delete subject "${subject.name}" and all 2 schema versions?`;
        assert.strictEqual(prompt, expectedPrompt);
      }
    });
  });

  describe("getSchemaDeletionValidatorAndPlaceholder()", function () {
    it("deletion validator", function () {
      const version = 3;

      const [validator, prompt] = getSchemaDeletionValidatorAndPlaceholder(version);
      assert.strictEqual(prompt, `Enter "v${version}" to confirm, escape to cancel.`);
      assert.strictEqual(validator(`v${version}`), undefined);

      const invalid = validator(`v${version + 1}`)!;
      assert.deepStrictEqual(invalid, {
        message: `Enter "v${version}" to confirm deletion, escape to cancel.`,
        severity: InputBoxValidationSeverity.Error,
      });

      const empty = validator("")!;
      assert.deepStrictEqual(empty, {
        message: `Enter "v${version}" to confirm deletion, escape to cancel.`,
        severity: InputBoxValidationSeverity.Error,
      });
    });
  });

  describe("getSubjectDeletionValidatorAndPlaceholder()", function () {
    it("deletion validator", function () {
      const subject = TEST_CCLOUD_SUBJECT;

      const [validator, prompt] = getSubjectDeletionValidatorAndPlaceholder(subject);

      assert.strictEqual(prompt, `Enter "${subject.name}" to confirm, escape to cancel.`);
      assert.strictEqual(validator(`${subject.name}`), undefined);

      const invalid = validator(`${subject.name}Extra`)!;
      assert.deepStrictEqual(invalid, {
        message: `Enter "${subject.name}" to confirm deletion, escape to cancel.`,
        severity: InputBoxValidationSeverity.Warning,
      });

      const empty = validator("")!;
      assert.deepStrictEqual(empty, {
        message: `Enter "${subject.name}" to confirm deletion, escape to cancel.`,
        severity: InputBoxValidationSeverity.Warning,
      });
    });
  });

  describe("showHardDeleteWarningModal()", function () {
    let showWarningMessageStub: sinon.SinonStub;

    beforeEach(function () {
      showWarningMessageStub = sandbox.stub(window, "showWarningMessage");
    });

    it("should return true when the user selects 'Yes, Hard Delete'", async function () {
      showWarningMessageStub.resolves("Yes, Hard Delete");

      const result = await showHardDeleteWarningModal("schema");

      assert.strictEqual(result, true);
      sinon.assert.calledOnceWithExactly(
        showWarningMessageStub,
        "WARNING: Hard deleting this schema is irreversible and may cause data loss. Are you sure you want to continue?",
        { modal: true },
        "Yes, Hard Delete",
      );
    });

    it("should return false when the user cancels/dismisses the confirmation modal", async function () {
      showWarningMessageStub.resolves(undefined);

      const result = await showHardDeleteWarningModal("subject");

      assert.strictEqual(result, false);
      sinon.assert.calledOnceWithExactly(
        showWarningMessageStub,
        "WARNING: Hard deleting this subject is irreversible and may cause data loss. Are you sure you want to continue?",
        { modal: true },
        "Yes, Hard Delete",
      );
    });
  });

  describe("hardDeletionQuickPick()", function () {
    let showQuickPickStub: sinon.SinonStub;

    beforeEach(function () {
      showQuickPickStub = sandbox.stub(window, "showQuickPick");
    });

    it("returns true for hard delete", async function () {
      showQuickPickStub.resolves({ label: "Hard Delete" });
      const result = await hardDeletionQuickPick("foo");
      assert.strictEqual(result, true);
    });

    it("returns false for soft delete", async function () {
      showQuickPickStub.resolves({ label: "Soft Delete" });
      const result = await hardDeletionQuickPick("foo");
      assert.strictEqual(result, false);
    });

    it("returns undefined for cancellation", async function () {
      showQuickPickStub.resolves(undefined);
      const result = await hardDeletionQuickPick("foo");
      assert.strictEqual(result, undefined);
    });
  });

  describe("confirmSchemaVersionDeletion()", function () {
    let showInputBoxStub: sinon.SinonStub;

    beforeEach(function () {
      showInputBoxStub = sandbox.stub(window, "showInputBox");
    });

    it("returns true for hard delete confirmation", async function () {
      const hardDeletion = true;
      const schemaGroup = [TEST_LOCAL_SCHEMA];
      const schema = TEST_LOCAL_SCHEMA;

      showInputBoxStub.resolves(`v${TEST_LOCAL_SCHEMA.version}`);

      const result = await confirmSchemaVersionDeletion(hardDeletion, schema, schemaGroup);
      assert.strictEqual(result, true);
    });

    it("returns undefined if skipped", async function () {
      const hardDeletion = true;
      const schemaGroup = [TEST_LOCAL_SCHEMA];
      const schema = TEST_LOCAL_SCHEMA;

      showInputBoxStub.resolves(undefined);

      const result = await confirmSchemaVersionDeletion(hardDeletion, schema, schemaGroup);
      assert.strictEqual(result, undefined);
    });
  });

  describe("confirmSchemaSubjectDeletion()", function () {
    let showInputBoxStub: sinon.SinonStub;

    beforeEach(function () {
      showInputBoxStub = sandbox.stub(window, "showInputBox");
    });

    it("returns true for hard delete confirmation", async function () {
      const hardDeletion = true;
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      const subject = TEST_CCLOUD_SUBJECT;

      showInputBoxStub.resolves(`hard ${subject.name} ${schemaGroup.length}`);

      const result = await confirmSchemaSubjectDeletion(hardDeletion, subject, schemaGroup);
      assert.strictEqual(result, true);
    });

    it("returns true for soft delete confirmation", async function () {
      const hardDeletion = false;
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      const subject = TEST_CCLOUD_SUBJECT;

      showInputBoxStub.resolves(`${subject.name}`);

      const result = await confirmSchemaSubjectDeletion(hardDeletion, subject, schemaGroup);
      assert.strictEqual(result, true);
    });

    it("returns undefined if skipped.", async function () {
      const hardDeletion = true;
      const schemaGroup = [TEST_CCLOUD_SCHEMA];
      const subject = TEST_CCLOUD_SUBJECT;

      showInputBoxStub.resolves(undefined);

      const result = await confirmSchemaSubjectDeletion(hardDeletion, subject, schemaGroup);
      assert.strictEqual(result, undefined);
    });
  });
});

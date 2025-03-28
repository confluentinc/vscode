import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";

import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SUBJECT,
  TEST_LOCAL_SCHEMA,
} from "../../../tests/unit/testResources";
import { Schema } from "../../models/schema";
import {
  confirmSchemaSubjectDeletion,
  confirmSchemaVersionDeletion,
  getDeleteSchemaSubjectPrompt,
  getDeleteSchemaVersionPrompt,
  getSchemaDeletionValidatorAndPlaceholder,
  getSubjectDeletionValidatorAndPlaceholder,
  hardDeletionQuickPick,
} from "./schemas";

describe("commands/schemas/utils/schemas.ts", function () {
  describe("getDeleteSchemaVersionPrompt()", function () {
    it("single schema version tests", async function () {
      // single version.
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

    it("latest of multiple versions tests", async function () {
      // multiple versions, deleting latest version

      const toDelete: Schema = Schema.create({ ...TEST_LOCAL_SCHEMA, version: 2 });
      const schemaGroup = [toDelete, Schema.create({ ...TEST_LOCAL_SCHEMA, version: 1 })];

      for (const hardDeletion of [true, false]) {
        const prompt = await getDeleteSchemaVersionPrompt(hardDeletion, toDelete, schemaGroup);
        const expectedPrompt = `Are you sure you want to ${hardDeletion ? "hard" : "soft"} delete the latest version of subject ${TEST_LOCAL_SCHEMA.subject}? Version 1 will become the latest.`;
        assert.strictEqual(prompt, expectedPrompt);
      }
    });

    it("not latest of multiple versions tests", async function () {
      // multiple versions, deleting a non-latest version

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
    it("single schema version tests", function () {
      // single version.
      const subject = TEST_CCLOUD_SUBJECT;
      for (const hardDeletion of [true, false]) {
        const prompt = getDeleteSchemaSubjectPrompt(hardDeletion, subject, 1);
        const expectedPrompt = `Are you sure you want to ${hardDeletion ? "hard" : "soft"} delete subject "${subject.name}" and its single schema version?`;
        assert.strictEqual(prompt, expectedPrompt);
      }
    });

    it("multiple schema version tests", function () {
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
    it("hard deletion validator", function () {
      const version = 3;
      const hardDeletion = true;
      const [validator, prompt] = getSchemaDeletionValidatorAndPlaceholder(version, hardDeletion);

      assert.strictEqual(prompt, `Enter "hard v${version}" to confirm, escape to cancel.`);
      assert.strictEqual(validator(`hard v${version}`), undefined);
      assert.strictEqual(
        validator(`hard v${version + 1}`)!.message,
        `Enter "hard v${version}" to confirm hard deletion, escape to cancel.`,
      );
      assert.strictEqual(
        validator("")!.message,
        `Enter "hard v${version}" to confirm hard deletion, escape to cancel.`,
      );
    });

    it("soft deletion validator", function () {
      const version = 3;
      const hardDeletion = false;
      const [validator, prompt] = getSchemaDeletionValidatorAndPlaceholder(version, hardDeletion);

      assert.strictEqual(prompt, `Enter "v${version}" to confirm, escape to cancel.`);
      assert.strictEqual(validator(`v${version}`), undefined);
      assert.strictEqual(
        validator(`v${version + 1}`)!.message,
        `Enter "v${version}" to confirm, escape to cancel.`,
      );
      assert.strictEqual(
        validator("")!.message,
        `Enter "v${version}" to confirm, escape to cancel.`,
      );
    });
  });

  describe("getSubjectDeletionValidatorAndPlaceholder()", function () {
    it("hard deletion validator", function () {
      const subject = TEST_CCLOUD_SUBJECT;
      const versionCount = 5;
      const hardDeletion = true;
      const [validator, prompt] = getSubjectDeletionValidatorAndPlaceholder(
        subject,
        versionCount,
        hardDeletion,
      );

      assert.strictEqual(
        prompt,
        `Enter "hard ${subject.name} ${versionCount}" to confirm, escape to cancel.`,
      );
      assert.strictEqual(validator(`hard ${subject.name} ${versionCount}`), undefined);
      assert.strictEqual(
        validator(`hard ${subject.name} ${versionCount + 1}`)!.message,
        `Enter "hard ${subject.name} ${versionCount}" to confirm hard deletion, escape to cancel.`,
      );
      assert.strictEqual(
        validator("")!.message,
        `Enter "hard ${subject.name} ${versionCount}" to confirm hard deletion, escape to cancel.`,
      );
    });

    it("soft deletion validator", function () {
      const subject = TEST_CCLOUD_SUBJECT;
      const versionCount = 5;
      const hardDeletion = false;
      const [validator, prompt] = getSubjectDeletionValidatorAndPlaceholder(
        subject,
        versionCount,
        hardDeletion,
      );

      assert.strictEqual(prompt, `Enter "${subject.name}" to confirm, escape to cancel.`);
      assert.strictEqual(validator(`${subject.name}`), undefined);
      assert.strictEqual(
        validator(`${subject.name}Extra`)!.message,
        `Enter "${subject.name}" to confirm, escape to cancel.`,
      );
      assert.strictEqual(
        validator("")!.message,
        `Enter "${subject.name}" to confirm, escape to cancel.`,
      );
    });
  });

  describe("hardDeletionQuickPick()", function () {
    let sandbox: sinon.SinonSandbox;
    let showQuickPickStub: sinon.SinonStub;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
    });

    afterEach(function () {
      sandbox.restore();
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
    let sandbox: sinon.SinonSandbox;
    let showInputBoxStub: sinon.SinonStub;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("returns true for hard delete confirmation", async function () {
      const hardDeletion = true;
      const schemaGroup = [TEST_LOCAL_SCHEMA];
      const schema = TEST_LOCAL_SCHEMA;

      showInputBoxStub.resolves(`hard v${TEST_LOCAL_SCHEMA.version}`);

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
    let sandbox: sinon.SinonSandbox;
    let showInputBoxStub: sinon.SinonStub;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
    });

    afterEach(function () {
      sandbox.restore();
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

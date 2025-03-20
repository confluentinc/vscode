import * as assert from "assert";

import { TEST_LOCAL_SCHEMA } from "../../../tests/unit/testResources";
import { Schema } from "../../models/schema";
import { getDeleteSchemaVersionPrompt, getSchemaDeletionValidatorAndPlaceholder } from "./schemas";

describe("commands/utils/schemas.ts getDeleteSchemaVersionPrompt()", function () {
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

describe("commands/utils/schemas.ts getSchemaDeletionValidatorAndPlaceholder()", function () {
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
    assert.strictEqual(validator("")!.message, `Enter "v${version}" to confirm, escape to cancel.`);
  });
});

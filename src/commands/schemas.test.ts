import * as assert from "assert";
import sinon from "sinon";
import { commands, env } from "vscode";
import {
  TEST_CCLOUD_SCHEMA_REVISED,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
} from "../../tests/unit/testResources";
import { Subject } from "../models/schema";
import { copySubjectCommand, diffLatestSchemasCommand } from "./schemas";

describe("commands/schemas.ts copySubjectCommand()", () => {
  let _originalClipboardContents: string | undefined;

  beforeEach(async () => {
    _originalClipboardContents = await env.clipboard.readText();
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
  });
});

describe("commands/schemas.ts diffLatestSchemasCommand()", function () {
  let sandbox: sinon.SinonSandbox;
  let executeCommandStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    executeCommandStub = sandbox.stub(commands, "executeCommand");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should execute the correct commands when invoked on a proper schema group", async () => {
    // directly call what command "confluent.schemas.diffMostRecentVersions" would call (made harder to invoke
    // because it's a command, and we've stubbed out vscode command execution)
    await diffLatestSchemasCommand(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
    assert.ok(
      executeCommandStub.calledWith(
        "confluent.diff.selectForCompare",
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![1],
      ),
    );
    assert.ok(
      executeCommandStub.calledWith(
        "confluent.diff.compareWithSelected",
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![0],
      ),
    );
  });

  it("should not execute commands if there are fewer than two schemas in the group", async () => {
    // (this should not happen if the schema group was generated correctly, but diffLatestSchemasCommand guards against it)
    const schemaGroup = new Subject(
      TEST_CCLOUD_SUBJECT.name,
      TEST_CCLOUD_SUBJECT.connectionId,
      TEST_CCLOUD_SUBJECT.environmentId,
      TEST_CCLOUD_SUBJECT.schemaRegistryId,
      [TEST_CCLOUD_SCHEMA_REVISED],
    );

    await diffLatestSchemasCommand(schemaGroup);
    assert.ok(executeCommandStub.notCalled);
  });
});

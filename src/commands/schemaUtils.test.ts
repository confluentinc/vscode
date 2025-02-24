import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { ResourceLoader } from "../loaders";
import { ContainerTreeItem } from "../models/main";
import { determineLatestSchema, determineSubject, SubjectishArgument } from "./schemaUtils";

import { TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SUBJECT } from "../../tests/unit/testResources";

describe("commands::schemaUtils determineSubject tests", () => {
  it("should return Subject when given a Subject", () => {
    const subject = TEST_CCLOUD_SUBJECT;
    const result = determineSubject("test", subject);
    assert.strictEqual(result, subject);
  });

  it("should extract Subject from ContainerTreeItem<Schema>", () => {
    const schema = TEST_CCLOUD_SCHEMA;
    const container = new ContainerTreeItem("test", vscode.TreeItemCollapsibleState.Collapsed, [
      schema,
    ]);
    const result = determineSubject("test", container);
    assert.equal(result.name, schema.subject);
  });

  it("should throw error for invalid argument type", () => {
    assert.throws(
      () => determineSubject("test", {} as SubjectishArgument),
      /called with invalid argument type/,
    );
  });
});

describe("commands::schemaUtils determineLatestSchema tests", () => {
  let sandbox: sinon.SinonSandbox;
  let loaderStub: sinon.SinonStubbedInstance<ResourceLoader>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderStub = sandbox.createStubInstance(ResourceLoader);
    sandbox.stub(ResourceLoader, "getInstance").returns(loaderStub);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return first Schema from ContainerTreeItem", async () => {
    const schema = TEST_CCLOUD_SCHEMA;
    const container = new ContainerTreeItem("test", vscode.TreeItemCollapsibleState.Collapsed, [
      schema,
    ]);

    const result = await determineLatestSchema("test", container);
    assert.strictEqual(result, schema);
  });

  it("should fetch and return latest Schema when given Subject", async () => {
    const expectedSchema = TEST_CCLOUD_SCHEMA;
    const subject = TEST_CCLOUD_SUBJECT;

    loaderStub.getSchemaSubjectGroup.resolves([expectedSchema]);

    const result = await determineLatestSchema("test", subject);

    assert.strictEqual(result, expectedSchema);
  });

  it("should throw error for invalid argument type", async () => {
    await assert.rejects(
      async () => await determineLatestSchema("test", {} as SubjectishArgument),
      /called with invalid argument type/,
    );
  });
});

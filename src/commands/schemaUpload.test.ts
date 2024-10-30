import * as assert from "assert";
import * as vscode from "vscode";
import { determineSchemaType } from "./schemaUpload";

describe("commands/schemaUpload.ts determineSchemaType tests", function () {
  it("determineSchemaType successfully determines schema type from file URI", () => {
    // for pair of (file extension, expected schema type) from array of string pairs ...
    for (const [fileExtension, expectedSchemaType] of [
      ["avsc", "AVRO"],
      ["json", "JSON"],
      ["proto", "PROTOBUF"],
    ]) {
      const fileUri = vscode.Uri.file(`some-file.${fileExtension}`);
      const schemaType = determineSchemaType(fileUri, null);
      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${fileExtension}, got ${schemaType} instead`,
      );
    }
  });

  it("determineSchemaType successfully determines schema type from language ID", () => {
    // for pair of (language ID, expected schema type) from array of string pairs ...
    for (const [languageId, expectedSchemaType] of [
      ["avroavsc", "AVRO"],
      ["json", "JSON"],
      ["proto", "PROTOBUF"],
    ]) {
      const schemaType = determineSchemaType(null, languageId);
      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${languageId}, got ${schemaType} instead`,
      );
    }
  });

  it("determineSchemaType successfully determines schema type from language ID when file URI is also provided", () => {
    for (const [fileExtension, languageId, expectedSchemaType] of [
      ["avsc", "avroavsc", "AVRO"],
      ["json", "json", "JSON"],
      ["proto", "proto", "PROTOBUF"],
    ]) {
      const fileUri = vscode.Uri.file(`some-file.${fileExtension}`);
      const schemaType = determineSchemaType(fileUri, languageId);
      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${fileExtension} and ${languageId}, got ${schemaType} instead`,
      );
    }
  });

  it("determineSchemaType should raise Error when neither file URI nor languageID is provided", () => {
    assert.throws(() => {
      determineSchemaType(null, null);
    }, /Must call with either a file or document/);
  });
});

import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaType } from "../models/schema";
import {
  determineSchemaType,
  extractDetail,
  parseConflictMessage,
  schemaFromString,
  schemaRegistrationMessage,
} from "./schemaUpload";

import { TEST_CCLOUD_SCHEMA } from "../../tests/unit/testResources/schema";

describe("commands/schemaUpload.ts determineSchemaType tests", function () {
  it("determineSchemaType successfully determines schema type from file URI", async () => {
    // for pair of (file extension, expected schema type) from array of string pairs ...
    for (const [fileExtension, expectedSchemaType] of [
      ["avsc", "AVRO"],
      ["json", "JSON"],
      ["proto", "PROTOBUF"],
    ]) {
      const fileUri = vscode.Uri.file(`some-file.${fileExtension}`);
      const schemaType = await determineSchemaType(fileUri, null);
      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${fileExtension}, got ${schemaType} instead`,
      );
    }
  });

  it("determineSchemaType successfully determines schema type from language ID", async () => {
    // for pair of (language ID, expected schema type) from array of string pairs ...
    for (const [languageId, expectedSchemaType] of [
      ["avroavsc", "AVRO"],
      ["json", "JSON"],
      ["proto", "PROTOBUF"],
    ]) {
      const schemaType = await determineSchemaType(null, languageId);
      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${languageId}, got ${schemaType} instead`,
      );
    }
  });

  it("determineSchemaType successfully determines schema type from language ID when file URI is also provided", async () => {
    for (const [fileExtension, languageId, expectedSchemaType] of [
      ["avsc", "avroavsc", "AVRO"],
      ["json", "json", "JSON"],
      ["proto", "proto", "PROTOBUF"],
    ]) {
      const fileUri = vscode.Uri.file(`some-file.${fileExtension}`);
      const schemaType = await determineSchemaType(fileUri, languageId);
      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${fileExtension} and ${languageId}, got ${schemaType} instead`,
      );
    }
  });

  it("determineSchemaType should return undefined when neither file URI nor languageID is provided", async () => {
    const result = await determineSchemaType(null, null);
    assert.strictEqual(result, undefined);
  });
});

describe("commands/schemaUpload.ts schemaRegistrationMessage tests", function () {
  it("new subject registration message is correct", () => {
    const subject = "MyTopic-value";
    const message = schemaRegistrationMessage(subject, undefined, 1);
    assert.equal(message, `Schema registered to new subject "${subject}"`);
  });

  it("existing subject registration message is correct", () => {
    const subject = "MyTopic-value";
    const oldVersion = 1;
    const newVersion = 2;
    const message = schemaRegistrationMessage(subject, oldVersion, newVersion);
    assert.strictEqual(
      message,
      `New version ${newVersion} registered to existing subject "${subject}"`,
    );
  });

  it("normalized to existing version message is correct when normalized to most recent version", () => {
    const subject = "MyTopic-value";
    const version = 1;
    const message = schemaRegistrationMessage(subject, version, version);
    assert.strictEqual(
      message,
      `Normalized to existing version ${version} for subject "${subject}"`,
    );
  });

  it("normalized to existing version message is correct when normalized to older version", () => {
    const subject = "MyTopic-value";
    const thisVersion = 1;
    const maxVersion = 2;
    const message = schemaRegistrationMessage(subject, maxVersion, thisVersion);
    assert.strictEqual(
      message,
      `Normalized to existing version ${thisVersion} for subject "${subject}"`,
    );
  });
});

describe("commands/schemaUpload.ts extractDetail tests", () => {
  for (const [instance, message, expectedResult] of [
    ["one details", 'blah blah details: "this is a test"', '"this is a test"'],
    ["no details", "blah blah", "blah blah"],
    ["multiple details", 'details: "one", details: "two"', '"two"'],
  ]) {
    it(`extractDetail successfully extracts detail from case ${instance}`, () => {
      const detail = extractDetail(message);
      assert.strictEqual(detail, expectedResult);
    });
  }
});

describe("commands/schemaUpload.ts parseConflictMessage tests", () => {
  for (const [instance, schemaType, message, expectedResult] of [
    [
      "Avro with embedded single quotes",
      SchemaType.Avro,
      "blah blah details: \"blah description:'yo 'mama' is a test', additionalInfo: \"blah\"",
      "yo 'mama' is a test",
    ],
    [
      "Avro without embedded single quotes",
      SchemaType.Avro,
      'blah blah details: "blah description:\'this is a test\', additionalInfo: "blah"',
      "this is a test",
    ],
    [
      "Protobuf",
      SchemaType.Protobuf,
      'blah blah details: "blah {description:"this is a test"}, ...',
      "this is a test",
    ],
    [
      "JSON with ending single quote",
      SchemaType.Json,
      'blah blah details: "blah {description:"this is a test\'}, ...',
      "this is a test",
    ],
    [
      "JSON with ending double quote",
      SchemaType.Json,
      'blah blah details: "blah {description:"this is a test"}, ...',
      "this is a test",
    ],
    [
      "Unexpected format, should return all after details",
      SchemaType.Avro,
      "blah blah details: stuff goes here",
      "stuff goes here",
    ],
  ]) {
    it(`parseConflictMessage successfully extracts detail from case ${instance}`, () => {
      const detail = parseConflictMessage(schemaType as SchemaType, message);
      assert.strictEqual(detail, expectedResult);
    });
  }
});

describe("schemaFromString tests", () => {
  it("Should return a schema object with the correct values", () => {
    const schemaString = JSON.stringify(TEST_CCLOUD_SCHEMA);
    const schema = schemaFromString(schemaString);
    assert.deepStrictEqual(schema, TEST_CCLOUD_SCHEMA);
  });

  it("should return undefined when the schema string is invalid json", () => {
    const badSchemaString = "invalid schema string";
    const schema = schemaFromString(badSchemaString);
    assert.strictEqual(schema, undefined);
  });

  it("should return undefined when the schema string is json but does not describe a schema", () => {
    const badSchemaString = '{"foo": "bar"}';
    const schema = schemaFromString(badSchemaString);
    assert.strictEqual(schema, undefined);
  });
});

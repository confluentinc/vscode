import * as assert from "assert";
import * as vscode from "vscode";
import { SchemaType } from "../models/schema";
import {
  determineSchemaType,
  extractDetail,
  parseConflictMessage,
  schemaRegistrationMessage,
} from "./schemaUpload";

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

  it("normalized to existing version message is correct", () => {
    const subject = "MyTopic-value";
    const version = 1;
    const message = schemaRegistrationMessage(subject, version, version);
    assert.strictEqual(
      message,
      `Normalized to existing version ${version} for subject "${subject}"`,
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

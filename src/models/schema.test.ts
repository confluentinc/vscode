import * as assert from "assert";
import "mocha";
import * as vscode from "vscode";
import { TEST_CCLOUD_SCHEMA } from "../../tests/unit/testResources";
import { IconNames } from "../constants";
import { Schema, SchemaType, getSubjectIcon, subjectMatchesTopicName } from "./schema";

describe("Schema model methods", () => {
  it(".matchesTopicName() success / fail tests", () => {
    type SchemaProperties = [string, string, boolean];
    const testSchemas: SchemaProperties[] = [
      // schemas named in TopicNameStrategy format
      ["test-topic-value", "test-topic", true], // matching on TopicNameStrategy for value schemas
      ["test-topic-key", "test-topic", true], // matching on TopicNameStrategy for key schemas
      ["another-topic-key", "test-topic", false], // not matching on TopicNameStrategy
      ["test-topic-with-suffix-value", "test-topic", false], // not matching on TopicNameStrategy value
      ["test-topic-with-suffix-key", "test-topic", false], // not matching on TopicNameStrategy key

      // schemas named with TopicRecordNameStrategy format
      ["test-topic-MyRecordSchema", "test-topic", true], // matching on TopicRecordNameStrategy (value is implied)
      ["test-topic-MyOtherRecordSchema", "test-topic", true], // say, a different record schema for same topic
      ["test-topic-MyRecordSchema", "test-topic-other-topic", false], // not matching on TopicRecordNameStrategy
      ["test-topic-MyRecordSchema", "test-topic-MyRecordSchema", false], // isn't TopicRecordNameStrategy, but exact match, which is nothing.
    ];
    for (const [subject, topic, expected] of testSchemas) {
      // Test subjectMatchesTopicName() directly, the underlying implementation.
      assert.equal(
        subjectMatchesTopicName(subject, topic),
        expected,
        `subject: ${subject}, topic: ${topic}`,
      );

      // and also the passthrough (legacy, will probably end up being removed) method on the Schema class.
      const schema = Schema.create({ ...TEST_CCLOUD_SCHEMA, subject });
      assert.equal(
        schema.matchesTopicName(topic),
        expected,
        `subject: ${subject}, topic: ${topic}`,
      );
    }
  });

  it(".fileExtension() should return the correct file extension for type=AVRO schemas", () => {
    const schema = TEST_CCLOUD_SCHEMA.copy({
      type: SchemaType.Avro,
    });
    assert.equal(schema.fileExtension(), "avsc");
  });

  it(".fileExtension() should return the correct file extension for type=JSON schemas", () => {
    const schema = TEST_CCLOUD_SCHEMA.copy({
      type: SchemaType.Json,
    });
    assert.equal(schema.fileExtension(), "json");
  });

  it(".fileExtension() should return the correct file extension for type=PROTOBUF schemas", () => {
    const schema = TEST_CCLOUD_SCHEMA.copy({
      type: SchemaType.Protobuf,
    });
    assert.equal(schema.fileExtension(), "proto");
  });

  it(".filename() should return the correct file name", () => {
    const schema = TEST_CCLOUD_SCHEMA.copy({
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      subject: "test-topic",
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      id: "100123",
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      version: 1,
    });
    assert.equal(schema.fileName(), "test-topic.100123.v1.confluent.avsc");
  });
});

describe("getSubjectIcon", () => {
  for (const [subject, expected] of [
    ["test-key", IconNames.KEY_SUBJECT],
    ["test-value", IconNames.VALUE_SUBJECT],
    ["test-other", IconNames.OTHER_SUBJECT],
  ]) {
    it(`should return ${expected} icon for subject '${subject}' when called w/o errOnValueSubject`, () => {
      const icon = getSubjectIcon(subject);
      assert.deepEqual(icon, new vscode.ThemeIcon(expected));
    });
  }

  for (const [subject, errOnValueSubject, expected] of [
    ["test-key", true, IconNames.KEY_SUBJECT],
    ["test-value", true, IconNames.VALUE_SUBJECT],
    // explicit false should return the "other" icon
    ["test-other", false, IconNames.OTHER_SUBJECT],
    // explicit true should prefer the "value" icon over the "other" icon
    ["test-other", true, IconNames.VALUE_SUBJECT],
  ]) {
    it(`should return ${expected} icon for subject '${subject}' when called with errOnValueSubject`, () => {
      const icon = getSubjectIcon(subject as string, errOnValueSubject as boolean);
      assert.deepEqual(icon, new vscode.ThemeIcon(expected as IconNames));
    });
  }
});

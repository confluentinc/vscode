import * as assert from "assert";
import "mocha";
import * as vscode from "vscode";
import { TEST_CCLOUD_SCHEMA, TEST_LOCAL_SCHEMA } from "../../tests/unit/testResources";
import { IconNames } from "../constants";
import {
  Schema,
  SchemaTreeItem,
  SchemaType,
  generateSchemaSubjectGroups,
  getLanguageTypes,
  getSubjectIcon,
  subjectMatchesTopicName,
} from "./schema";

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

  it("nextVersionDraftFileName() should return the correct file name", () => {
    const schema = TEST_CCLOUD_SCHEMA.copy({
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      subject: "test-topicValue",
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      version: 1,
    });

    // 0 as draft number means simpler filename.
    assert.equal(schema.nextVersionDraftFileName(0), `test-topicValue.v2-draft.confluent.avsc`);
    assert.equal(schema.nextVersionDraftFileName(1), `test-topicValue.v2-draft-1.confluent.avsc`);
  });

  it("ccloudUrl getter should return the correct URL", () => {
    // ccloud schemas have a ccloud url.
    assert.equal(
      TEST_CCLOUD_SCHEMA.ccloudUrl,
      `https://confluent.cloud/environments/${TEST_CCLOUD_SCHEMA.environmentId}/stream-governance/schema-registry/data-contracts/${TEST_CCLOUD_SCHEMA.subject}`,
    );

    // Non-ccloud schemas do not
    assert.equal(TEST_LOCAL_SCHEMA.ccloudUrl, "");
  });
});

// TODO: update the `as Schema[]` sections below once ContainerTreeItem<T> is implemented
describe("Schema helper functions", () => {
  const valueSubject = "test-topic-value";
  const keySubject = "test-topic-key";
  const otherSubject = "test-topic";
  const schemas: Schema[] = [
    Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: valueSubject,
      version: 1,
      type: SchemaType.Avro,
      id: "1",
    }),
    Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: valueSubject,
      version: 2,
      type: SchemaType.Avro,
      id: "2",
    }),
    Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: keySubject,
      version: 1,
      type: SchemaType.Protobuf,
      id: "3",
    }),
    Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: otherSubject,
      version: 1,
      type: SchemaType.Json,
      id: "4",
    }),
    Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: otherSubject,
      version: 3,
      type: SchemaType.Json,
      id: "5",
    }),
    Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: otherSubject,
      version: 2,
      type: SchemaType.Json,
      id: "6",
    }),
  ];

  it("generateSchemaSubjectGroups() should group schemas under a subject-labeled container item", () => {
    const groups = generateSchemaSubjectGroups(schemas);
    assert.equal(groups.length, 3, `should have three subject groups, got ${groups.length}`);

    const testTopicGroup = groups.find((group) => group.label === valueSubject);
    assert.ok(testTopicGroup);
    assert.equal(testTopicGroup.label, valueSubject);

    const anotherTopicGroup = groups.find((group) => group.label === keySubject);
    assert.ok(anotherTopicGroup);
    assert.equal(anotherTopicGroup.label, keySubject);

    const extraTopicGroup = groups.find((group) => group.label === otherSubject);
    assert.ok(extraTopicGroup);
    assert.equal(extraTopicGroup.label, otherSubject);
  });

  it("generateSchemaSubjectGroups() should contain the correct number of schemas as children", () => {
    const groups = generateSchemaSubjectGroups(schemas);

    const testTopicGroup = groups.find((group) => group.label === valueSubject);
    const testTopicSchemas = testTopicGroup!.children;
    assert.equal(testTopicSchemas.length, 2);

    const anotherTopicGroup = groups.find((group) => group.label === keySubject);
    const anotherTopicSchemas = anotherTopicGroup!.children;
    assert.equal(anotherTopicSchemas.length, 1);

    const extraTopicGroup = groups.find((group) => group.label === otherSubject);
    const extraTopicSchemas = extraTopicGroup!.children;
    assert.equal(extraTopicSchemas.length, 3);
  });

  it("generateSchemaSubjectGroups() should show the schema type and version count in the description", () => {
    const groups = generateSchemaSubjectGroups(schemas);

    const testTopicGroup = groups.find((group) => group.label === valueSubject);
    assert.equal(testTopicGroup?.description, "AVRO (2)");

    const anotherTopicGroup = groups.find((group) => group.label === keySubject);
    assert.equal(anotherTopicGroup?.description, "PROTOBUF (1)");

    const extraTopicGroup = groups.find((group) => group.label === otherSubject);
    assert.equal(extraTopicGroup?.description, "JSON (3)");
  });

  it("generateSchemaSubjectGroups() should sort subjects' schemas in version-descending order", () => {
    const groups = generateSchemaSubjectGroups(schemas);

    const testTopicGroup = groups.find((group) => group.label === valueSubject);
    const testTopicSchemas = testTopicGroup!.children;
    assert.equal(
      testTopicSchemas[0].version,
      2,
      `first version should be 2, got v${testTopicSchemas[0].version}`,
    );

    const anotherTopicGroup = groups.find((group) => group.label === keySubject);
    const anotherTopicSchemas = anotherTopicGroup!.children;
    assert.equal(
      anotherTopicSchemas[0].version,
      1,
      `first version should be 1, got v${anotherTopicSchemas[0].version}`,
    );

    const extraTopicGroup = groups.find((group) => group.label === otherSubject);
    const extraTopicSchemas = extraTopicGroup!.children;
    assert.equal(
      extraTopicSchemas[0].version,
      3,
      `first version should be 3, got v${extraTopicSchemas[0].version}`,
    );
  });

  it("generateSchemaSubjectGroups() should set the context value to include 'multiple-versions' if a subject has more than one schema", () => {
    const groups = generateSchemaSubjectGroups(schemas);

    const mvRe = /multiple-versions/;
    // valueSubject has two schema versions, so it should have the context value clause.
    const testTopicGroup = groups.find((group) => group.label === valueSubject);
    assert.equal(mvRe.test(testTopicGroup!.contextValue!), true);

    // Only one version, so no context value.
    const anotherTopicGroup = groups.find((group) => group.label === keySubject);
    assert.equal(mvRe.test(anotherTopicGroup!.contextValue!), false);
  });

  it("generateSchemaSubjectGroups() should set the context value to end with 'schema-subject'", () => {
    const groups = generateSchemaSubjectGroups(schemas);

    const schemaGroupRe = /schema-subject$/;
    const testTopicGroup = groups.find((group) => group.label === valueSubject);
    assert.equal(schemaGroupRe.test(testTopicGroup!.contextValue!), true);

    const anotherTopicGroup = groups.find((group) => group.label === keySubject);
    assert.equal(schemaGroupRe.test(anotherTopicGroup!.contextValue!), true);
  });

  it("generateSchemaSubjectGroups() should assign the correct icon based on schema subject suffix", () => {
    const groups = generateSchemaSubjectGroups(schemas);

    // value schemas should have the symbol-object icon
    const testTopicGroup = groups.find((group) => group.label === valueSubject);
    const testTopicIcon = testTopicGroup!.iconPath as vscode.ThemeIcon;
    assert.equal(testTopicIcon.id, new vscode.ThemeIcon(IconNames.VALUE_SUBJECT).id);

    // key schemas should have the key icon
    const anotherTopicGroup = groups.find((group) => group.label === keySubject);
    const anotherTopicIcon = anotherTopicGroup!.iconPath as vscode.ThemeIcon;
    assert.equal(anotherTopicIcon.id, new vscode.ThemeIcon(IconNames.KEY_SUBJECT).id);

    // other schemas should have the question icon
    const extraTopicGroup = groups.find((group) => group.label === otherSubject);
    const extraTopicIcon = extraTopicGroup!.iconPath as vscode.ThemeIcon;
    assert.equal(extraTopicIcon.id, new vscode.ThemeIcon(IconNames.OTHER_SUBJECT).id);
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

describe("getLanguageTypes", () => {
  type SchemaLanguagePair = [SchemaType, string[]];
  const schemaLanguagePairs: SchemaLanguagePair[] = [
    [SchemaType.Avro, ["avroavsc", "json"]],
    [SchemaType.Json, ["json"]],
    [SchemaType.Protobuf, ["proto3", "proto"]],
  ];

  for (const [schemaType, expected] of schemaLanguagePairs) {
    it(`should return ${expected} for schema type ${schemaType}`, () => {
      const languageType = getLanguageTypes(schemaType);
      assert.deepEqual(languageType, expected);
    });
  }

  it(`Schema.get`);
});

describe("SchemaTreeItem", () => {
  it("constructor should set the correct contextValue", () => {
    const evolvableShema = TEST_CCLOUD_SCHEMA.copy({
      // @ts-expect-error Require<T>
      isHighestVersion: true,
    });
    const evolvableTreeItem = new SchemaTreeItem(evolvableShema);
    assert.equal(evolvableTreeItem.contextValue, "ccloud-evolvable-schema");

    const unevolvableSchema = TEST_CCLOUD_SCHEMA.copy({
      // @ts-expect-error Require<T>
      isHighestVersion: false,
    });
    const unevolvableTreeItem = new SchemaTreeItem(unevolvableSchema);
    assert.equal(unevolvableTreeItem.contextValue, "ccloud-schema");
  });
});

import * as assert from "assert";
import "mocha";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMA,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SUBJECT,
} from "../../tests/unit/testResources";
import { CCLOUD_CONNECTION_ID, IconNames, UTM_SOURCE_VSCODE } from "../constants";
import { EnvironmentId } from "./resource";
import {
  Schema,
  SchemaTreeItem,
  SchemaType,
  Subject,
  SubjectTreeItem,
  getLanguageTypes,
  getSubjectIcon,
  subjectMatchesTopicName,
} from "./schema";

describe("Subject model methods", () => {
  it("Constructor vs bad subject name", () => {
    const badSubjects = [undefined, null, ""];
    for (const badSubject of badSubjects) {
      assert.throws(
        () => {
          new Subject(badSubject as string, CCLOUD_CONNECTION_ID, "envId" as EnvironmentId, "srId");
        },
        {
          name: "Error",
          message: `Subject name cannot be undefined, null, or empty: ${badSubject} from ${CCLOUD_CONNECTION_ID}`,
        },
      );
    }
  });
});

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
      `https://confluent.cloud/environments/${TEST_CCLOUD_SCHEMA.environmentId}/stream-governance/schema-registry/data-contracts/${TEST_CCLOUD_SCHEMA.subject}?utm_source=${UTM_SOURCE_VSCODE}`,
    );

    // Non-ccloud schemas do not
    assert.equal(TEST_LOCAL_SCHEMA.ccloudUrl, "");
  });

  describe("mergeSchemas() tests", () => {
    it("should accept new schemas when subject.schemas is null", () => {
      const subject = new Subject(
        "test-subject",
        CCLOUD_CONNECTION_ID,
        "envId" as EnvironmentId,
        "srId",
      );
      assert.equal(subject.schemas, null);

      const newSchemas = [
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 1 }),
      ];

      subject.mergeSchemas(newSchemas);
      assert.deepEqual(subject.schemas, newSchemas);
    });

    it("should merge schemas preserving additional schemas from newSchemas", () => {
      // As if we had two versions originally in our Subject ...
      const originalSchemas = [
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 1 }),
      ];

      const subject = new Subject(
        "test-subject",
        CCLOUD_CONNECTION_ID,
        "envId" as EnvironmentId,
        "srId",
        originalSchemas,
      );

      // And then version three was created, and we want to merge it in.
      // These will be the results of the latest 'get all schema versions' call for the subject.
      const newSchemas = [
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 3 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 1 }),
      ];

      subject.mergeSchemas(newSchemas);

      // Expect the resulting merge to have the versions ordered 3, 2, 1, and that v2 and v1 are the same objects as the originals.
      const resultingSchemas = subject.schemas!;
      assert.strictEqual(resultingSchemas.length, 3);
      assert.strictEqual(resultingSchemas[0].version, 3);
      assert.strictEqual(resultingSchemas[1].version, 2);
      assert.strictEqual(resultingSchemas[2].version, 1);

      assert.strictEqual(resultingSchemas[1], originalSchemas[0]); // version 2
      assert.strictEqual(resultingSchemas[2], originalSchemas[1]); // version 1
    });

    it("should remove schemas that are not in newSchemas", () => {
      const originalSchemas = [
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 3 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 1 }),
      ];

      const subject = new Subject(
        "test-subject",
        CCLOUD_CONNECTION_ID,
        "envId" as EnvironmentId,
        "srId",
        originalSchemas,
      );

      // As if both versions 3 and 1 were deleted.
      const newSchemas = [Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 })];

      subject.mergeSchemas(newSchemas);

      // Expect the resulting merge to have the versions ordered 3, 1, and that v2 is removed.
      const resultingSchemas = subject.schemas!;
      assert.strictEqual(resultingSchemas.length, 1);
      assert.strictEqual(resultingSchemas[0], originalSchemas[1]); // Should have kept the original v2 schema.
    });

    it("Should add and remove schemas when needed", () => {
      const originalSchemas = [
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 3 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 1 }),
      ];

      const subject = new Subject(
        "test-subject",
        CCLOUD_CONNECTION_ID,
        "envId" as EnvironmentId,
        "srId",
        originalSchemas,
      );

      // As if both versions 3 and 1 were deleted, and version 4 was added.
      const newSchemas = [
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 4 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 }),
      ];

      subject.mergeSchemas(newSchemas);

      // Expect the resulting merge to have the versions ordered 4, 2, and that v3 and v1 are removed.
      const resultingSchemas = subject.schemas!;
      assert.strictEqual(resultingSchemas.length, 2);
      assert.strictEqual(resultingSchemas[0].version, 4);
      assert.strictEqual(resultingSchemas[1].version, 2);

      // v2 should be the same object as the original v2 schema.
      assert.strictEqual(resultingSchemas[1], originalSchemas[1]);
    });

    it("Will handle when new schemas is longer than old schemas", () => {
      const originalSchemas = [Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 1 })];

      const subject = new Subject(
        "test-subject",
        CCLOUD_CONNECTION_ID,
        "envId" as EnvironmentId,
        "srId",
        originalSchemas,
      );

      // As if both versions 2 and 3 were just added.
      const newSchemas = [
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 3 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 2 }),
        Schema.create({ ...TEST_CCLOUD_SCHEMA, version: 1 }),
      ];

      subject.mergeSchemas(newSchemas);

      // Expect the resulting merge to have the versions ordered 4, 2, and that v3 and v1 are removed.
      const resultingSchemas = subject.schemas!;
      assert.strictEqual(resultingSchemas.length, 3);
      assert.strictEqual(resultingSchemas[0], newSchemas[0]); // version 3
      assert.strictEqual(resultingSchemas[1], newSchemas[1]); // version 2
      assert.strictEqual(resultingSchemas[2], originalSchemas[0]); // version 1
    });
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

  for (const [subjectName, iconName, strategy] of [
    ["test-key", IconNames.KEY_SUBJECT, "TopicNameStrategy"],
    ["test-value", IconNames.VALUE_SUBJECT, "TopicNameStrategy"],
    ["test-other", IconNames.OTHER_SUBJECT, "**NOT** TopicNameStrategy"],
  ]) {
    it(`subject "${subjectName}" should use the "${iconName}" icon (${strategy})`, () => {
      const subject = new Subject(
        subjectName,
        CCLOUD_CONNECTION_ID,
        "envId" as EnvironmentId,
        "srId",
        [TEST_CCLOUD_SCHEMA],
      );
      const subjectTreeItem = new SubjectTreeItem(subject);

      assert.deepEqual((subjectTreeItem.iconPath as vscode.ThemeIcon).id, iconName);
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

describe("SubjectTreeItem", () => {
  it("constructor should do the right things when no schemas present", () => {
    const subjectTreeItem = new SubjectTreeItem(TEST_CCLOUD_SUBJECT);
    assert.equal(subjectTreeItem.contextValue, "ccloud-schema-subject");

    assert.equal(subjectTreeItem.label, TEST_CCLOUD_SUBJECT.name);
    assert.equal(subjectTreeItem.id, TEST_CCLOUD_SUBJECT.name);
    assert.equal(subjectTreeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.equal(subjectTreeItem.description, undefined);
  });

  it("constructor should do the right things when single schema version present", () => {
    const subjectTreeItem = new SubjectTreeItem(TEST_CCLOUD_SUBJECT_WITH_SCHEMA);
    assert.equal(subjectTreeItem.contextValue, "ccloud-schema-subject");

    assert.equal(subjectTreeItem.label, TEST_CCLOUD_SUBJECT.name);
    assert.equal(subjectTreeItem.id, TEST_CCLOUD_SUBJECT.name);
    assert.equal(subjectTreeItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.equal(subjectTreeItem.description, "AVRO (1)");
  });

  it("constructor should do the right things when multiple schema versions present", () => {
    const subjectWithSchemasTreeItem = new SubjectTreeItem(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
    assert.equal(
      subjectWithSchemasTreeItem.contextValue,
      "ccloud-multiple-versions-schema-subject",
    );

    assert.equal(subjectWithSchemasTreeItem.label, TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.name);
    assert.equal(subjectWithSchemasTreeItem.id, TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.name);
    assert.equal(
      subjectWithSchemasTreeItem.collapsibleState,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    assert.equal(subjectWithSchemasTreeItem.description, "AVRO (2)");
  });

  it("non-ccloud subject should have the right context value", () => {
    const subjectTreeItem = new SubjectTreeItem(TEST_LOCAL_SUBJECT);

    assert.equal(subjectTreeItem.contextValue, "local-schema-subject");
  });
});

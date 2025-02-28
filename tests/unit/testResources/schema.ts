import { Schema, SchemaType, Subject } from "../../../src/models/schema";
import { TEST_CCLOUD_SCHEMA_REGISTRY, TEST_LOCAL_SCHEMA_REGISTRY } from "./schemaRegistry";
import { TEST_CCLOUD_KAFKA_TOPIC, TEST_LOCAL_KAFKA_TOPIC } from "./topic";

export const TEST_CCLOUD_SCHEMA = Schema.create({
  id: "100001",
  subject: `${TEST_CCLOUD_KAFKA_TOPIC.name}-value`,
  version: 1,
  type: SchemaType.Avro,
  schemaRegistryId: TEST_CCLOUD_SCHEMA_REGISTRY.id,
  environmentId: TEST_CCLOUD_SCHEMA_REGISTRY.environmentId,
  connectionId: TEST_CCLOUD_SCHEMA_REGISTRY.connectionId,
  connectionType: TEST_CCLOUD_SCHEMA_REGISTRY.connectionType,
  isHighestVersion: true,
});

/** TEST_CCLOUD_KEY_SCHEMA, revised. */
export const TEST_CCLOUD_SCHEMA_REVISED = Schema.create({
  ...TEST_CCLOUD_SCHEMA,
  id: "100004",
  version: 2,
  isHighestVersion: true,
});

export const TEST_CCLOUD_SUBJECT: Subject = TEST_CCLOUD_SCHEMA.subjectObject();

export const TEST_CCLOUD_KEY_SCHEMA = Schema.create({
  id: "100003",
  subject: `${TEST_CCLOUD_KAFKA_TOPIC.name}-key`,
  version: 1,
  type: SchemaType.Avro,
  schemaRegistryId: TEST_CCLOUD_SCHEMA_REGISTRY.id,
  environmentId: TEST_CCLOUD_SCHEMA_REGISTRY.environmentId,
  connectionId: TEST_CCLOUD_SCHEMA_REGISTRY.connectionId,
  connectionType: TEST_CCLOUD_SCHEMA_REGISTRY.connectionType,
  isHighestVersion: false,
});

/** A subject w/o knowledge of the schemas bound to it. */
export const TEST_CCLOUD_KEY_SUBJECT: Subject = TEST_CCLOUD_KEY_SCHEMA.subjectObject();

/** A Subject group containing single schema version. */
export const TEST_CCLOUD_SUBJECT_WITH_SCHEMA = new Subject(
  TEST_CCLOUD_SUBJECT.name,
  TEST_CCLOUD_SUBJECT.connectionId,
  TEST_CCLOUD_SUBJECT.environmentId,
  TEST_CCLOUD_SUBJECT.schemaRegistryId,
  [TEST_CCLOUD_SCHEMA_REVISED],
);

/** A Subject group containing two schema versions */
export const TEST_CCLOUD_SUBJECT_WITH_SCHEMAS = new Subject(
  TEST_CCLOUD_SUBJECT.name,
  TEST_CCLOUD_SUBJECT.connectionId,
  TEST_CCLOUD_SUBJECT.environmentId,
  TEST_CCLOUD_SUBJECT.schemaRegistryId,
  [
    // Latest versions always come first
    TEST_CCLOUD_SCHEMA_REVISED,
    TEST_CCLOUD_SCHEMA,
  ],
);

export const TEST_LOCAL_SCHEMA = Schema.create({
  id: "1",
  subject: `${TEST_LOCAL_KAFKA_TOPIC.name}-value`,
  version: 1,
  type: SchemaType.Avro,
  schemaRegistryId: TEST_LOCAL_SCHEMA_REGISTRY.id,
  environmentId: TEST_LOCAL_SCHEMA_REGISTRY.environmentId,
  connectionId: TEST_LOCAL_SCHEMA_REGISTRY.connectionId,
  connectionType: TEST_LOCAL_SCHEMA_REGISTRY.connectionType,
  isHighestVersion: true,
});

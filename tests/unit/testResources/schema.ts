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
  isHighestVersion: true,
});

export const TEST_CCLOUD_KEY_SUBJECT: Subject = TEST_CCLOUD_KEY_SCHEMA.subjectObject();

export const TEST_LOCAL_SCHEMA = Schema.create({
  id: "1",
  subject: `${TEST_LOCAL_KAFKA_TOPIC.name}-value`,
  version: 1,
  type: SchemaType.Avro,
  schemaRegistryId: TEST_LOCAL_SCHEMA_REGISTRY.id,
  connectionId: TEST_LOCAL_SCHEMA_REGISTRY.connectionId,
  connectionType: TEST_LOCAL_SCHEMA_REGISTRY.connectionType,
  isHighestVersion: true,
});

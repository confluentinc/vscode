import {
  FlinkRelation,
  FlinkRelationColumn,
  FlinkRelationType,
} from "../../../src/models/flinkRelation";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
} from "./environments";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

export const TEST_VARCHAR_COLUMN = new FlinkRelationColumn({
  relationName: "test_relation",
  name: "test_column",
  fullDataType: "VARCHAR(255)",
  isNullable: true,
  distributionKeyNumber: null,
  isGenerated: false,
  isPersisted: true,
  isHidden: false,
  metadataKey: null,
  comment: "A test column",
});

export const TEST_INT_COLUMN = new FlinkRelationColumn({
  ...TEST_VARCHAR_COLUMN,
  name: "int_column",
  fullDataType: "INT",
  isNullable: false,
});

export const TEST_FLINK_RELATION = new FlinkRelation({
  environmentId: TEST_CCLOUD_ENVIRONMENT_ID,
  provider: TEST_CCLOUD_PROVIDER,
  region: TEST_CCLOUD_REGION,
  databaseId: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
  name: "test_relation",
  comment: "A test relation",
  columns: [TEST_VARCHAR_COLUMN, TEST_INT_COLUMN],
  type: FlinkRelationType.BaseTable,
  distributionBucketCount: 4,
  isDistributed: true,
  isWatermarked: false,
  watermarkColumnName: null,
  watermarkExpression: null,
  watermarkColumnIsHidden: false,
});

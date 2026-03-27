import { FlinkTypeNode } from "../../../src/models/flinkTypeNode";
import { FlinkTypeKind } from "../../../src/models/flinkTypes";

export const TEST_FLINK_TYPE_FIELD_NODE = new FlinkTypeNode({
  parsedType: {
    kind: FlinkTypeKind.SCALAR,
    dataType: "VARCHAR",
    fullDataTypeString: "VARCHAR(255)",
    isFieldNullable: true,
    fieldName: "street",
  },
  id: "test_relation.address.street",
});

export const TEST_FLINK_TYPE_NESTED_ARRAY_NODE = new FlinkTypeNode({
  parsedType: {
    kind: FlinkTypeKind.SCALAR,
    dataType: "INT",
    fullDataTypeString: "INT",
    isFieldNullable: true,
    fieldName: "field",
  },
  id: "test_relation.data.[array].field",
});

// (Copyright) Confluent, Inc.

import { randomUUID } from "crypto";
import { ColumnDetails } from "../clients/flinkSql";

export enum Operation {
  Insert = 0,
  UpdateBefore = 1,
  UpdateAfter = 2,
  Delete = 3,
}

export type StatementResultsRow = { op: Operation; row: any[] };

export const DEFAULT_RESULTS_LIMIT = 10_000;
export const INTERNAL_COUNT_KEEP_LAST_ROW = "INTERNAL_COUNT_KEEP_LAST_ROW";

export const generateRowId = (row: any[], upsertColumns?: number[]): string => {
  let result = row;
  // If upsertColumns exists, use that to generate row ID/key.
  if (upsertColumns) {
    result = row.filter((_, idx) => upsertColumns.includes(idx));
  }

  // Trade CPU for memory and hash the concatenated row values.
  return Buffer.from(JSON.stringify(result.join("-")).replace(/[\\"]/g, "")).toString("base64");
};

export const mapColumnsToRowData = (
  columns: ColumnDetails[],
  rowData: StatementResultsRow["row"],
) => {
  return columns.reduce((acc: Map<string, any>, column, index) => {
    acc.set(column.name, rowData[index]);
    return acc;
  }, new Map());
};

const isInsertOperation = (op: Operation) => {
  // If `op` isn't present, treat it as an INSERT operation
  if (op == null) {
    return true;
  }
  return [Operation.Insert, Operation.UpdateAfter].includes(op);
};

const UUID_REGEX = new RegExp(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);

/**
 * @param map A map to be updated.
 * @param columns Columns that will be mapped to each data item in order.
 * @param rows.n.op Flink operation:
 * * 0 (INSERT) Insertion operation.
 * * 1 (UPDATE_BEFORE) Update operation with the previous content of the updated row.
 * * 2 (UPDATE_AFTER) Update operation with new content of the updated row.
 * * 3 (DELETE) Deletion operation.
 * @returns An updated map.
 * */
export const parseResults = ({
  columns,
  isAppendOnly,
  limit = DEFAULT_RESULTS_LIMIT,
  map,
  rows,
  upsertColumns,
}: {
  columns: ColumnDetails[];
  isAppendOnly: boolean;
  limit?: number;
  map: Map<string, any>;
  rows?: StatementResultsRow[];
  upsertColumns?: number[];
}) => {
  if (!rows?.length || !columns?.length) {
    return map;
  }

  const hasUpsertColumns = Boolean(upsertColumns?.length);

  rows.forEach((item, index) => {
    const rowId = generateRowId(item.row, upsertColumns);

    // (jvoronin): special case for count query:
    // - the issue:
    //   - the issue with count query is that it consistently returns UpdateBefore operation at the very end of a results set
    //   - forcing us to delete the last row, causing the UI table to remove the only row and wait for the next results set
    //   - only to flicker the row again and again
    //   - this also causes issues with count query that has multiple fields to group by
    // - the solution:
    //   - the first assumption is that by what i've seen the count query always returns single row with the value of `1`
    //       as the first result set with operation being Insert
    //   - the following results set will have only UpdateAfter and UpdateBefore operations
    //   - if we are at the last row and the operation is UpdateBefore:
    //     - we want to use the ID of the row to be updated and remove it from the map
    //     - at the same time we want to insert the same row with the special key
    //       (this basically swaps the ID of the row to be updated, but keeps the row in the map)
    //     - and then we return to skip the rest of the processing
    //   - next, on the following iteration:
    //     - if we have a row with the special key
    //     - we should remove the row with the special key
    //     - and continue processing as usual, which will insert the new row as expected because the `op` is expected to be UpdateAfter
    // also, see complementary tests to visualize this better
    if (index === rows.length - 1 && item.op === Operation.UpdateBefore) {
      map.delete(rowId);
      map.set(INTERNAL_COUNT_KEEP_LAST_ROW, mapColumnsToRowData(columns, item.row));
      return;
    }
    if (map.has(INTERNAL_COUNT_KEEP_LAST_ROW)) {
      map.delete(INTERNAL_COUNT_KEEP_LAST_ROW);
      // and continue processing the row
    }

    // Flink could drop `op`, which means it is `0`
    if (isInsertOperation(item.op)) {
      const data = mapColumnsToRowData(columns, item.row);

      // if at the limit, drop first item in the map before inserting new one at the end
      if (limit && map.size >= limit) {
        const firstItem = map.keys()?.next()?.value;
        if (firstItem) {
          map.delete(firstItem);
        }
      }

      // If no upsert_columns and (is_append_only mode or rowId already exists), append UUID to allow for duplicate row
      if (!hasUpsertColumns && (isAppendOnly || map.has(rowId))) {
        const idSuffix = randomUUID();
        const newRowId = `${rowId}-${idSuffix}`;
        map.set(newRowId, data);
      } else {
        map.set(rowId, data);
      }
    } else if (hasUpsertColumns) {
      // If we have upsert_columns, we can reliably use rowId to remove rows
      map.delete(rowId);
    } else {
      // Check all keys for a match with rowId, remove UUID to compare for duplicates as well
      // Delete most recently inserted matching rowId
      const keyToDelete = Array.from(map.keys())
        .filter((key) => key.startsWith(rowId) && UUID_REGEX.test(key.split("-").at(-1) || ""))
        .pop();
      if (keyToDelete) {
        map.delete(keyToDelete);
      }
    }
  });

  return map;
};

import { createHash } from "node:crypto";
import { v4 as uuidv4, validate, version } from "uuid";
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

/**
 * Compute a fixed-length unique id for this row based on either:
 *   * the known upsert-key column values (if any), or
 *   * all of the values in the row.
 * Uses SHA-256 to avoid unbounded key length, truncated to 128 bits (32 hex chars).
 **/
export function generateRowId(row: unknown[], upsertColumns?: number[]): string {
  const keyValues: unknown[] = upsertColumns?.length ? upsertColumns.map((i) => row[i]) : row;

  const canonical = JSON.stringify(keyValues);

  // 128-bit (32-hex-char) stable id identifying the row based on its key values.
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Given an array of column details and a corresponding array of row data, return
 * a Map that associates each column name with its corresponding data value.
 *
 * @param columns - An array of column details, each containing metadata about a column.
 * @param rowData - An array of values representing a single row's data, where each value corresponds to a column.
 * @returns A Map where each key is a column name and each value is the corresponding data from the row.
 */
export function mapColumnsToRowData(
  columns: ColumnDetails[],
  rowData: StatementResultsRow["row"],
): Map<string, any> {
  return columns.reduce((acc: Map<string, any>, column, index) => {
    acc.set(column.name, rowData[index]);
    return acc;
  }, new Map());
}

/**
 * Check if the operation is an insert operation.
 */
function isInsertOperation(op: Operation | null): boolean {
  // sometimes flink doesn't send `op`, so if it is not present, treat it as an INSERT operation
  if (op == null) {
    return true;
  }
  return op === Operation.Insert || op === Operation.UpdateAfter;
}

export function validateUUIDSuffix(rowId: string) {
  // UUID v4 is always 36 characters long
  if (rowId.length < 36) {
    return false;
  }
  // UUID v4 should be at the end of the rowId (const newRowId = `${rowId}-${idSuffix}`)
  const uuid = rowId.slice(-36);
  return (
    // make sure it's not just a random long string
    validate(uuid) &&
    // we are using UUID v4 in parseResults, so we might as well check the version
    version(uuid) === 4
  );
}

export interface ParseResultsProps {
  columns: ColumnDetails[];
  isAppendOnly: boolean;
  limit?: number;
  /** The results map */
  map: Map<string, Map<string, any>>;
  rows?: StatementResultsRow[] | null;
  upsertColumns?: number[];
}

/**
 * Parases Flink SQL results and updates a map of rows.
 * @param map A map to be updated.
 * @param columns Columns that will be mapped to each data item in order.
 * @param rows.n.op Flink operation:
 * * 0 (INSERT) Insertion operation.
 * * 1 (UPDATE_BEFORE) Update operation with the previous content of the updated row.
 * * 2 (UPDATE_AFTER) Update operation with new content of the updated row.
 * * 3 (DELETE) Deletion operation.
 * @returns An updated map.
 * */
export function parseResults({
  columns,
  isAppendOnly,
  limit = DEFAULT_RESULTS_LIMIT,
  map,
  rows,
  upsertColumns,
}: ParseResultsProps): Map<string, Map<string, any>> {
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

    if (isInsertOperation(item.op)) {
      const data = mapColumnsToRowData(columns, item.row);

      // if at the limit, drop first item in the map before inserting new one at the end
      if (limit && map.size >= limit) {
        const firstItem = map.keys()?.next()?.value;
        if (firstItem) {
          map.delete(firstItem);
        }
      }

      const hasRowId = map.has(rowId);

      if (
        // If no upsert_columns and (is_append_only mode or rowId already exists), append UUID to allow for duplicate row
        (!hasUpsertColumns && (isAppendOnly || hasRowId)) ||
        // another case: even if we have upsert_columns, and rowId already exists, but the op is Insert,
        // we want to create a new row with a new UUID to avoid overwriting the existing row
        // see https://confluentinc.atlassian.net/browse/EXP-16582 for more details
        (hasUpsertColumns && hasRowId && item.op === Operation.Insert)
      ) {
        const idSuffix = uuidv4();
        const newRowId = `${rowId}-${idSuffix}`;
        map.set(newRowId, data);
      } else {
        map.set(rowId, data);
      }
    } else {
      const keyToDelete = Array.from(map.keys())
        .filter((key) => {
          return (key.startsWith(rowId) && validateUUIDSuffix(key)) || key === rowId;
        })
        .pop();
      if (keyToDelete) {
        map.delete(keyToDelete);
      }
    }
  });

  return map;
}

import { SqlV1ResultSchema } from "../clients/flinkSql";

export type ViewMode = "table" | "changelog";

type ColumnDefinition = {
  index: number;
  title: () => string;
  children: (result: Record<string, any>) => any;
  description: (result: Record<string, any>) => any;
};

export type ColumnDefinitions = Record<string, ColumnDefinition>;

const OPERATION_TYPES = {
  0: "+I",
  1: "-U",
  2: "+U",
  3: "-D",
} as const;

/**
 * Creates column definitions for either table or changelog view mode
 * @param schema The schema containing column information
 * @param viewMode The current view mode ('table' or 'changelog')
 * @returns Record of column definitions
 */
export function createColumnDefinitions(
  schema: SqlV1ResultSchema,
  viewMode: ViewMode,
): ColumnDefinitions {
  if (viewMode === "changelog") {
    // Operation column for changelog view
    const opColumn = {
      op: {
        index: 0,
        title: () => "Operation",
        children: (result: Record<string, any>) => {
          const op = result.op;
          return OPERATION_TYPES[op as keyof typeof OPERATION_TYPES] ?? op;
        },
        description: (result: Record<string, any>) => result.op ?? "NULL",
      },
    };

    // Add data columns for changelog view
    return {
      ...opColumn,
      ...addSchemaColumns(schema, 1, (result, col, index) => {
        if (Array.isArray(result.row) && result.row.length > index) {
          return result.row[index] !== null && result.row[index] !== undefined
            ? result.row[index]
            : "NULL";
        }
        return "NULL";
      }),
    };
  } else {
    // Add data columns for table view
    return addSchemaColumns(schema, 0, (result, col) => result[col.name] ?? "NULL");
  }
}

/**
 * Creates schema columns with the given starting index and value getter
 */
function addSchemaColumns(
  schema: SqlV1ResultSchema,
  startIndex: number,
  getValue: (result: Record<string, any>, col: { name: string }, index: number) => any,
): ColumnDefinitions {
  return Object.fromEntries(
    schema?.columns?.map((col, index) => [
      col.name,
      {
        index: startIndex + index,
        title: () => col.name,
        children: (result: Record<string, any>) => getValue(result, col, index),
        description: (result: Record<string, any>) => getValue(result, col, index),
      },
    ]) ?? [],
  );
}

/**
 * Gets the list of column names in the order they should be displayed
 * @param schema The schema containing column information
 * @param viewMode The current view mode ('table' or 'changelog')
 * @returns Array of column names in display order
 */
export function getColumnOrder(schema: SqlV1ResultSchema, viewMode: ViewMode): string[] {
  if (viewMode === "changelog") {
    return ["op", ...(schema.columns?.map((col) => col.name) ?? [])];
  }
  return schema.columns?.map((col) => col.name) ?? [];
}

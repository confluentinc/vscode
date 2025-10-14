import { Logger } from "../../logging";
import {
  CompositeFlinkRelationColumn,
  FlinkRelationColumn,
  MapFlinkRelationColumn,
} from "../flinkSystemCatalog";

const logger = new Logger("relation-column-parser");

export function relationColumnFactory(
  props: Pick<
    FlinkRelationColumn,
    | "relationName"
    | "name"
    | "fullDataType"
    | "isNullable"
    | "distributionKeyNumber"
    | "isGenerated"
    | "isPersisted"
    | "isHidden"
    | "metadataKey"
  > & {
    isArray?: boolean;
  },
): FlinkRelationColumn {
  if (!isCompositeType(props.fullDataType)) {
    // Simple scalar type – no recursive parsing required.
    return new FlinkRelationColumn(props);
  }

  try {
    const parser = new TypeParser(props.fullDataType);
    const parsed = parser.parseType();

    if (parsed.kind === ParsedKind.Row) {
      const columns: FlinkRelationColumn[] = parsed.fields.map((field) =>
        relationColumnFactory({
          relationName: `${props.relationName}.${props.name}`,
          // Synthetic relation name chain preserves hierarchy
          name: field.name,
          fullDataType: field.typeText,
          isNullable: field.nullable,
          distributionKeyNumber: null,
          isGenerated: props.isGenerated,
          isPersisted: props.isPersisted,
          isHidden: props.isHidden,
          metadataKey: null,
          isArray: field.type.kind === ParsedKind.Array,
        }),
      );

      return new CompositeFlinkRelationColumn({
        ...props,
        isArray: props.isArray === true,
        columns,
      });
    }

    if (parsed.kind === ParsedKind.Map) {
      const keyCol = relationColumnFactory({
        relationName: `${props.relationName}.${props.name}`,
        name: "key",
        fullDataType: parsed.key.text,
        isNullable: parsed.key.nullable,
        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        isArray: parsed.key.kind === ParsedKind.Array,
      });
      const valueCol = relationColumnFactory({
        relationName: `${props.relationName}.${props.name}`,
        name: "value",
        fullDataType: parsed.value.text,
        isNullable: parsed.value.nullable,
        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        isArray: parsed.value.kind === ParsedKind.Array,
      });
      return new MapFlinkRelationColumn({
        ...props,
        keyColumn: keyCol,
        valueColumn: valueCol,
        isArray: props.isArray === true,
      });
    }

    if (parsed.kind === ParsedKind.Array) {
      // Recursively parse the element type so that ARRAY<ROW<...>>, ARRAY<MAP<...>> or nested ARRAYs
      // correctly build their internal composite / map structures before we wrap them.
      return relationColumnFactory({
        relationName: `${props.relationName}.${props.name}`,
        name: props.name,
        fullDataType: parsed.element.text,
        isNullable: parsed.nullable,
        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        isArray: true,
      });
    } else {
      throw new Error(`Unhandled parsed type kind: ${parsed.kind}`);
    }
  } catch (e) {
    logger.error(`Failed to parse complex type '${props.fullDataType}': ${(e as Error).message}`);
    // Fall back to simple behavior to avoid total failure.
    return new FlinkRelationColumn(props);
  }
}

/* ----------------------------- Parsing Section ----------------------------- */

enum ParsedKind {
  Primitive = "primitive",
  Row = "row",
  Map = "map",
  Array = "array",
}

interface ParsedTypeBase {
  kind: ParsedKind;
  nullable: boolean;
  text: string; // Canonical text (no comments, no trailing NULL marker)
}

interface ParsedPrimitive extends ParsedTypeBase {
  kind: ParsedKind.Primitive;
}

interface ParsedArray extends ParsedTypeBase {
  kind: ParsedKind.Array;
  element: ParsedType;
}

interface ParsedMap extends ParsedTypeBase {
  kind: ParsedKind.Map;
  key: ParsedType;
  value: ParsedType;
}

interface ParsedRowField {
  name: string;
  type: ParsedType;
  typeText: string; // Canonical textual representation of the field's type
  comment?: string;
  nullable: boolean;
}

interface ParsedRow extends ParsedTypeBase {
  kind: ParsedKind.Row;
  fields: ParsedRowField[];
}

type ParsedType = ParsedPrimitive | ParsedArray | ParsedMap | ParsedRow;

/**
 * Returns true if the type string contains composite constructs we must parse.
 */
function isCompositeType(t: string): boolean {
  const upper = t.toUpperCase();
  return (
    upper.includes("ROW<") ||
    upper.includes("MAP<") ||
    upper.includes("ARRAY<") ||
    upper.includes("MULTISET<")
  );
}

/**
 * Recursive descent parser for Flink style complex types.
 */
class TypeParser {
  private readonly input: string;
  private pos = 0;
  private readonly length: number;

  constructor(input: string) {
    this.input = input.trim();
    this.length = this.input.length;
  }

  parseType(): ParsedType {
    this.skipWs();
    const start = this.pos;
    const look = this.peekWordUpper();
    if (look === "ROW" && this.peekChar(3) === "<") {
      return this.parseRow(start);
    }
    if (look === "MAP" && this.peekChar(3) === "<") {
      return this.parseMap(start);
    }
    if (look === "ARRAY" && this.peekChar(5) === "<") {
      return this.parseArray(start);
    }
    return this.parsePrimitive(start);
  }

  private parseRow(typeStart: number): ParsedRow {
    // Consume ROW<
    this.expectWord("ROW");
    this.expectChar("<");
    const fields: ParsedRowField[] = [];
    this.skipWs();
    while (!this.eof() && this.current() !== ">") {
      fields.push(this.parseRowField());
      this.skipWs();
      if (this.current() === ",") {
        this.pos++;
        this.skipWs();
        continue;
      }
      break;
    }
    this.expectChar(">");

    // handle trailing NULL / NOT NULL for the row type itself
    this.skipWs();
    const save = this.pos;
    const nextWord = this.peekWordUpper();
    if (nextWord === "NULL") {
      this.consumeWord();
      // Mark row type nullable
      this.skipWs();
      const text = this.input.substring(typeStart, this.pos);
      return {
        kind: ParsedKind.Row,
        fields,
        nullable: true,
        text,
      };
    } else if (nextWord === "NOT") {
      this.consumeWord();
      this.skipWs();
      if (this.peekWordUpper() === "NULL") {
        this.consumeWord();
        // Mark row type not nullable
        this.skipWs();
        const text = this.input.substring(typeStart, this.pos);
        return {
          kind: ParsedKind.Row,
          fields,
          nullable: false,
          text,
        };
      } else {
        this.pos = save;
      }
    }

    // Default: row type not nullable

    const text = this.input.substring(typeStart, this.pos);
    return {
      kind: ParsedKind.Row,
      fields,
      nullable: false, // Row nullability (as a type) is handled outside field spec; rarely used inline
      text,
    };
  }

  private parseRowField(): ParsedRowField {
    this.skipWs();
    const name = this.parseBacktickedIdentifier();
    this.skipWs();
    const typeStart = this.pos;
    const type = this.parseType();
    const typeEnd = this.pos;
    const typeText = this.input.substring(typeStart, typeEnd);

    this.skipWs();
    let comment: string | undefined;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    // Nullability spec:
    // - NULL => nullable
    // - NOT NULL => not nullable
    // - absent => default NOT NULL
    let nullable = false;
    const nextWord = this.peekWordUpper();
    if (nextWord === "NULL") {
      this.consumeWord();
      nullable = true;
    } else if (nextWord === "NOT") {
      const save = this.pos;
      this.consumeWord(); // NOT
      this.skipWs();
      if (this.peekWordUpper() === "NULL") {
        this.consumeWord(); // NULL
        nullable = false;
      } else {
        // Roll back if it wasn't NOT NULL (edge case)
        this.pos = save;
      }
    }

    return {
      name,
      type,
      typeText,
      comment,
      nullable,
    };
  }

  private parseMap(typeStart: number): ParsedMap {
    this.expectWord("MAP");
    this.expectChar("<");
    this.skipWs();
    const key = this.parseType();
    this.skipWs();
    this.expectChar(",");
    this.skipWs();
    const value = this.parseType();
    this.skipWs();
    this.expectChar(">");
    const text = this.input.substring(typeStart, this.pos);
    return {
      kind: ParsedKind.Map,
      key,
      value,
      nullable: false,
      text,
    };
  }

  private parseArray(typeStart: number): ParsedArray {
    this.expectWord("ARRAY");
    this.expectChar("<");
    this.skipWs();
    const element = this.parseType();
    this.skipWs();
    // Optional element-level NULL / NOT NULL inside ARRAY<...>
    const save = this.pos;
    const nextWord = this.peekWordUpper();
    if (nextWord === "NULL") {
      // Mark element nullable
      this.consumeWord();
      element.nullable = true;
      this.skipWs();
    } else if (nextWord === "NOT") {
      this.consumeWord();
      this.skipWs();
      if (this.peekWordUpper() === "NULL") {
        this.consumeWord();
        element.nullable = false;
        this.skipWs();
      } else {
        this.pos = save;
      }
    }
    this.expectChar(">");

    // Handle trailing NULL / NOT NULL for the array type itself
    this.skipWs();
    const arrSave = this.pos;
    const arrNextWord = this.peekWordUpper();
    if (arrNextWord === "NULL") {
      this.consumeWord();
      // Mark array type nullable
      this.skipWs();
      const text = this.input.substring(typeStart, this.pos);
      return {
        kind: ParsedKind.Array,
        element,
        nullable: true,
        text,
      };
    } else if (arrNextWord === "NOT") {
      this.consumeWord();
      this.skipWs();
      if (this.peekWordUpper() === "NULL") {
        this.consumeWord();
        // Mark array type not nullable
        this.skipWs();
        const text = this.input.substring(typeStart, this.pos);
        return {
          kind: ParsedKind.Array,
          element,
          nullable: false,
          text,
        };
      } else {
        this.pos = arrSave;
      }
    }

    // Default: array type not nullable
    const text = this.input.substring(typeStart, this.pos);
    return {
      kind: ParsedKind.Array,
      element,
      nullable: false,
      text,
    };
  }

  private parsePrimitive(typeStart: number): ParsedPrimitive {
    // Collect chars until one of: ',', '>', end, comment start, or nullable marker at top-level of primitive.
    let parenDepth = 0;
    while (!this.eof()) {
      const ch = this.current();
      if (ch === "(") {
        parenDepth++;
      } else if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (parenDepth === 0) {
        if (ch === "," || ch === ">") {
          break;
        }
        if (ch === "'") {
          // Start of comment after type
          break;
        }
        // Check for nullable marker ahead (space + NULL / NOT NULL)
        if (this.isAtNullableBoundary()) {
          break;
        }
      }
      this.pos++;
    }
    const text = this.input.substring(typeStart, this.pos).trimEnd();
    return {
      kind: ParsedKind.Primitive,
      nullable: false,
      text,
    };
  }

  private isAtNullableBoundary(): boolean {
    // Look ahead skipping spaces; if next word is NULL or NOT -> boundary
    const save = this.pos;
    this.skipWsInline();
    const w = this.peekWordUpper();
    this.pos = save;
    return w === "NULL" || w === "NOT";
  }

  /* --------------------------- Low-level utilities -------------------------- */

  private current(): string {
    return this.input[this.pos];
  }

  private eof(): boolean {
    return this.pos >= this.length;
  }

  private skipWs(): void {
    while (!this.eof() && /\s/.test(this.current())) this.pos++;
  }

  private skipWsInline(): void {
    while (!this.eof() && this.current() === " ") this.pos++;
  }

  private expectChar(c: string): void {
    this.skipWs();
    if (this.current() !== c) {
      throw new Error(`Expected '${c}' at position ${this.pos}, found '${this.current()}'`);
    }
    this.pos++;
  }

  private expectWord(word: string): void {
    this.skipWs();
    const upper = word.toUpperCase();
    const actual = this.peekWordUpper();
    if (actual !== upper) {
      throw new Error(`Expected keyword ${upper} at position ${this.pos}, found ${actual}`);
    }
    this.consumeWord();
  }

  private peekChar(offset: number): string | undefined {
    return this.input[this.pos + offset];
  }

  private peekWordUpper(): string {
    let i = this.pos;
    while (i < this.length && /\s/.test(this.input[i])) i++;
    let j = i;
    while (j < this.length && /[A-Za-z_]/.test(this.input[j])) j++;
    return this.input.substring(i, j).toUpperCase();
  }

  private consumeWord(): string {
    this.skipWs();
    const start = this.pos;
    while (!this.eof() && /[A-Za-z_]/.test(this.current())) this.pos++;
    return this.input.substring(start, this.pos);
  }

  private parseBacktickedIdentifier(): string {
    if (this.current() !== "`") {
      throw new Error(`Expected backtick at position ${this.pos}`);
    }
    this.pos++;
    const start = this.pos;
    while (!this.eof() && this.current() !== "`") {
      this.pos++;
    }
    if (this.eof()) {
      throw new Error("Unterminated backticked identifier");
    }
    const name = this.input.substring(start, this.pos);
    this.pos++; // consume closing backtick
    return name;
  }

  private parseQuotedComment(): string {
    if (this.current() !== "'") {
      throw new Error(`Expected quote at position ${this.pos}`);
    }
    this.pos++; // opening '
    let result = "";
    while (!this.eof()) {
      const ch = this.current();
      if (ch === "'") {
        // Could be end or escaped ''
        if (this.peekChar(1) === "'") {
          result += "'";
          this.pos += 2;
          continue;
        }
        this.pos++; // closing
        break;
      }
      result += ch;
      this.pos++;
    }
    return result;
  }
}

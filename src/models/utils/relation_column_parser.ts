import { Logger } from "../../logging";
import {
  CompositeFlinkRelationColumn,
  FlinkRelationColumn,
  MapFlinkRelationColumn,
} from "../flinkSystemCatalog";

const logger = new Logger("relation-column-parser");

type ConstructorArgs = Pick<
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
  | "comment"
> & {
  isArray?: boolean;
  isArrayMemberNullable?: boolean;
};

export function relationColumnFactory(props: ConstructorArgs): FlinkRelationColumn {
  try {
    const parser = new TypeParser(props.fullDataType);
    const parsed = parser.parseType();

    if (!isCompositeType(props.fullDataType)) {
      return new FlinkRelationColumn({
        ...props,
        fullDataType: parsed.text,
        comment: props.comment || parsed.comment,
        isNullable: props.isNullable || parsed.nullable,
        isArray: props.isArray || parsed.kind === ParsedKind.Array,
        isArrayMemberNullable: props.isArrayMemberNullable || false,
      });
    }

    if (parsed.kind === ParsedKind.Row) {
      const columns: FlinkRelationColumn[] = parsed.fields.map((field) =>
        relationColumnFactory({
          relationName: `${props.relationName}.${props.name}`,
          // Synthetic relation name chain preserves hierarchy
          name: field.name,
          fullDataType: field.typeText,
          isNullable: field.nullable,
          comment: field.comment ?? null,
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
        isArrayMemberNullable: props.isArrayMemberNullable === true,
        fullDataType: parsed.text,
        comment: props.comment || parsed.comment,
        isNullable: props.isNullable,
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
        comment: null,
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
        isArrayMemberNullable: false,
        comment: null,
      });
      return new MapFlinkRelationColumn({
        ...props,
        keyColumn: keyCol,
        valueColumn: valueCol,
        isArray: props.isArray === true,
        isArrayMemberNullable: props.isArrayMemberNullable === true,
      });
    }

    if (parsed.kind === ParsedKind.Array) {
      // Recursively parse the element type so that ARRAY<ROW<...>>, ARRAY<MAP<...>> or nested ARRAYs
      // correctly build their internal composite / map structures before we wrap them.
      const newProps = {
        relationName: `${props.relationName}.${props.name}`,
        name: props.name,
        fullDataType: parsed.element.text,

        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        isArray: true,
        isNullable: parsed.nullable, // the overall array nullability
        isArrayMemberNullable: parsed.element.nullable, // are the array members nullable?
        comment: parsed.comment ?? null,
      };

      return relationColumnFactory(newProps);
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
  comment: string | null; // Optional comment if present
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
        // Check for stop marker ahead (space + NULL / NOT NULL or open single quote for comment)
        if (this.isAtNullableOrCommentBoundary()) {
          break;
        }
      }
      this.pos++;
    }
    const text = this.input.substring(typeStart, this.pos).trimEnd();

    // look for nullability
    this.skipWs();
    const nullable = this.parseNullability();

    // Now look for trailing optional comment
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }
    return {
      kind: ParsedKind.Primitive,
      nullable: nullable,
      comment,
      text,
    };
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

    // handle possible NULL / NOT NULL after ROW<...>
    this.skipWs();
    const nullable = this.parseNullability();

    // Handle optional comment the nullability.
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    const text = this.input.substring(typeStart, this.pos);
    return {
      kind: ParsedKind.Row,
      fields,
      comment,
      nullable, // Row nullability (as a type) is handled outside field spec; rarely used inline
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

    // Possible NULL / NOT NULL after field type
    const nullable = this.parseNullability();

    // Possible comment after field type and nullability
    this.skipWs();
    let comment: string | undefined;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
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

    // Handle optional NULL / NOT NULL for the map type itself
    const nullable = this.parseNullability();

    // Optional comment after MAP<...>
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    return {
      kind: ParsedKind.Map,
      key,
      value,
      comment,
      nullable,
      text,
    };
  }

  private parseArray(typeStart: number): ParsedArray {
    this.expectWord("ARRAY");
    this.expectChar("<");
    this.skipWs();
    const element = this.parseType();

    // Optional element-level NULL / NOT NULL inside ARRAY<...>
    const elemNullable = this.parseNullability();
    if (elemNullable) {
      // Rebuild element text to include NULL marker if present
      const elemText = this.input.substring(typeStart, this.pos).trimEnd();
      element.nullable = true;
      element.text = elemText;
    }

    this.skipWs();
    this.expectChar(">");

    // Handle trailing NULL / NOT NULL for the array type itself
    this.skipWs();
    const nullable = this.parseNullability();

    // Optional comment after ARRAY<...>
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    const text = this.input.substring(typeStart, this.pos);
    return {
      kind: ParsedKind.Array,
      element,
      nullable,
      text,
      comment: comment,
    };
  }

  private isAtNullableOrCommentBoundary(): boolean {
    // Look ahead skipping spaces; if next word is NULL or NOT -> boundary
    const save = this.pos;
    this.skipWsInline();
    const w = this.peekWordUpper();
    this.pos = save;
    return w === "NULL" || w === "NOT" || w === "'"; // also stop at comment start
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
    // Skip leading whitespace
    while (i < this.length && /\s/.test(this.input[i])) i++;

    if (this.input[i] === "'") {
      // Comment start identifier, return it. Counts as its own word.
      return "'";
    }

    // Consume word
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

  private parseNullability(): boolean {
    this.skipWs();
    const save = this.pos;
    let nullable = false;
    const nextWord = this.peekWordUpper();
    if (nextWord === "NULL") {
      this.consumeWord();
      this.skipWs();
      nullable = true;
    } else if (nextWord === "NOT") {
      this.consumeWord();
      this.skipWs();
      if (this.peekWordUpper() === "NULL") {
        this.consumeWord();
        this.skipWs();
        nullable = false;
      } else {
        this.pos = save;
      }
    }
    return nullable;
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

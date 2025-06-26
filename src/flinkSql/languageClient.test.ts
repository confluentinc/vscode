import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  adaptCompletionItems,
  convertToMultiLineRange,
  convertToSingleLinePosition,
} from "./languageClient";

describe("flinkSql/languageClient.ts position conversion functions", () => {
  let sandbox: sinon.SinonSandbox;
  let mockDocument: vscode.TextDocument;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockDocument = {
      getText: sandbox.stub().returns("line1\nline2\nline3\nline4"),
    } as unknown as vscode.TextDocument;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("convertToSingleLinePosition()", () => {
    it("should convert position on first line correctly", () => {
      const position = new vscode.Position(0, 3);
      const result = convertToSingleLinePosition(mockDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 3);
    });

    it("should handle position with character exceeding line length", () => {
      // Position beyond actual line length (line1 is 5 chars)
      const position = new vscode.Position(0, 10);
      const result = convertToSingleLinePosition(mockDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 10);
    });

    it("should convert position on second line correctly", () => {
      const position = new vscode.Position(1, 2);
      const result = convertToSingleLinePosition(mockDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 8); // "line1\n".length + 2 = 6 + 2 = 8
    });

    it("should convert position on last line correctly", () => {
      const position = new vscode.Position(3, 4);
      const result = convertToSingleLinePosition(mockDocument, position);

      // "line1\n".length + "line2\n".length + "line3\n".length + 4
      // = 6 + 6 + 6 + 4 = 22
      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 22);
    });

    it("should handle empty document correctly", () => {
      const emptyDocument = {
        getText: sandbox.stub().returns(""),
      } as unknown as vscode.TextDocument;
      const position = new vscode.Position(0, 0);
      const result = convertToSingleLinePosition(emptyDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 0);
    });

    it("should handle document with different line lengths", () => {
      const complexDocument = {
        getText: sandbox.stub().returns("short\nverylongline\nx"),
      } as unknown as vscode.TextDocument;
      const position = new vscode.Position(2, 1);
      const result = convertToSingleLinePosition(complexDocument, position);

      // "short\n".length + "verylongline\n".length + 1
      // = 6 + 13 + 1 = 20
      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 20);
    });

    it("should handle document with consecutive newlines correctly", () => {
      const documentWithEmptyLines = {
        getText: sandbox.stub().returns("line1\n\n\nline4"),
      } as unknown as vscode.TextDocument;
      const position = new vscode.Position(3, 2);
      const result = convertToSingleLinePosition(documentWithEmptyLines, position);

      // "line1\n".length + "\n".length + "\n".length + 2
      // = 6 + 1 + 1 + 2 = 10
      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 10);
    });
  });

  describe("convertToMultiLineRange()", () => {
    it("should convert range on first line correctly", () => {
      const singleLineRange = new vscode.Range(0, 1, 0, 3);
      const result = convertToMultiLineRange(mockDocument, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 1);
      assert.strictEqual(result.end.line, 0);
      assert.strictEqual(result.end.character, 3);
    });

    it("should handle range with extreme offset values correctly", () => {
      // Position beyond the total document length
      const extremeRange = new vscode.Range(0, 500, 0, 600);
      const result = convertToMultiLineRange(mockDocument, extremeRange);

      // Should default to last position for both start and end
      assert.strictEqual(result.start.line, 3);
      assert.strictEqual(result.start.character, 5); // length of "line4"
      assert.strictEqual(result.end.line, 3);
      assert.strictEqual(result.end.character, 5); // length of "line4"
    });

    it("should convert range spanning multiple lines correctly", () => {
      // From line 0, char 3 to line 1, char 2
      const singleLineRange = new vscode.Range(0, 3, 0, 9);
      const result = convertToMultiLineRange(mockDocument, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 3);
      assert.strictEqual(result.end.line, 1);
      assert.strictEqual(result.end.character, 3);
    });

    it("should handle empty document correctly", () => {
      const emptyDocument = {
        getText: sandbox.stub().returns(""),
      } as unknown as vscode.TextDocument;
      const singleLineRange = new vscode.Range(0, 0, 0, 0);
      const result = convertToMultiLineRange(emptyDocument, singleLineRange);

      // With empty document, we should get default position
      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 0);
      assert.strictEqual(result.end.line, 0);
      assert.strictEqual(result.end.character, 0);
    });

    it("should handle document with different line lengths", () => {
      const complexDocument = {
        getText: sandbox.stub().returns("short\nverylongline\nx"),
      } as unknown as vscode.TextDocument;
      // Range from middle of first line to middle of last line
      const singleLineRange = new vscode.Range(0, 2, 0, 20);
      const result = convertToMultiLineRange(complexDocument, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 2);
      assert.strictEqual(result.end.line, 2);
      assert.strictEqual(result.end.character, 1);
    });

    it("should handle document with consecutive newlines correctly", () => {
      const documentWithEmptyLines = {
        getText: sandbox.stub().returns("line1\n\n\nline4"),
      } as unknown as vscode.TextDocument;
      // Range spanning from first line to fourth line
      const singleLineRange = new vscode.Range(0, 3, 0, 10);
      const result = convertToMultiLineRange(documentWithEmptyLines, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 3);
      assert.strictEqual(result.end.line, 3);
      assert.strictEqual(result.end.character, 2);
    });
  });

  describe("Round-trip conversion", () => {
    it("should correctly round-trip from multi-line to single-line and back", () => {
      const originalPosition = new vscode.Position(1, 3);
      const singleLinePosition = convertToSingleLinePosition(mockDocument, originalPosition);
      // Verify single-line position converts correctly
      assert.strictEqual(singleLinePosition.line, 0);
      // "line1\n".length + 3 = 6 + 3 = 9
      assert.strictEqual(singleLinePosition.character, 9);

      const singleLineRange = new vscode.Range(singleLinePosition, singleLinePosition);
      const multiLineRange = convertToMultiLineRange(mockDocument, singleLineRange);

      // Verify we got back our original position
      assert.strictEqual(multiLineRange.start.line, 1);
      assert.strictEqual(multiLineRange.start.character, 3);
    });
  });

  it("should correctly round-trip a range spanning multiple lines", () => {
    const originalRange = new vscode.Range(new vscode.Position(1, 2), new vscode.Position(3, 4));
    const singleLineStart = convertToSingleLinePosition(mockDocument, originalRange.start);
    const singleLineEnd = convertToSingleLinePosition(mockDocument, originalRange.end);
    const singleLineRange = new vscode.Range(singleLineStart, singleLineEnd);

    const resultRange = convertToMultiLineRange(mockDocument, singleLineRange);

    assert.deepStrictEqual(resultRange, originalRange);
  });

  it("should correctly round-trip edge case positions", () => {
    const text = mockDocument.getText();
    const lines = text.split("\n");
    const lastLineIndex = lines.length - 1;
    const lastLineLength = lines[lastLineIndex].length;

    const positionsToTest = [
      new vscode.Position(0, 0), // start of document
      new vscode.Position(1, 0), // start of a line
      new vscode.Position(lastLineIndex, lastLineLength), // end of document
    ];

    for (const originalPosition of positionsToTest) {
      const singleLinePosition = convertToSingleLinePosition(mockDocument, originalPosition);
      const singleLineRange = new vscode.Range(singleLinePosition, singleLinePosition);
      const resultRange = convertToMultiLineRange(mockDocument, singleLineRange);
      assert.deepStrictEqual(
        resultRange.start,
        originalPosition,
        `Failed for position ${originalPosition.line}:${originalPosition.character}`,
      );
    }
  });
});

describe("adaptCompletionItems", () => {
  it("should remove filterText if the completion does not have backticks", () => {
    const document = {
      getText: (range?: vscode.Range) => {
        if (range) {
          return "";
        }
        return "SELECT * FROM my_table";
      },
    } as vscode.TextDocument;

    const result = {
      items: [
        {
          label: "my_table",
          textEdit: {
            range: new vscode.Range(0, 14, 0, 22),
            newText: "my_table",
          },
          filterText: "`my_table`",
        },
      ],
    };

    const adaptedResult = adaptCompletionItems(result, document);
    const adaptedItem = adaptedResult.items[0];

    assert.strictEqual(adaptedItem.filterText, undefined, "filterText should be undefined");
  });

  it("should not change filterText if backticks are present", () => {
    const document = {
      getText: (range?: vscode.Range) => {
        if (range) {
          return "`my_table`";
        }
        return "SELECT * FROM `my_table`";
      },
    } as vscode.TextDocument;

    const result = {
      items: [
        {
          label: "my_table",
          textEdit: {
            range: new vscode.Range(0, 14, 0, 24),
            newText: "`my_table`",
          },
          filterText: "`my_table`",
        },
      ],
    };

    const adaptedResult = adaptCompletionItems(result, document);
    const adaptedItem = adaptedResult.items[0];

    assert.strictEqual(adaptedItem.filterText, "`my_table`", "filterText should not be changed");
  });
});

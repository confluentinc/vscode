import { Uri, Position as VSPosition, Range as VSRange } from "vscode";
import {
  BaseASTNode,
  JSONSchema,
  Position as LSPosition,
  TextDocument,
} from "vscode-json-languageservice";
import { Logger } from "../logging";
import { loadDocumentContent } from "../quickpicks/uris";
import { initializeJsonDocument } from "./validateDocument";

const logger = new Logger("schemas.parsing");

export async function getRangeForDocument(
  documentUri: Uri,
  schema: JSONSchema,
  itemIndex: number = 0,
  key?: string,
): Promise<VSRange> {
  const { content } = await loadDocumentContent(documentUri);
  const { textDocument, jsonDocument } = initializeJsonDocument(documentUri, content, schema);

  let range: VSRange = new VSRange(0, 0, 0, 0);
  if (!jsonDocument.root) {
    // if the document is empty, return an empty range
    return range;
  }

  if (jsonDocument.root.type === "object") {
    // single object, ignore the index and just look for the key if provided
    if (key) {
      const propertyNode = jsonDocument.root.properties?.find(
        (prop) => prop.keyNode?.value === key,
      );
      if (propertyNode) {
        logger.trace(`found property node for key '${key}'`);
        range = createRange(textDocument, propertyNode);
      }
    }
  } else if (jsonDocument.root.type === "array") {
    // multiple objects, look for the item at the specified index before checking the key
    const childNode: BaseASTNode = jsonDocument.root.items[itemIndex];
    if (childNode) {
      logger.trace(`found child node ${childNode} at index ${itemIndex}`);
      // found a single object at the provided index, set the range to cover the whole object
      range = createRange(textDocument, childNode);
      if (key && childNode.type === "object") {
        // TODO: figure out why TS is complaining about childNode not having properties
        const objectNode = childNode as {
          properties?: Array<{
            keyNode?: { value: string };
            valueNode?: any;
          }>;
        };
        const propertyNode = objectNode.properties?.find((prop) => prop.keyNode?.value === key);
        if (propertyNode) {
          logger.trace(`found property node for key '${key}' in item at index ${itemIndex}`);
          range = createRange(textDocument, propertyNode as BaseASTNode);
        }
      }
    }
  }

  return range;
}

/**
 * Converts a {@link LSPosition Position} from the `vscode-json-languageservice` to a
 * {@link VSPosition Position} from the `vscode` module.
 */
export function convertToVSPosition(position: LSPosition): VSPosition {
  return new VSPosition(position.line, position.character);
}

/**
 * Generates a {@link VSRange Range} from a {@link BaseASTNode} and a {@link TextDocument}.
 */
export function createRange(textDocument: TextDocument, childNode: BaseASTNode): VSRange {
  const objStartPosition: VSPosition = convertToVSPosition(
    textDocument.positionAt(childNode.offset),
  );
  const objEndPosition: VSPosition = convertToVSPosition(
    textDocument.positionAt(childNode.offset + childNode.length),
  );
  return new VSRange(objStartPosition, objEndPosition);
}

import { ElectronApplication, expect, Locator, Page } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { loadFixtureFromFile } from "../../fixtures/utils";
import { TextDocument } from "../objects/editor/TextDocument";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { InputBox } from "../objects/quickInputs/InputBox";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { SchemasView } from "../objects/views/SchemasView";
import { SubjectItem } from "../objects/views/viewItems/SubjectItem";

export enum SchemaType {
  Avro = "AVRO",
  Json = "JSON",
  Protobuf = "PROTOBUF",
}

/**
 * Creates a new schema version and subject by going through the full flow:
 * 1. Opens schema creation workflow
 * 2. Selects schema type
 * 3. Enters schema content
 * 4. Uploads and creates new subject
 * @returns The generated subject name for cleanup
 */
export async function createSchemaVersion(
  page: Page,
  schemaType: SchemaType,
  schemaFile: string,
  subjectName?: string,
): Promise<string> {
  const schemasView = new SchemasView(page);
  await schemasView.clickCreateNewSchema();
  await selectSchemaTypeFromQuickpick(page, schemaType);

  // enter schema content into editor
  const schemaContent: string = loadFixtureFromFile(schemaFile);
  const untitledDocument = new TextDocument(page, "Untitled-1");
  await expect(untitledDocument.locator).toBeVisible();
  await untitledDocument.insertContent(schemaContent);

  await schemasView.clickUploadSchema();

  // select editor/file name in the first quickpick
  await selectCurrentDocumentFromQuickpick(page, "Untitled");
  await selectSchemaTypeFromQuickpick(page, schemaType);

  // select "Create new subject" in the next quickpick
  const subjectQuickpick = new Quickpick(page);
  await expect(subjectQuickpick.locator).toBeVisible();
  const createNewSubjectItem: Locator = subjectQuickpick.items.filter({
    hasText: "Create new subject",
  });
  await expect(createNewSubjectItem).not.toHaveCount(0);
  await createNewSubjectItem.click();

  // enter subject name in the input box and submit
  const subjectInputBox = new InputBox(page);
  await expect(subjectInputBox.input).toBeVisible();
  if (!subjectName) {
    const randomValue: string = Math.random().toString(36).substring(2, 15);
    subjectName = `customer-${randomValue}-value`;
  }
  await subjectInputBox.input.fill(subjectName);
  await subjectInputBox.confirm();

  // clear out and close the untitled document after uploading so we only have one editor open
  // during the rest of the tests'
  await untitledDocument.deleteAll();
  await untitledDocument.close();

  // if we made it this far, we can return the subject so the .afterEach() hook can delete the
  // subject (and schema version) that was just created
  return subjectName;
}

export async function deleteSchemaSubject(
  page: Page,
  electronApp: ElectronApplication,
  subjectName: string,
  deletionConfirmation: string,
) {
  // stub the system dialog (warning modal) that appears when hard-deleting
  // NOTE: "Yes, Hard Delete" is the first button on macOS/Windows, second on Linux
  const confirmButtonIndex = process.platform === "linux" ? 1 : 0;
  await stubMultipleDialogs(electronApp, [
    {
      method: "showMessageBox",
      value: {
        response: confirmButtonIndex, // simulate clicking the "Yes, Hard Delete" button
        checkboxChecked: false,
      },
    },
  ]);

  // find the schema item in the Schemas view
  const schemasView = new SchemasView(page);
  const subjectLocator: Locator = schemasView.subjects.filter({ hasText: subjectName });
  const subjectItem = new SubjectItem(page, subjectLocator.first());
  await subjectItem.locator.scrollIntoViewIfNeeded();
  await expect(subjectItem.locator).toBeVisible();
  await subjectItem.rightClickContextMenuAction("Delete All Schemas in Subject");

  // select the Hard Delete option
  const deletionQuickpick = new Quickpick(page);
  const hardDelete = deletionQuickpick.items.filter({ hasText: "Hard Delete" });
  await expect(hardDelete).not.toHaveCount(0);
  await hardDelete.click();

  // enter the confirmation text input
  const confirmationBox = new InputBox(page);
  await expect(confirmationBox.input).toBeVisible();
  await confirmationBox.input.fill(deletionConfirmation);
  await confirmationBox.confirm();

  // the system dialog is automatically handled by the stub above, no need to handle it here
  const notificationArea = new NotificationArea(page);
  const deletionNotifications = notificationArea.infoNotifications.filter({
    hasText: /hard deleted/,
  });
  await expect(deletionNotifications.first()).toBeVisible();
}

/** Select an item from the document quickpick based on a title to match. */
export async function selectCurrentDocumentFromQuickpick(
  page: Page,
  documentTitle: string,
): Promise<void> {
  const fileQuickpick = new Quickpick(page);
  await expect(fileQuickpick.locator).toBeVisible();
  const currentFileItem: Locator = fileQuickpick.items.filter({ hasText: documentTitle });
  await expect(currentFileItem).not.toHaveCount(0);
  await currentFileItem.click();
}

/** Select a schema type (AVRO/JSON/PROTOBUF) from the schema type quickpick. */
export async function selectSchemaTypeFromQuickpick(
  page: Page,
  schemaType: SchemaType,
): Promise<void> {
  const confirmSchemaTypeQuickpick = new Quickpick(page);
  await expect(confirmSchemaTypeQuickpick.locator).toBeVisible();
  const schemaTypeItem: Locator = confirmSchemaTypeQuickpick.items.filter({
    hasText: schemaType,
  });
  await schemaTypeItem.click();
}

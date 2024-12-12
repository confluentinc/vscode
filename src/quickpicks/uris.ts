import {
  QuickPickItem,
  QuickPickItemKind,
  Tab,
  TabGroup,
  TabInputText,
  TextDocument,
  ThemeIcon,
  Uri,
  window,
  workspace,
} from "vscode";

/** Create a quickpick to list all open editors, as well as an item to select a file from the open
 * dialog. */
export async function uriQuickpick(
  uriSchemes: string[] = [],
  editorLanguageIds: string[] = [],
  fileFilters: { [name: string]: string[] } = {},
): Promise<Uri | undefined> {
  const selectFileLabel = "Open File...";
  const quickpickItems: QuickPickItem[] = [
    {
      label: selectFileLabel,
      iconPath: new ThemeIcon("search"),
      alwaysShow: true,
    },
  ];

  const filenameUriMap: Map<string, Uri> = new Map();

  // inspect *all* open editors, not just the visible/active ones
  const documentPromises: Promise<TextDocument>[] = [];
  window.tabGroups.all.forEach((tabGroup: TabGroup) => {
    tabGroup.tabs.forEach(async (tab: Tab) => {
      // .input is `unknown`, not sure what other properties are available if `uri` isn't there
      if (!(tab.input instanceof TabInputText)) {
        return;
      }
      const tabInput: TabInputText = tab.input as TabInputText;
      if (uriSchemes && !uriSchemes.includes(tabInput.uri.scheme)) {
        // skip URIs that don't match the provided schemes
        return;
      }
      // look up document based on Uri
      documentPromises.push(Promise.resolve(workspace.openTextDocument(tabInput.uri)));
    });
  });

  const documents: TextDocument[] = [];
  const allDocuments: TextDocument[] = await Promise.all(documentPromises);
  allDocuments.forEach((document: TextDocument) => {
    if (
      editorLanguageIds.length === 0 ||
      (editorLanguageIds.length > 0 && editorLanguageIds.includes(document.languageId))
    ) {
      documents.push(document);
      filenameUriMap.set(document.fileName, document.uri);
    }
  });

  let pickedItem: QuickPickItem | undefined;
  if (documents.length > 0) {
    quickpickItems.push({
      kind: QuickPickItemKind.Separator,
      label: "Open documents",
    });
    quickpickItems.push(
      ...documents.map((document: TextDocument) => {
        return {
          label: document.fileName,
          description: document.languageId,
          iconPath: new ThemeIcon("file"),
        };
      }),
    );
    pickedItem = await window.showQuickPick(quickpickItems, {
      placeHolder: "Select a file",
      canPickMany: false,
    });
    // return URI from the selected editor
    if (pickedItem && filenameUriMap.has(pickedItem.label)) {
      return filenameUriMap.get(pickedItem.label);
    }
  }
  // either there are no open editors, or the user selected the "Select a file" option
  if (documents.length === 0 || pickedItem?.label === selectFileLabel) {
    const uri: Uri[] | undefined = await window.showOpenDialog({
      openLabel: "Select a file",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: fileFilters,
    });
    return uri ? uri[0] : undefined;
  }
}

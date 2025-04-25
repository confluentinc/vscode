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

  const currentDocument: TextDocument | undefined = window.activeTextEditor?.document;
  let currentDocumentItem: QuickPickItem | undefined;

  if (
    currentDocument &&
    (!uriSchemes.length || uriSchemes.includes(currentDocument.uri.scheme)) &&
    (!editorLanguageIds.length || editorLanguageIds.includes(currentDocument.languageId))
  ) {
    currentDocumentItem = {
      label: currentDocument.fileName,
      description: `${currentDocument.languageId} (active)`,
      iconPath: new ThemeIcon("file-code"),
      buttons: [{ iconPath: new ThemeIcon("check"), tooltip: "Select this file" }],
    };
    quickpickItems.push(
      {
        kind: QuickPickItemKind.Separator,
        label: "Current document",
      },
      currentDocumentItem,
    );
    filenameUriMap.set(currentDocument.fileName, currentDocument.uri);
  }

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
    if (currentDocument && document.fileName === currentDocument.fileName) {
      return;
    }

    if (
      editorLanguageIds.length === 0 ||
      (editorLanguageIds.length > 0 && editorLanguageIds.includes(document.languageId))
    ) {
      documents.push(document);
      filenameUriMap.set(document.fileName, document.uri);
    }
  });

  const quickPick = window.createQuickPick();
  quickPick.items = quickpickItems;

  if (documents.length > 0) {
    quickPick.items = [
      ...quickPick.items,
      {
        kind: QuickPickItemKind.Separator,
        label: "Other open documents",
      },
      ...documents.map((document: TextDocument) => {
        return {
          label: document.fileName,
          description: document.languageId,
          iconPath: new ThemeIcon("file"),
        };
      }),
    ];
  }

  quickPick.placeholder = "Select a file";

  if (currentDocumentItem) {
    quickPick.activeItems = [currentDocumentItem];
  }

  return new Promise<Uri | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      const selection = quickPick.selectedItems[0];
      quickPick.hide();

      if (selection.label === selectFileLabel) {
        window
          .showOpenDialog({
            openLabel: "Select a file",
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: fileFilters,
          })
          .then((uri) => {
            resolve(uri ? uri[0] : undefined);
          });
      } else if (filenameUriMap.has(selection.label)) {
        resolve(filenameUriMap.get(selection.label));
      } else {
        resolve(undefined);
      }
    });

    quickPick.onDidHide(() => resolve(undefined));
    quickPick.show();
  });
}

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
    let resolved = false;
    let usingFileChooser = false;

    function resolver(uri: Uri | undefined) {
      // Only really resolve once.
      if (!resolved) {
        resolved = true;
        resolve(uri);
      }
    }

    quickPick.onDidAccept(() => {
      const selection = quickPick.selectedItems[0];

      if (selection.label === selectFileLabel) {
        usingFileChooser = true;
        window
          .showOpenDialog({
            openLabel: "Select a file",
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: fileFilters,
          })
          .then((uri) => {
            resolver(uri ? uri[0] : undefined);
          });
      } else if (filenameUriMap.has(selection.label)) {
        resolver(filenameUriMap.get(selection.label));
      } else {
        resolver(undefined);
      }
    });

    quickPick.onDidHide(() => {
      // The call to window.showOpenDialog() as well as any of the resolver() / resolve() calls above
      // will implicitly close the quickpick and cause onDidHide() to fire, but we don't want to resolve
      // or falsely re-resolve our promise in those cases.

      // We only want to resolve in this codepath if the quickpick was escape closed by the user.
      if (!usingFileChooser && !resolved) {
        resolver(undefined);
      }
    });

    // Let the plinko games begin!
    quickPick.show();
  });
}

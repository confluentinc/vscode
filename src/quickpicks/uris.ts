import { QuickPickItem, QuickPickItemKind, TextEditor, ThemeIcon, Uri, window } from "vscode";

/** Create a quickpick to list all open editors, as well as an item to select a file from the open
 * dialog. */
export async function uriQuickpick(
  editorLanguageIds: string[] = [],
  fileFilters: { [name: string]: string[] } = {},
): Promise<Uri | undefined> {
  const selectFileLabel = "Select a file";
  const quickpickItems: QuickPickItem[] = [
    {
      label: selectFileLabel,
      iconPath: new ThemeIcon("search"),
      alwaysShow: true,
    },
  ];

  const filenameUriMap: Map<string, Uri> = new Map();
  // filter open editors by languageId if provided, otherwise show all open editors
  const editors: readonly TextEditor[] = window.visibleTextEditors.filter((editor) =>
    editorLanguageIds ? editorLanguageIds.includes(editor.document.languageId) : true,
  );
  let pickedItem: QuickPickItem | undefined;
  if (editors.length > 0) {
    quickpickItems.push({
      kind: QuickPickItemKind.Separator,
      label: "Open editors",
    });
    quickpickItems.push(
      ...editors.map((editor) => {
        filenameUriMap.set(editor.document.fileName, editor.document.uri);
        return {
          label: editor.document.fileName,
          description: editor.document.languageId,
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
  if (editors.length === 0 || pickedItem?.label === selectFileLabel) {
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

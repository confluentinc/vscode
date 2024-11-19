import { ExtensionContext, ViewColumn } from "vscode";
import { registerCommandWithLogging } from "./commands";
import { WebviewPanelCache } from "./webview-cache";
import connectionFormTemplate from "./webview/direct-connect-form.html";
import { randomUUID } from "crypto";
import { post } from "./webview/direct-connect-form";
import { handleWebviewMessage } from "./webview/comms/comms";
type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

export const registerDirectConnectionCommand = (context: ExtensionContext) => {
  const directConnectionCommand = registerCommandWithLogging("confluent.connections.direct", () =>
    openDirectConnectionForm(),
  );
  context.subscriptions.push(directConnectionCommand);
};

const directConnectWebviewCache = new WebviewPanelCache();

export function openDirectConnectionForm(): void {
  console.log("openDirectConnectionForm");
  // Set up the webview, checking for existing form for this topic
  const [directConnectForm, formExists] = directConnectWebviewCache.findOrCreate(
    { id: randomUUID(), multiple: false, template: connectionFormTemplate },
    "direct-connect-form",
    `New Connection`,
    ViewColumn.One,
    {
      enableScripts: true,
    },
  );

  if (formExists) {
    directConnectForm.reveal();
    return;
  }

  async function testConnect(body: any): Promise<{ success: boolean; message: string | null }> {
    console.log(body);
    throw new Error("Not implemented");
    // if (result.success) {
    //   console.log("success", result);
    //   // this.updateValue(input.name, input.value);
    // } else {
    //   // this.errorMessage(res.message ?? "Unknown error occurred");
    //   // this.revertValue(input.name); // FIXME
    //   // input.classList.add("error");
    //   console.log("error", result);
    // }
    // return result;
  }

  /**
   * on submit
   * save info in VSCODE Storage/state - name/id (generate it)
   * send to backend
   */
  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "ValidateInput": {
        return null satisfies MessageResponse<"ValidateInput">;
      }
      case "TestConnection":
        return (await testConnect(body)) satisfies MessageResponse<"TestConnection">;
      case "Submit":
        return null satisfies MessageResponse<"Submit">;
    }
  };
  const disposable = handleWebviewMessage(directConnectForm.webview, processMessage);
  directConnectForm.onDidDispose(() => disposable.dispose());
}

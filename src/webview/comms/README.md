# How to make WebView talk to the host environment (type)safely?

1. In the module that runs in webview, define a message sending function that receives `type` and
   `body` parameters. It must use `sendWebviewMessage()` to actually send the message and await for
   the response.

   ```ts
   import { sendWebviewMessage } from "./comms/comms";

   export function post(type: any, body: any): Promise<unknown> {
     return sendWebviewMessage(type, body);
   }
   ```

2. Define all necessary message types and corresponding payloads of data that going to be sent to
   the host by using [function overloads][ts-function-overloads].

   ```ts
   export function post(type: "GetPaginatedResult", body: { page: number }): Promise<Data[]>;
   export function post(type: "UpdateConfig", body: { config: SomeConfigType }): Promise<boolean>;
   export function post(type: any, body: any): Promise<unknown> {
     return sendWebviewMessage(type, body);
   }
   ```

   This is now the function that should be used by the rest of webview module to send messages and
   receive corresponding results:

   ```ts
   const result = await post("GetPaginatedResult", { page: 1 });
   // result has type of Data[]
   ```

3. In the module that instantiates the webview, describe a function that computes necessary
   responses or performs desired actions. Use the `post()`'s type definition to guide the input and
   output types of the processing function:

   ```ts
   // preferrably use type import to avoid unnecessary bundling
   import { type post } from "./webviews/the-webview";

   // define some useful utility types, simply copy-paste the following
   type MessageSender = OverloadUnion<typeof post>;
   type MessageResponse<MessageType extends string> = Awaited<
     ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
   >;

   function processMessage(...[type, body]: Parameters<MessageSender>) {
     // type is union of all possible message types
     switch (type) {
       case "GetPaginatedResult": {
         // body has type of { page: number }
         const result = computeSomething(body);
         // assert the result to be of the desired response type
         return result satisfies MessageResponse<"GetPaginatedResult">;
       }
       case "UpdateConfig": {
         // body has type of { config: SomeConfigType }
         const result = computeSomething(body);
         // assert the result to be of the desired response type
         return result satisfies MessageResponse<"UpdateConfig">;
       }
     }
   }
   ```

4. Use `handleWebviewMessage()` to wire up the webiew and processing function

   ```ts
   import { handleWebviewMessage } from "./webview/comms/comms";

   const panel = window.createWebviewPanel(/* ... */);
   const disposable = handleWebviewMessage(panel.webview, processMessage);
   // make sure to dispose the handler when panel is disposed
   ```

[ts-function-overloads]:
  https://www.typescriptlang.org/docs/handbook/2/functions.html#function-overloads

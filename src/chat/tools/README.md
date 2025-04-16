This subdirectory houses the registration and handling of "tools" that can be invoked by the user
(if registered in `package.json`'s `languageModelTools` section with
`canBeReferencedInPrompt: true`) and/or by the language model (if sent as part of `tools` in the
`LanguageModelChatRequestOptions`).

Tools that provide additional context to conversations should return messages via the
`.toolMessage()` method, which will tag an `Assistant` message with the tool name and a `tool` role.
(This is different than the `systemMessage()` function, which wraps a `User` message to provide
non-tool context to the language model.)

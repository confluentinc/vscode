This subdirectory houses the registration and handling of "tools" that can be invoked by the user
(if registered in `package.json`'s `languageModelTools` section with
`canBeReferencedInPrompt: true`) and/or by the language model (if sent as part of `tools` in the
`LanguageModelChatRequestOptions`).

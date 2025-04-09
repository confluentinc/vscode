This is the directory for the Flink SQL language server. It's run as a separate process from the
main extension instance (treated as a language client), and is started at extension activation time.

The language server is responsible for handling the language server protocol (LSP) requests and
responses and uses the [`dt-sql-parser`](https://www.npmjs.com/package/dt-sql-parser) and is
responsible for providing features such as code completion and error/warning diagnostics.

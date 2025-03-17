# Confluent for VS Code

The Confluent extension makes it easy for developers to build stream processing applications using
Confluent technology. This extension provides a robust, delightful experience for
[Confluent Cloud](https://confluent.cloud/) products from within the
[Visual Studio Code](https://code.visualstudio.com/) (VS Code) editor desktop environment.

![](resources/readme-screenshot-light.png)

Visit the [Confluent Developer site](https://developer.confluent.io/) for more about developing with
Confluent, and read the docs at the [Confluent documentation](https://docs.confluent.io/) site.

## Features

Confluent for VS Code provides a number of features for working with your Apache Kafka® compatible 
clusters and Confluent Schema Registry compatible servers.

The extension enables you to:

- [Work with your Confluent Cloud resources](./docs/USAGE.md#work-with-your-confluent-cloud-resources)
- [Bootstrap streaming projects from Confluent-provided templates](./docs/USAGE.md#bootstrap-streaming-projects-from-confluent-provided-templates)
- [Accelerate local development against Kafka and Confluent Schema Registry](./docs/USAGE.md#accelerate-local-development-against-kafka-and-confluent-schema-registry)
- [Browse messages in Kafka topics using Message Viewer](./docs/USAGE.md#browse-messages-in-kafka-topics-using-message-viewer)
- [Produce messages to Kafka topics](./docs/USAGE.md#produce-messages-to-kafka-topics)
- [Explore, create and evolve schemas in Confluent Schema Registry](./docs/USAGE.md#explore-create-and-evolve-schemas-in-confluent-schema-registry)
- [Connect to any Kafka API-compatible cluster and any Confluent Schema Registry compatible server](./docs/USAGE.md#connect-to-any-kafka-compatible-cluster-and-any-confluent-schema-registry-compatible-server)

## Documentation

- For detailed documentation on using the features in the extension, head to [docs/USAGE.md](./docs/USAGE.md).
- For instructions on how to install the extension, including how to install from a VSIX file, head to [docs/INSTALL.md](./docs/INSTALL.md).
<!-- - For troubleshooting, head to [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) -->

## Logs

Once the Confluent extension is activated, you can view extension logs in two separate Output
Channels:

- **Confluent**: logs for the VS Code extension itself
- **Confluent (Sidecar)**: logs from the
  [Sidecar process](https://github.com/confluentinc/ide-sidecar)

## Telemetry

Gathering usage and error data helps Confluent develop a more resilient and user-friendly
application. Confluent enables telemetry only in official production releases. Confluent respects
users' preferences for sending telemetry data -- if you have turned off telemetry in your VS Code
settings, the extension doesn't send any events or data.

### Segment for user actions

The extension uses [Segment](https://segment.com/) to log extension usage. See `telemetry.ts` for
implementation and how it is used in the codebase. The extension sends events when you perform major
actions in the extension, such as using any of the registered commands. This helps Confluent see what
commands are popular and helps to answer other questions about how the extension is used, so
Confluent can make it even more useful.

### Sentry for error tracing

The extension uses [Sentry](https://sentry.io) to capture and analyze errors, which enables more
robust and friendly error debugging. It is the first item initialized in `extension.ts`, so that it
can send any uncaught exceptions globally, and it's invoked in certain catch blocks to send specific
errors. The [@sentry/rollup-plugin](#) is used to upload source maps.

## Additional References

- [Confluent Documentation](https://docs.confluent.io/index.html)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Known Limitations

- Signing out of Confluent Cloud through the browser will also sign you out of the Confluent
  extension.
- Preview links for non-default organizations work only after switching to the non-default
  organization in the Confluent Cloud UI in your browser.
- When using multiple users on a single machine, only one user can run the extension at a time.
- Searching for schemas in the Topics and Schemas views is limited to the `subject` field only.
  Searching by other fields, such as `id` and `version`, is not supported due to cost and
  performance considerations.
- The Message Viewer does not support consuming records that were compressed with `snappy` except
  for Confluent Cloud connections
  ([confluentinc/ide-sidecar#304](https://github.com/confluentinc/ide-sidecar/issues/304)).
- Starting the extension in one IDE (e.g., VS Code) and then starting it in another IDE (e.g. VS
  Code Insiders) will cause conflicts with the sidecar process. The first IDE establishes a
  handshake with the sidecar and stores an access token, while the second IDE attempts to kill the
  existing sidecar process and obtain a new token, resulting in the two different IDEs fighting for
  control. Only one type of IDE can run the extension at a time, though you can still use multiple
  windows/workspaces of the same IDE type.
- The extension has minimum operating system requirements based on the sidecar executable builds:
  - Windows: Windows 10 and above (built on Windows Server 2019)
  - Ubuntu: Ubuntu 20 and above
  - macOS: macOS 13 and above (built on macOS 13.5)
  - Running the extension on older operating systems may result in the sidecar process failing to
    start, which prevents the extension from establishing a successful handshake.

## Support

If you have any questions, comments, or you run into any issues, feel free to post a message in a
GitHub [discussion](https://github.com/confluentinc/vscode/discussions) or create an
[issue](https://github.com/confluentinc/vscode/issues).

For general feedback, fill out and submit the [survey](https://www.surveymonkey.com/r/NYVKQD6).

## Contributing

Follow [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for information on setting up your development
environment, proposing bugfixes and improvements, and building and testing your changes.

See the [Code of Conduct](/CODE_OF_CONDUCT.md) for guidelines on what Confluent expects from
contributors, and what actions will and will not be tolerated.

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE.txt](/LICENSE.txt) for
the full license text.

The LICENSE.txt and NOTICE.txt covers the source code distributions of this project. The LICENSE.txt
and NOTICE-vsix.txt covers the VSIX archive distribution of this project (the VS Code Extension).
The THIRD_PARTY_NOTICES.txt file contains the list of third-party software that is included in the
VSIX archive distribution of this project, along with the full text of applicable licenses.

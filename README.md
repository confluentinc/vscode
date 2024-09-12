# Confluent Extension for VSCode

Our goal for the [Confluent extension for VS Code](https://github.com/confluentinc/vscode) is to
help make it easy for developers to build stream processing applications using Confluent and Apache
Kafka® by creating a robust, delightful experience for [Confluent Cloud](https://confluent.cloud/)
products accessible to developers from within the
[Visual Studio Code](https://code.visualstudio.com/) (VS Code) editor desktop environment.

Visit the [Confluent Developer site](https://developer.confluent.io/) for more about developing with
Confluent.

## Installation

### From the Visual Studio Code Extension Marketplace

Within VS Code: search for "Confluent" in the Extensions sidebar and install the extension in your
editor from there. Or visit the VS Code Marketplace to view, download, and install the
[Confluent extension for VS Code](https://marketplace.visualstudio.com/items?itemName=confluentinc.vscode-confluent).

### From within VS Code

1. Open VS Code.

1. Click [here](vscode://confluentinc.vscode-confluent) to automatically install the extension, or
   follow these steps:

1. In the VS Code sidebar, click **Extensions**.

1. In the **Extensions** view, search for "Confluent".

1. Click **Install**.

### From a `.vsix` file

_As a note: throughout this doc we'll refer to the version of the extension as `x.x.x`. Ensure you
replace this with the actual version number you want to use._

Confluent provides these VSIX files:

- MacOS with Apple Silicon: `vscode-confluent-darwin-arm64-x.x.x.vsix`
- MacOS with Intel processors: `vscode-confluent-darwin-x64-x.x.x.vsix`
- Linux on ARM-64 processors: `vscode-confluent-linux-arm64-x.x.x.vsix`
- Linux on x86 processors: `vscode-confluent-linux-x64-x.x.x.vsix`

Currently, Windows is not supported, but you can use Windows Subsystem for Linux
[WSL](https://learn.microsoft.com/en-us/windows/wsl/install) with one of the above Linux .vsix
files.

> The Confluent VS Code extension is available for Early Access, and some Confluent features may not
> be available. Consider installing the
> [Confluent CLI](https://docs.confluent.io/confluent-cli/current/overview.html) to access all
> features of Confluent Cloud.

You can install the Confluent extension by using the VS Code UI or by using the
`code --install-extension` command in the terminal.

To install in the terminal, run the following command.

```
code --install-extension /path/to/vscode-confluent-vX.X.X.vsix
```

To install by using the UI, follow these steps.

1. Download the VSIX file appropriate for your machine.

1. Open VS Code, and in the Sidebar, click **Extensions**.

1. At the top of the **Extensions** view, click **...**, and in the context menu, click **Install
   from VSIX…**

1. Navigate to your downloaded `vscode-confluent-vX.X.X.vsix` file and click **Install**.

## Features

The Confluent VS Code Extension provides a number of features for working with your Kafka clusters,
topics and schemas.

### Command Palette

Most of the Confluent extension features are available in the VS Code Command Palette. Press
`Cmd+Shift+P` and type "confluent" to show the Confluent extension commands.

Some commands are associated with view actions, which are the simple buttons (usually icons) next to
items in the Sidebar. For example, **play** (open message viewer), **sync** (refresh), and
**ellipsis** (extra actions) are all view actions associated with commands available in the command
palette.

### Sidebar

In the Sidebar, click the Confluent logo to open the extension and show the following sections.

#### Resources

The **Resources** tab lists Confluent Cloud environments and associated Kafka and Schema Registry
clusters, as well as local Kafka clusters.

- Click a cluster name to load the topics created in that cluster in the Topics panel.
- Click the Schema Registry cluster name to load the associated schemas for that registry in the
  Schemas panel.

#### Topics

Click the **play** icon next to the topic name to open the **Message Viewer**, which enables
searching and exploring messages in a topic. You can page through and search for specific values
within the list of all the messages. Double-click a single message to explore its entire payload
encoded into JSON. The message stream is pausable and can be resumed at any time.

#### Schemas

The **Schemas** panel displays all the schemas available for the current Confluent Cloud
environment's Schema Registry. Schemas are also shown in the **Topics** panel if they match the
`TopicNameStrategy`. Double-click a schema to open it in VS Code and explore it.

> Currently, any changes you make to the schema are not saved.

#### Support

The **Support** panel provides links to the extension walkthrough and options to generate Kafka
projects using a template.

## Outputs

Once the Confluent extension is activated, you can view extension outputs in three separate Output
Channels:

- **Confluent**: logs for the VS Code extension itself
- **Confluent Extension->Sidecar Request/Response**: logs of the communication between the extension
  and the Sidecar
- **Confluent (Sidecar)**: logs from the Sidecar

## Connect to your streams

The Confluent extension for VS Code supports accessing your Apache Kafka® clusters locally or on
Confluent Cloud.

- To start a local Kafka cluster,
  [install the Confluent CLI](https://docs.confluent.io/confluent-cli/current/overview.html) and run
  the
  [`confluent local kafka start` command](https://docs.confluent.io/confluent-cli/current/command-reference/local/kafka/confluent_local_kafka_start.html).
- If you're working on Confluent Cloud, open the Confluent extension and click **Connect to
  Confluent Cloud** or go to the VS Code Accounts menu and click "Sign in with Confluent Cloud to
  use Confluent". ![](resources/walkthrough/connect.png)

## Telemetry

Gathering usage and error data helps us develop a more resilient and user friendly application. We
only enable telemetry in official production releases. We respect users' preferences for sending
telemetry data -- if a user has turned off telemetry in their VSCode settings, we skip sending any
events or data.

### Segment for user actions

We're using [Segment](https://segment.com/) to log extension usage. See `telemetry.ts` for
implementation & how it is used in the codebase. We send events when a user performs major actions
in the extention, such as using any of the registerd commands. This will help us see what commands
are popular, as well as answer other questions about how the extention is used so that we can make
it even more useful.

### Sentry for error tracing

We use [Sentry](https://sentry.io) to capture and analyze errors, in order to enable more robust and
developer friendly error debugging. It is the first item initialized in `extension.ts` so that it
can send any uncaught exceptions globally, and is invoked in certain catch blocks to send specific
errors. The [@sentry/rollup-plugin](#) is used to upload source maps.

## Additional References

- [Confluent Documentation](https://docs.confluent.io/index.html)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Support

If you have any questions, comments, and/or run into any issues, feel free to post a message in a
GitHub [discussion](https://github.com/confluentinc/vscode/discussions) or create an
[issue](https://github.com/confluentinc/vscode/issues).

For general feedback, please fill out and submit our
[survey](https://www.surveymonkey.com/r/NYVKQD6).

## Contributing

Follow [CONTRIBUTING.md](/CONTRIBUTING.md) to for information on setting up your development
environment, how to propose bugfixes and improvements, and how to build and test your changes.

See our [Code of Conduct](/CODE_OF_CONDUCT.md) for guidelines on what we expect from participants,
and what actions will and will not be tolerated.

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE.txt](/LICENSE.txt) for
the full license text.

The LICENSE.txt and NOTICE.txt covers the source code distributions of this project. The LICENSE.txt
and NOTICE-vsix.txt covers the VSIX archive distribution of this project (the VS Code Extension).
The THIRD_PARTY_NOTICES.txt file contains the list of third-party software that is included in the
VSIX archive distribution of this project, along with the full text of applicable licenses.

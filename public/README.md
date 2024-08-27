# Confluent VS Code Extension

The Confluent VS Code Extension is a tool for interacting with Confluent streams and resources,
enabling easier development with Apache Kafka®.

## Installation

_As a note: throughout this doc we'll refer to the version of the extension as `x.x.x`. Ensure you
replace this with the actual version number you want to use._

Confluent provides these VSIX files:

- MacOS with Apple Silicon: `vscode-confluent-darwin-arm64-x.x.x.vsix`
- MacOS with Intel processors: `vscode-confluent-darwin-x64-x.x.x.vsix`
- Linux on ARM-64 processors: `vscode-confluent-linux-arm64-x.x.x.vsix`
- Linux on x86 processors: `vscode-confluent-linux-x64-x.x.x.vsix`

Currently, Windows is not supported, but you can use Windows Subsystem for Linux
[WSL](https://learn.microsoft.com/en-us/windows/wsl/install).

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

## Connect to your streams

The Confluent VS Code extension supports accessing your Apache Kafka® clusters locally or on
Confluent Cloud.

- To start a local Kafka cluster,
  [install the Confluent CLI](https://docs.confluent.io/confluent-cli/current/overview.html)
  and run the [`confluent local kafka start` command](https://docs.confluent.io/confluent-cli/current/command-reference/local/kafka/confluent_local_kafka_start.html).
- If you're working on Confluent Cloud, open the Confluent extension and click **Log in to
  Confluent**.


## Known Limitations

- Confluent Cloud connections require reauthenticating after four hours, and you will be prompted to reauthenticate.
- Windows OS is not yet supported. None of the VSIX files can be installed into VS Code on Windows.
- Uncaught Errors and Exceptions are anonymously reported to Sentry ignoring VSCode's telemetry settings. The setting will be respected in the near future.
- Authenticating with Confluent Cloud using the Safari browser works only if the CCloud organization is set up to use SSO, and will not work when authenticating with a username and password. If authentication fails using Safari, please try authentication with another browser.
- Message Viewer is not able to correctly show messages with schemas in a Confluent Local Kafka cluster. This works when the topics are in Confluent Cloud.

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

## Status Bar

The Confluent extension status bar shows the context of the Confluent Cloud connection and local
Kafka cluster broker information. Click the status bar to focus on the Connections panel, where you
can add a new Confluent Cloud connection, switch to a different Confluent Cloud connection, or
select the local connection.

## Recommended VS Code Extensions

Consider installing the following VS Code extensions when using the EA Confluent VS Code Extension.

- protobuf support
- avro tools

## Uninstall the Confluent VS Code Extension

To install a different version of the extension from a .vsix file or uninstall it entirely, go to
the **Extensions** section of the Sidebar and scroll to find the existing Confluent extension, then
right-click and select **Uninstall**.

> Until the extension is available in the marketplace, searching and filtering will not work. You
> must scroll manually through the Extensions list to find the Confluent extension.

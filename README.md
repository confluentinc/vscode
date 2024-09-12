# Confluent Extension for VSCode

![Release](release.svg)

The [Confluent extension for VS Code](https://github.com/confluentinc/vscode) makes it easy
for developers to build stream processing applications using Confluent technology. This extension
provides a robust, delightful experience for Confluent Cloud products from within the
[Visual Studio Code](https://code.visualstudio.com/) editor desktop environment.

Visit the [Confluent Developer site](https://developer.confluent.io/) for more about developing with
Confluent, and read the docs at the [Confluent documentation](docs.confluent.io) site.

## Installation in VSCode

Within VS Code: In the Extensions sidebar, search for "Confluent", and install the extension in your
editor from there. Or visit the
[Visual Studio Code Marketplace online](https://marketplace.visualstudio.com/vscode) to view,
download, and install the extension.

## Extension Settings

This extension exposes the following settings (see `contributes.configuration` in `package.json`):

- `confluent.debugging.showSidecarExceptions`: Whether or not to show notifications for errors
  detected while tailing sidecar process logs.

You can see these by going to the extension settings directly inside VS Code.

## Telemetry

Gathering usage and error data helps Confluent develop a more resilient and user friendly application.
We enable telemetry only in official production releases. Confluent respect your preferences for sending
telemetry data -- if you turn off telemetry in your VS Code settings, Confluent doesn't send any
events or data.

### Segment for user actions

The extension uses [Segment](https://segment.com/) to log extension usage. See `telemetry.ts` for
implementation and how it is used in the codebase. The extension sends events when you perform major
actions in the extension, such as using any of the registerd commands. This helps Confluent see what
commands are popular and helps to answer other questions about how the extension is used, so Confluent
can make it even more useful.

### Sentry for error tracing

The extension uses [Sentry](https://sentry.io) to capture and analyze errors, which enables more robust
and friendly error debugging. It is the first item initialized in `extension.ts`, so that it
can send any uncaught exceptions globally, and it's invoked in certain catch blocks to send specific
errors. The [@sentry/rollup-plugin](#) is used to upload source maps.

## Additional References

- [Confluent Documentation](https://docs.confluent.io/index.html)
- [VSCode Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Support

If you have any questions, comments, or you run into any issues, feel free to post a message in
GitHub discussion [MAYBE? TODO needs update with actual instructions] or create an issue on the
repo.

## Contributing

Follow [CONTRIBUTING.md](/CONTRIBUTING.md) for information on setting up your development
environment, proposing bugfixes and improvements, and building and testing your changes.

See our [Code of Conduct](/CODE_OF_CONDUCT.md) for guidelines on what Confluent expect from
participants, and what actions will and will not be tolerated.

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE.txt](/LICENSE.txt) for
the full license text.

The LICENSE.txt and NOTICE.txt covers the source code distributions of this project. The LICENSE.txt
and NOTICE-vsix.txt covers the VSIX archive distribution of this project (the VS Code Extension).
The THIRD_PARTY_NOTICES.txt file contains the list of third-party software that is included in the
VSIX archive distribution of this project, along with the full text of applicable licenses.

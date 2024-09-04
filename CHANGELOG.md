# Change Log

All notable changes to this extension will be documented in this file.

## Unreleased

### Fixed
- Detect and warn the user if the wrong os/architecture sidecar is installed (as from manual download of wrong vsix file).

## 0.14.1

### Fixed

- Switching Confluent Cloud organizations now properly resets the Topics and Schemas views' focused clusters (Kafka and Schema Registry, respectively).
- Selecting different Schema Registry clusters to update the Schemas view now correctly shows associated actions and empty state text/buttons.

## 0.14.0

### Added

- Dedicated authentication provider to allow users to connect to Confluent Cloud the same way they
  may connect to other extensions' authentication providers in VS Code through the "Accounts" menu.
- Logs are now visible in the "Confluent" output channel and show the time, log level, logger name,
  and log contents. This can be accessed by opening the bottom panel and selecting the "Confluent"
  output channel, or by running the `Confluent: Show Output Channel` command.
- Right-click actions on Confluent/Kafka resources to easily copy their IDs, names (if applicable),
  and URLs (if applicable) to the clipboard.
- Text search fields in Message Viewer that works along with partition filter providing intersection
  of filtered results. This first iteration of text search is case sensitive and substring-only
  (i.e. no "exact" value matching).
- Button to open currently consumed messages as a JSON file.

### Changed

- Multi-workspace operation improved. Having three or more workspaces with the extension activated
  may encounter 429 responses from CCLoud via sidecar, which will be mitigated in the near future.
- If we notice are running inside of WSL, then hint sidecar to bind to 0.0.0.0 instead of 127.0.0.1
  so as to make it possible for Windows-side browsers to complete the OAuth flow. It is expected
  that the port will still be protected by the Windows firewall.
- The Resources view's "Confluent Cloud" item now shows the current organization name in the
  subtitle, and no longer shows the "Change Connection" item (as this is now handled by the
  authentication provider).

### Removed

- The status bar listing connection status to Confluent Cloud and `confluent-local` Kafka. (CCloud
  connection is now managed by the authentication provider.)

## 0.13.0

### Added

- Links to the CCloud pages for environments, clusters, topics, and schema registries.

### Changed

- Use an adaptive strategy for polling connection state from the sidecar. Should reduce CCloud rate
  limiting issues.

## 0.12.0

### Added

- "Delete Topic" functionality, available by right-clicking on a top-level (topic) item in the
  Topics view
- "Confluent Cloud" item in the Resources view for quick access to logging in, changing connections,
  and changing Confluent Cloud organizations (also newly-added)

### Changed

- UX improvements to the project generation forms, including better labels & help text
- Items in the sidebar (Resources/Topics/Schemas views) now have more consistent icon colors

## 0.11.0

Early access release of the extension.

### Added

- Browser-based authentication with Confluent Cloud (CCloud)
- Listing CCloud environments, Kafka clusters, and Schema Registry clusters in the Resources view
- Viewing `confluent-local` Kafka cluster(s) in the Resources view
- Ability to click on a Kafka cluster (CCloud or Local) in the Resources view to list topics in the
  Topics view
  - Message viewer for consuming messages from a topic
- Ability to click on a Schema Registry cluster in the Resources view to list schemas in the Schemas
  view
  - Read-only schema definition viewer
- Feedback and issue form links from the Support view
- Project file generation for scaffolding new Kafka applications

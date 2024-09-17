# Change Log

All notable changes to this extension will be documented in this file.

## Unreleased

### Added

- Add Windows x64 support

### Changed

- Rely on the resource manager / workspace storage cache for topics within a cluster. Selecting a kafka cluster will consult this cache before opting to deep-fetch from sidecar (and then it cascading through to CCloud or local kafka rest). The 'refresh' button in the topics view title bar can be used to force a deep fetch. Creating or deleting a topic will also result in a deep fetch.

## 0.15.2

### Fixed

- "ExtensionContext not set yet" error during extension activation
- "View in Confluent Cloud" action appears on CCloud topics in the Topics view as expected

## 0.15.1

### Added

- Status labels and icons in the main Message Viewer area to indicate any error scenarios (e.g.
  connection issues, rate limiting, etc.)

### Changed

- Errors listing topics in the Topics view after selecting a Kafka cluster will now be more
  informative
- Repo-level README and Marketplace README have been consolidated into a single README
- Minor updates to the `package.json` description/keywords

## 0.15.0

### Added

- Hold `Shift` key while selecting time range on histogram to make the range snap to histogram bins

### Changed

- Tooltips over items in the Resources, Topics, and Schemas views have been overhauled for a cleaner
  look and more informative content

### Fixed

- Detect and warn the user if the wrong os/architecture sidecar is installed (as from manual
  download of wrong vsix file).
- If the user's Confluent Cloud connection expires, the sidebar (Resources, Topics, and Schemas
  views) will clear out as expected.
- We are now checking authorized operations for Confluent Cloud resources and providing more
  informative notifications:
  - Error notifications if the user is not authorized to delete a topic, or create topics for a
    Kafka cluster
  - Warning notification if the user can't access schemas when opening Message Viewer from a topic
    (which can be disabled via the `confluent.cloud.messageViewer.showSchemaWarningNotifications`
    setting)
- Project Generation form will remember values entered if user hides tab and comes back
- Fetch authz on existing topics in a cluster up front, offer the consume or delete operations
  conditionally based on those permitted operations.

## 0.14.1

### Fixed

- Switching Confluent Cloud organizations now properly resets the Topics and Schemas views' focused
  clusters (Kafka and Schema Registry, respectively).
- Selecting different Schema Registry clusters to update the Schemas view now correctly shows
  associated actions and empty state text/buttons.

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

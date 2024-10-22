# Change Log

All notable changes to this extension will be documented in this file.

## Unreleased

### Added

- "Open Settings" command to quickly access the Confluent for VS Code extension settings.

### Changed

- Topic -> Schema correlation now recognizes schemas using `TopicRecordNameStrategy` in addition to
  `TopicNameStrategy`, [issue #298](https://github.com/confluentinc/vscode/issues/298).

## 0.18.2

### Changed

- Updated the sidecar version to better support SSL configurations for Windows users.

## 0.18.1

- "Show Sidecar Output Channel" command for direct access to the sidecar logs via the Output panel.
- Additional logging and error handling during Confluent Cloud resource loading after successful
  authentication.

## 0.18.0

### Added

- New context menu item "View Latest Schema Version(s)" to quickly open the highest versioned value
  and / or key schemas for a CCloud topic, based on TopicNameStrategy,
  [issue #261](https://github.com/confluentinc/vscode/issues/261).
- New context menu item "Show Latest Changes" attached to schema registry schema subject groups
  having more than one version of the schema. Opens up a diff view between the current and prior
  versions, [issue #354](https://github.com/confluentinc/vscode/issues/354).
- A new Docker event listener will automatically refresh the Resources view when a `confluent-local`
  (Kafka broker) container starts or stops.
  [issue #260](https://github.com/confluentinc/vscode/issues/260)

### Changed

- Do not error log when the sidecar 404s either the local or ccloud connection. This is expected to
  happen, [issue #358](https://github.com/confluentinc/vscode/issues/358).

## 0.17.1

- Hardened handling of empty bins in the histogram of the message viewer

## 0.17.0

### Added

- New context menu item "Copy Organization ID" for the logged-in "Confluent Cloud" resource,
  [issue #213](https://github.com/confluentinc/vscode/issues/213).
- Users can now provide custom SSL certificates in the extension settings (Confluent -> SSL -> Pem
  Paths) for authenticating with Confluent Cloud. This is useful for users whose machines are behind
  a corporate firewall or a VPC configuration that requires custom SSL certificates. Please note
  that automatic use of certificates from Trust Store to alleviate the need for custom SSL
  certificates is scheduled for a
  [future release](https://github.com/confluentinc/ide-sidecar/issues/69).
- Added a new extension setting for disabling SSL server certificate verification on any HTTPS
  requests made by the extension. WARNING: Using this setting is not recommended as it may allow a
  Man-in-the-Middle attack. It should only be used to diagnose SSL problems or to temporarily work
  around a known certificate issue.

### Changed

- Use cached information to populate the Resources view Confluent Cloud single environment children,
  [issue #254](https://github.com/confluentinc/vscode/issues/254).
- Integrate and synchronize use of cached schemas information between Topics and Schemas views,
  [issue #214](https://github.com/confluentinc/vscode/issues/214).

### Fixed

- Hardened improper sidecar process id handling edge case when currently running sidecar is the
  wrong version and is also configured to be in internal development mode,
  [issue #216](https://github.com/confluentinc/vscode/issues/216).
- Unified the loading of common CCloud resources backing the Resources and Topics panels, improving
  performance and consistency, [issue #147](https://github.com/confluentinc/vscode/issues/147).
- Remove toggle from empty CCloud clusters in Resources view,
  [issue #208](https://github.com/confluentinc/vscode/issues/208).

## 0.16.3

### Fixed

- [Windows] Schema definitions and diff views will now appear as expected in the editor area.

## 0.16.2

### Fixed

- Updated sidecar version to include a fix for the Flink Table API (Java) project template

## 0.16.1

### Fixed

- Opening a new window/workspace after connecting to CCloud will now show the correct states in the
  Topics & Schemas views instead of the "Connect to Confluent Cloud" button

## 0.16.0

### Added

- Add Windows x64 support
- Message Viewer can be opened directly through the command palette.

### Changed

- Implemented caching when loading topics into the Topics view for the first time to improve
  performance. Manually refreshing the view or creating/deleting a topic will re-fetch topics and
  not rely on the cache.

## 0.15.3

### Fixed

- Updated sidecar version to include a fix for the Flink Table API (Java) project template

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
  may encounter 429 responses from CCloud via sidecar, which will be mitigated in the near future.
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

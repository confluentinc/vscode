# Change Log

All notable changes to this extension will be documented in this file.

## Unreleased

### Added

- Configurable default settings for `compute pool` and `database` for FlinkSQL operations

## 1.2.0

### Added

- Clicking / selecting a Flink statement will open its SQL statement in a read-only document.
- Flink statement view now offers a 'reload' action to force a refresh of the statements from the
  displayed environment or compute cluster context.
- New actions in the context (right-click) menu for Kafka Clusters & Topics to generate a new
  project. The project generation form will still be opened, and known form fields will be filled in
  automatically for the clicked resource.
- "View in Confluent Cloud" item added to ccloud-based subjects (previously only available on
  individual schemas).
- Error notifications if CCloud TLS/SSL settings fail to sync with the sidecar process.

### Changed

- When deleting a subject containing a single schema, use the simpler confirmation flow for deleting
  a single schema.
- Bumped the minimum required version of VS Code from
  [`1.87.0`](https://code.visualstudio.com/updates/v1_87) to
  [`1.97.0`](https://code.visualstudio.com/updates/v1_97) to help development efforts and integrate
  with newer VS Code APIs.

## 1.1.2

### Fixed

- The LaunchDarkly client will now use the Node SDK instead of the Electron SDK for remote
  environments, which previously prevented the extension from activating properly.

## 1.1.1

### Fixed

- Consult the list of _workspace_ open files when submitting schema documents, not the list of
  _window_ open editors, #1429. The user may have chosen an untitled document from a window distinct
  from the one they have the extension open in.
- Work around if `os.tmpdir()` ends up not being writeable by trying other probable locations. A
  writeable temp directory is needed for the sidecar logs.

## 1.1.0

### Added

- Initial LaunchDarkly integration for feature flag support
- New "Delete Schema Version" context menu action for schemas to drive either soft or hard deletions
  of single schema versions. If the final schema within a subject is deleted, the subject will no
  longer exist.
- New "Delete All Schemas in Subject" context menu action for subjects to drive either soft or hard
  deletions of all schema versions within a subject. The subject will no longer exist.
- Unsaved file contents can now be used for schema upload or message producing actions without the
  need to save the file first.
- Preview setting to enable/disable Flink resources' and associated actions' visibility, including:
  - CCloud Flink compute pools in the Resources view
- Experimental setting to enable/disable the Confluent chat participant for Copilot chat
- Support for diffing schema definitions and Kafka topic message documents from the editor title or
  right-click context areas
- New status bar item to show the current CCloud status from https://status.confluent.cloud/

### Fixed

- Improved resolving newly created direct connection connectivity state.
- Expanded maximum length of direct connection usernames and API keys, from 64 to 96 characters.
  Should improve WarpStream compatibility.

## 1.0.2

### Fixed

- Fixed an issue where the extension would fail to sync CCloud authentication related user settings
  to the sidecar process when updating the extension.

## 1.0.1

### Fixed

- Fixed an issue where the Topics and Schemas views would refresh too often, causing unintended
  behavior when calling various topic/schema actions.

## 1.0.0

### Added

- On the connections form, add WarpStream to the list of supported platforms and add a text box for
  users to specify Other platform used.
- Support for the following authentication types were added for Kafka Cluster connections
  - SASL/OAUTHBEARER
  - SASL/GSSAPI

### Changed

- Any "direct" connections with a failing configuration will now show a red "warning" icon (⚠️)
  instead of the red "error" icon.
- Schema registry subjects are now cached, reducing round trips to a schema registry. Use the
  'reload' button in the Schemas view to force refresh.
- Users who reset their password during the CCloud authentication flow will now be prompted to
  re-authenticate.
- "View Messages" and "Send Message(s)" icons have been updated for better visibility and
  accessibility.
- Errors encountered while producing messages to a topic have been improved:
  - Schema validation errors will now highlight problematic message content in the Problems panel
    for easier troubleshooting.
  - Non-validation errors are aggregated and summarized in the error notification.

### Fixed

- Clicking "View Message(s)" after producing to a topic will no longer attempt to stringify
  non-primitive values in the message payload.

## 0.26.1

### Added

- Additional logging and telemetry for any issues with the sidecar process starting up to help
  diagnose issues with the extension.

## 0.26.0

### Added

- Users can configure advanced SSL settings in the connections form, enabling mTLS or custom
  keystore and truststore settings
- Ability to export and import connection details as JSON files, for easier connection creation and
  sharing
- SASL/SCRAM authentication type is now supported for Kafka Cluster connections that are added via
  the connections form
- Previewed message contents from Message Viewer now include additional metadata about the key
  and/or value schema that may have been used for deserialization.

### Fixed

- Logging out of CCloud resets the Topics and/or Schema Registry views if and only if they were
  focused on CCloud-based broker or schema registry.
- Stopping a local Schema Registry container with a custom image tag will now use the correct tag
  instead of "latest".
- Extension log file rotation is now implemented, with a cleanup process to remove older log files
  that haven't been modified in 3+ days.

### Changed

- No longer calls the semi-documented Schema Registry route `GET /schemas`. Subject and schema
  fetching done through `GET /subjects`, `GET /subjects/<subject>/versions`, and
  `GET /subjects/{subject}/versions/{version}` routes. Should now be compatible with WarpStream
  schema registry.
- Updated icons for opening Message Viewer and producing messages to a topic.
- Producing messages to a topic now offers options to include schema information through a series of
  quickpicks based on user settings.
- The `confluent.preview.enableProduceMessages` setting has been removed, making message-produce
  functionality on Kafka topics available by default.

## 0.25.0

### Added

- Progress indicator when producing large batches of messages to Kafka topics to improve visibility
  of long-running operations.
- Search functionality (via `ctrl+f`/`cmd+f` or by clicking on the magnifying glass) when one of the
  main views is in focus:
  - Resources view: search by any label or description of visible environments, Kafka clusters, and
    Schema Registries
  - Topics view: search by topic name or schema subject (if applicable)
  - Schemas view: search by schema subject

### Changed

- Matching topics to schemas now based on the result of the `GET /subjects` route results. First
  step of migrating away from use of the `GET /schemas` schema registry route, not implemented by
  all schema registries.
- Quickpick for schema registry subject names (i.e. when uploading a new schema) now based off of
  `GET /subjects` route results.
- Message Viewer's "Open consumed messages as JSON" feature now opens messages in a read-only
  document, which can be used to produce messages to other topics.
- Improved logging in the "Confluent (Sidecar)" output channel by implementing the
  `LogOutputChannel` API. When using VS Code 1.97 or higher, these logs can now be combined with the
  "Confluent" output channel for unified log viewing.
- Updated the URL templates for viewing schemas and schema registries in CCloud (now under
  "stream-governance/schema-registry/data-contracts")

### Fixed

- Give the sidecar more time to start up, log more sidecar startup errors into sentry.
- Now message viewer is able to consume messages whose key or value schemas use an AVRO schema which
  specifies a non-record structure as the toplevel entity, such as an AVRO long, string, or enum.
- Copying Kafka cluster bootstrap server(s) to clipboard now omits any `<protocol>://` prefixes.

## 0.24.4

### Fixed

- Updated workspace state storage to use stringified data after a breaking change in VS Code 1.97
  that prevents storing `Map` objects directly.

## 0.24.3

### Fixed

- Sidecar update to address an issue where requests to a Confluent Cloud Schema Registry with SSL
  were failing.

## 0.24.2

### Added

- Additional logging and error-handling for issues preventing the Topics view from loading topics
  from a Kafka cluster and/or associated schemas from a Schema Registry.

## 0.24.1

(Fixed issue with CI process. No user-facing changes.)

## 0.24.0

### Added

- Producing (schemaless) messages to a Kafka topic has been expanded to support:
  - loading message content from an unsaved editor or Message Viewer preview tab
  - providing basic JSON validation for message content
  - passing `partition_id` and `timestamp` as optional fields in the message payload
  - multiple message production to a topic in a single action
- "Sign Out" action in the Resources view for the current Confluent Cloud connection.
- Error notifications and additional tooltip information are now shown for direct connections to
  Kafka and Schema Registry if either (or both) of the connections are not usable.
- Client-side validation for project scaffolding forms.
- Basic initial support for non-`vscode` URI callbacks during the Confluent Cloud sign-in flow.

### Changed

- CCloud and direct connection status changes are now handled via websocket events pushed from the
  sidecar instead of relying on HTTP polling. (Local connection status changes continue to be
  handled through Docker system events.)
- Generating projects from templates now uses the Confluent Cloud scaffolding service, which
  requires an internet connection.
- Empty states in the Topics and Schemas views now provide links to create direct connections to
  Kafka and/or Schema Registry.

### Fixed

- Extension/sidecar logs and the support zip can now be saved as expected on Windows.
- CCloud auth sessions will now show the pre-expiration warning and post-expiration error
  notifications as expected.

## 0.23.3

### Fixed

- Topics and Schemas views' empty states should now correctly indicate when a Kafka cluster or
  Schema Registry is available through a direct connection.
- Clicking "Add New Connection" from the Resources view will now always open the connection form
  correctly, regardless of the current state of the Resources view.
- When setting up a new "Confluent Cloud"-type direct connection, the API key/secret fields under
  the Kafka cluster config are no longer required to be filled out if only connecting to a Schema
  Registry instance.

## 0.23.2

(The specified sidecar version did not have an associated Windows executable to build the VSIX with.
Again, no user-facing changes.)

## 0.23.1

(Fixed issue with Windows builds in CI process. No user-facing changes.)

## 0.23.0

### Added

- Produce message button and commmand enabling schemaless production of JSON messages
- "Direct" connections in the Resources view will provide more information when unable to connect to
  Kafka and/or Schema Registry
- Storage migration for any previously-created "direct" connections to include `ssl` defaults based
  on whether or not they were set to "Confluent Cloud" connections.

### Changed

- Schema upload actions are now available in the Schemas view, as well as any Schema Registry shown
  in the Resources view. Schemas can also now be uploaded from an editor without needing to save to
  a file first.
- Clicking a schema item in the Topics/Schemas view will now open the schema definition in a
  read-only document without needing to click on the "View Schema" action.
- Connecting directly to Kafka and/or Schema Registry is now available from the navigation area of
  the Resources view, and the connections will now appear at the top level of the Resources view,
  with icons to indicate the type of connection chosen in the form.
- Double-clicking on an event/message row in the topic message viewer will now open a read-only
  (preview) document with the message content.
- Functionality to connect directly to Kafka and/or Schema Registry is now available by default, and
  the associated "preview" setting has been removed.

### Fixed

- Waiting for "direct" connections (to Kafka and/or Schema Registry) to be usable will no longer
  block loading other items or interacting with the Resources view.
- Handle errors when setting up the sidecar logs tailing output channel. Clean up the log tailing
  when disposing of the sidecar manager.

## 0.22.1

- Additional information is now provided when attempting to start/stop local resources and the
  extension cannot communcate with the Docker engine API if the new `http.fetchAdditionalSupport`
  setting is enabled.

## 0.22.0

### Added

- Ability to update basic topic configuration fields via webform
- Local Resources: the Docker image tag used to start a Schema Registry container is now
  configurable via the extension settings.
- Can now "evolve" the highest versioned schema within a subject group viewed within the schema
  registry view. Use the '+' icon next to either the subject group entry or the highest versioned
  schema row within the group to download the schema into a new editor. Add or remove columns, etc.,
  then use the existing 'cloud upload' icon in the editor's top bar to start the process to submit
  it back to the schema registry.
- "Preview" settings to opt into upcoming functionality as it's being developed:
  - Connecting directly to Kafka clusters and/or Schema Registries.
  - Producing messages to a Kafka topic.
- "Create new schema" invitation button from the empty state of a schema registry.

### Fixed

- Correct schema upload success message when the uploaded schema was normalized to a preexisting
  version which wasn't the most recent existing version for the subject,
  [issue #642](https://github.com/confluentinc/vscode/issues/642).
- Fix possible race conditions in workspace state cache management when needing to read and mutate
  existing workspace state keys, [issue #534](https://github.com/confluentinc/vscode/issues/534).
- Improve auto-refreshing the schema view controller when uploading a schema to the viewed registry,
  [issue #640](https://github.com/confluentinc/vscode/issues/640).
- Toggling the collapsible states of the top-level items in the Resources view and refreshing the
  view will no longer reset those collapsible states.
  [issue #681](https://github.com/confluentinc/vscode/issues/681)

## 0.21.2

### Fixed

- Reauthenticating with CCloud and immediately clicking on items/actions in the sidebar will no
  longer appear to (temporarily) invalidate the CCloud session.

## 0.21.1

### Added

- Documentation in the README for uploading new/updated schemas to local and Confluent Cloud Schema
  Registry instances.

### Changed

- (Updated telemetry configs, no user-facing changes.)

## 0.21.0

### Added

- Create new schemas + subjects or new versions of existing schemas. Editor buffer titlebar "cloud
  upload" icon button drives the process given a file with extension ".avsc" (Avro Schema), ".proto"
  (Protobuf), or ".json" (JSON schema),
  [issue #388](https://github.com/confluentinc/vscode/issues/388).
- "Start Local Resources" / "Stop Local Resources" functionality to start and stop Confluent's Kafka
  and Schema Registry containers via Docker engine API integration, available as actions on the
  "Local" item in the Resources view, as well as the command palette.
- Ability to create shareable, reusable links to Message Viewer for outside of VS Code or picking up
  where you left off.

### Fixed

- Updating the extension while it is active should no longer require reloading VS Code to avoid
  "already registered"-related errors from appearing (on extension reactivation). (Note: this will
  not be visible when updating from <0.20.x to this release, but will be visible in future updates.)
  [#476](https://github.com/confluentinc/vscode/issues/476)
  [#520](https://github.com/confluentinc/vscode/issues/520)
- When a CCloud connection expires, the extension will now properly clear the views in the sidebar,
  and the associated error notification's "Log in to Confluent Cloud" button will now work as
  expected. [#565](https://github.com/confluentinc/vscode/issues/565)

## 0.20.2

(Reduced telemetry configs, no user-facing changes.)

## 0.20.1

### Fixed

- An error notification is now shown if the wrong extension version is installed based on the
  platform and/or architecture. [issue #317](https://github.com/confluentinc/vscode/issues/317)
- The consume mode dropdown and timestamp values in the Message Viewer will no longer reset when
  switching between Message Viewer tabs.

## 0.20.0

### Added

- "Open Settings" command to quickly access the Confluent for VS Code extension settings.
- "Copy URI" context menu item for CCloud Schema Registry items and local Kafka clusters in the
  Resources view. [issue #445](https://github.com/confluentinc/vscode/issues/445)
- New JavaScript Producer and Python Producer project templates for generating Kafka applications.

### Changed

- Topic -> Schema correlation now recognizes schemas using `TopicRecordNameStrategy` in addition to
  `TopicNameStrategy`, [issue #298](https://github.com/confluentinc/vscode/issues/298).
- The "Local" item in the Resources view now persists regardless of whether or not a local Kafka
  cluster is discoverable, in preparation for future enhancements to local resource management.
  [issue #441](https://github.com/confluentinc/vscode/issues/441)

### Fixed

- Temporary disruptions to CCloud auth sessions will now show a notification to the user while the
  extension sidecar attempts to resolve the issue (instead of invalidating the session immediately
  and forcing the user to sign in again).
  [issue #307](https://github.com/confluentinc/vscode/issues/307)

## 0.19.x

(Skipped due to internal bug in the release process.)

## 0.18.3

### Fixed

- Includes a fix for when the sidecar becomes unresponsive due to periodic Confluent Cloud status
  checks that weren't timing out properly.

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

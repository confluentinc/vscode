Any Docker-image-specific workflows for managing local Confluent/Kafka related resources should be
defined in this directory.

For each workflow, a static `imageRepo` must be set that matches the
`confluent.localDocker.kafkaImageRepo` (string enum) values in `package.json`. However, `imageTag`
is configurable by the user as a string.

# Using Confluent for VS Code

### Work with your Confluent Cloud resources

Log in to your Confluent Cloud account from the Confluent for VS Code extension by clicking on "Sign in to Confluent Cloud", and explore your Confluent Cloud resources from right within VS Code.

> [!NOTE]
> If you would like to connect to your Apache Kafka® cluster on Confluent Cloud and/or Confluent Cloud Schema Registry cluster
> using [API Key (user account or service account)](https://docs.confluent.io/cloud/current/security/authenticate/workload-identities/service-accounts/api-keys/overview.html#api-keys-and-ccloud-accounts), [Mutual TLS](https://docs.confluent.io/cloud/current/security/authenticate/workload-identities/identity-providers/mtls/overview.html), or [OAuth/OIDC](https://docs.confluent.io/cloud/current/security/authenticate/workload-identities/identity-providers/oauth/overview.html), then go [here](#connect-to-any-kafka-api-compatible-cluster-and-any-confluent-schema-registry-api-compatible-server) to understand how to do that using the extension.


### Bootstrap streaming projects from Confluent-provided templates

Confluent for VS Code offers project templates designed to accelerate your development process. These ready-to-use templates are tailored for common development patterns, allowing you to quickly launch new projects with minimal configuration.

> [!NOTE]
> We will continue to add new templates as well as improving existing ones, however, please [file an issue]() or [start a discussion]() if you find bugs/issues in existing templates or have proposals for new templates that could benefit the broader community.

### Accelerate local development against Kafka and Confluent Schema Registry

> [!NOTE]
> Pre-requisites: You must have Docker Engine (version v24.0 or later) installed on your machine. Please follow the instruction [here](https://docs.docker.com/engine/install/) to install Docker Engine.

Using just a single click, you can easily start a Kafka and Confluent Schema Registry container on your local machine (via Docker).

1. Click the green play button next to "Local" to choose whether you want to start Kafka, or Kafka and Schema Registry together
1. Enter the number of brokers you want in the Kafka cluster (this determines the maximum replication factor for the Kafka topics)
1. Hit OK and once the resources become available, you will be able to leverage all the features of the extension to work with the resources you just started.

Currently, the following Docker images are used:
- [confluent-local](https://hub.docker.com/r/confluentinc/confluent-local) for starting a Kafka cluster and Kafka REST server.
- [cp-schema-registry](https://hub.docker.com/r/confluentinc/cp-schema-registry) for Schema Registry

> [!NOTE]
> We plan to expand support for starting Local Resources using other Kafka Docker images,
> such as [apache/kafka](https://hub.docker.com/r/apache/kafka), [Warpstream](https://docs.warpstream.com/warpstream/getting-started/install-the-warpstream-agent) and more.

### Browse messages in Kafka topics using Message Viewer

Click the ![envelope-with-magnifying-glass](../resources/icons/confluent-view-messages.svg) icon next to the topic name to open the **Message Viewer**, which enables
searching and exploring messages in a topic. Within Message Viewer, you can:

- page through and search for specific values within the list of all the messages
- double-click a single message to explore the message headers, key and value encoded into JSON,
  along with additional metadata about the key and/or value schema that may have been used for
  deserialization
- pause and resume consuming at any time
- see aggregate counts of messages over time from the histogram view and brush to filter messages by
  timestamp
- toggle partitions on/off to show/hide messages from specific partitions

### Produce messages to Kafka topics

With Confluent for VS Code, you can produce messages to your Kafka topics, with or without a key/value schema. 

1. Prepare a JSON file containing message `headers` (optional), `key` and `value` as top-level fields.
1. Click the produce icon ![produce icon](../resources/icons/confluent-send-message.svg) next to the topic name to open the Produce Message quickpick flow.
1. You will be prompted to choose a JSON file containing message `headers`, `key` and `value`.
1. Next, you will be prompted to choose whether to produce the message with/without a key/value schema. 
   Click OK to produce the message.
1. You will be notified of whether the produce was successful or not. If successful, you can head to the Message Viewer (click the ![envelope-with-magnifying-glass](../resources/icons/confluent-view-messages.svg) icon against the topic) to inspect the message you just produced.

<details><summary>Example of JSON file for producing message</summary>

```json
{
  "headers": [
    {
      "key": "task.generation",
      "value": "350"
    },
    {
      "key": "task.id",
      "value": "0"
    },
    {
      "key": "current.iteration",
      "value": "39067914"
    }
  ],
  "key": 39067914,
  "value": {
    "ordertime": 1492152554633,
    "orderid": 39067914,
    "itemid": "Item_5",
    "orderunits": 7.508419592693289,
    "address": {
      "city": "City_84",
      "state": "State_85",
      "zipcode": 83204
    }
  }
}
```

</details>

#### Producing messages to topics using `TopicRecordNameStrategy` or `RecordNameStrategy`

If the Kafka topic you wish to produce a message to does not use [TopicNameStrategy](https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html#overview), open the extension settings, look for "Confluent -> Topic -> Produce Messages -> Schemas: Use Topic Name Strategy" and disable this setting. You will then be prompted to select the Subject Name Strategy and the subject name while going through the Produce Message quickpick flow.

#### Producing messages to topics using a schema version earlier than latest

If you wish to produce a message using a schema version earlier than the latest, open the extension settings and look for "Confluent -> Topic -> Produce Messages -> Schemas: Allow Older Versions" and enable it. You will then be prompted to choose which schema version to use while going through the Produce Message quickpick flow.

### Explore, create and evolve schemas in Confluent Schema Registry

#### Explore schemas

The **Schemas** view displays all the schemas available for the current Schema Registry cluster selected. 
Schemas are also shown in the **Topics** view by expanding a topic item if the subject name follows
either `TopicNameStrategy` or `TopicRecordNameStrategy` [schema naming strategies](https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html#overview) and the user has the appropriate permissions.

Schema definitions can be viewed by expanding the schema subject to list all schema versions,
then clicking the on the specific schema version. You can also easily "View Latest Schema" by 
clicking the code file icon next to the subject.

#### Create/evolve schemas

You can create new schemas or update schemas and subject-bindings by creating or opening an `.avsc`,
`.proto`, or `.json` file, then using the **Cloud Upload** icon in the upper-right of the buffer
titlebar to begin the process of selecting a schema registry and subject to bind to. You can either
bind to new subjects or provide a revised/evolved schema for an existing subject to establish a new
version.

Search the marketplace for extensions to validate your Avro, JSON schema, or Protobuf syntax as
needed.

### Connect to any Kafka API-compatible cluster and any Confluent Schema Registry API-compatible server

Confluent for VS Code supports connecting to _any_ [Kafka API-compatible](https://kafka.apache.org/protocol.html) cluster and any [Confluent
Schema Registry API-compatible](https://docs.confluent.io/platform/current/schema-registry/develop/api.html) server.

Get started by clicking the "+" icon in the Resources panel, and select "Enter manually" in the dropdown.
This opens a new tab containing a Connection form, configure your connection using the fields present.

You may test the connection by clicking the **Test** button at the bottom of the form. If VS Code failed
to connect, an appropriate error message will be displayed. If the test succeeds, click the **Save**
button to save the connection as a resource in the Resources view. (Note: You may **Save** the connection details regardless of using the **Test** functionality.)

We will now go over the connection form fields and their functionality:

#### General

| Form field | Description |
| ----- | ----- |
| Connection Name |  An easy to remember name to reference this connection in the Resources view |
| Connection Type | Choose from Apache Kafka®, Confluent Cloud, Confluent Platform, Warpstream, and Other. <br><br> This is used to narrow down the various fields available under [Kafka cluster](#kafka-cluster) and [Schema Registry](#schema-registry). |

#### Kafka Cluster

| Form field | Description |
| ----- | ----- |
| Bootstrap Server(s) |  One or more host:port pairs to use for establishing the initial connection (use a comma-separated list for more than one server). |
| [Authentication Type](#authenticating-to-a-kafka-cluster) | Choose from: <ul><li>Username & Password (SASL/PLAIN)</li><li>API Credentials (SASL/PLAIN)</li><li>SASL/SCRAM</li><li>SASL/OAUTHBEARER</li><li>Kerberos (SASL/GSSAPI)</li></ul>|
| SSL/TLS enabled checkbox | Use SSL/TLS encryption communication for data in transit between VS Code and the Kafka brokers. |
| [TLS Configuration](#tls-configuration) |  Additional TLS configuration, you may expand the TLS Configuration section and fill out Key Store and Trust Store details. |

#### Schema Registry

| Form field | Description |
| ----- | ----- |
| URL |  The URL of the Schema Registry to use with the Kafka Cluster |
| [Authentication Type](#authenticating-to-schema-registry) | Choose from: <ul><li>Username & Password</li><li>API Credentials</li><li>OAuth</li></ul>|
| SSL/TLS enabled checkbox | Use SSL/TLS encryption communication for data in transit between VS Code and the Kafka brokers. |
| [TLS Configuration](#tls-configuration) |  Additional TLS configuration, you may expand the TLS Configuration section and fill out Key Store and Trust Store details. |

> [!NOTE]
> Confluent Cloud Schema Registry does not support self-managed certificates for TLS encryption or mutual TLS (mTLS) authentication. Confluent Cloud employs TLS certificates from Let’s Encrypt, a trusted Certificate Authority (CA). For more information, see [Manage TLS Certificates](https://docs.confluent.io/cloud/current/cp-component/clients-cloud-config.html#manage-tls-certificates).

#### TLS Configuration

| Form field | Description |
| ----- | ----- |
| Verify Server Hostname | Enable verification of the Kafka/Schema Registry host name matching the Distinguished Name (DN) in the broker's certificate. |
| [Key Store Configuration](#tls-configuration---key-store-configuration) | Certificate used by Kafka/Schema Registry to authenticate the client. This is used to configure mutual TLS (mTLS) authentication. |
| [Trust Store Configuration](#tls-configuration---trust-store-configuration) | Certificates for verifying SSL/TLS connections to Kafka/Schema Registry. This is required if the Kafka/Schema Registry server use a self-signed or a non-public Certificate Authority (CA). |

#### TLS Configuration -> Key Store Configuration

Certificate used by Kafka/Schema Registry to authenticate the client. This is used to configure mutual TLS (mTLS) authentication.

| Form field | Description |
| ----- | ----- |
| Path | The path of the Key Store file. |
| Password | The store password for the Key Store file. Key Store password is not supported for PEM format. |
| Key Password | The password of the private key in the Key Store file. |
| Type | The file format of the Key Store file. Choose from PEM, PKCS12 and JKS. |

#### TLS Configuration -> Trust Store Configuration

Certificates for verifying SSL/TLS connections to Kafka/Schema Registry. This is required if Kafka/Schema Registry use a self-signed or a non-public Certificate Authority (CA).

| Form field | Description |
| ----- | ----- |
| Path | The path of the Trust Store file. |
| Password | The password for the Trust Store file. If a password is not set, the configured Trust Store file will still be used, but integrity checking of the Trust Store file is disabled. Trust Store password is not supported for PEM format. |
| Key Password | The password of the private key in the Key Store file. |
| Type | The file format of the Trust Store file. Choose from PEM, PKCS12 and JKS. |

> [!NOTE]
> Confluent Cloud employs TLS certificates from Let’s Encrypt, a trusted Certificate Authority (CA). For more information, see [Manage TLS Certificates](https://docs.confluent.io/cloud/current/cp-component/clients-cloud-config.html#manage-tls-certificates). Confluent Cloud does **not** support self-managed certificates for TLS encryption.

#### Authenticating to a Kafka Cluster

Confluent for VS Code supports authenticating to Kafka using a majority of commonly used SASL authentication mechanisms.

- **SASL/PLAIN**
  - **Username & Password (SASL/PLAIN)**
  - **API Credentials (SASL/PLAIN)**
- **SASL/SCRAM**: We support both `SCRAM-SHA-256` and `SCRAM-SHA-512`.
- **SASL/OAUTHBEARER**
- **Kerberos (SASL/GSSAPI)**
- **mTLS (Mutual TLS)**

> [!NOTE]
> To use mTLS (Mutual TLS) authentication, expand the [TLS Configuration](#tls-configuration) section and fill out the [Key Store Configuration](#tls-configuration---key-store-configuration) options.

#### Authenticating to Schema Registry

Confluent for VS Code supports connecting to Schema Registry using a majority of commonly used HTTP authentication mechanisms.

- **Username & Password**
- **API Credentials**
- **OAuth**
- **mTLS (Mutual TLS)**

> [!NOTE]
> To use mTLS (Mutual TLS) authentication, expand the [TLS Configuration](#tls-configuration) section and fill out the [Key Store Configuration](#tls-configuration---key-store-configuration) options.

#### Exporting and importing connection details

##### Exporting connection details

You can export the connection details to a local file by clicking the socket-download icon next to the connection. However, note that the file may contain sensitive information like API keys, secrets, and local file paths. **Use caution when saving and sharing connection files since they may contain secrets.**

##### Importing connection details

You can import connection details by clicking the "+" icon in the Resources panel, and select "Import from file" in the dropdown. This opens a file browser and you may then choose the desired connection details JSON file. Once imported, 
make any edits as you wish and click "Test" or "Save".


/* tslint:disable */
/* eslint-disable */
/**
 * Docker Engine API
 * The Engine API is an HTTP API served by Docker Engine. It is the API the Docker client uses to communicate with the Engine, so everything the Docker client can do can be done with the API.  Most of the client\'s commands map directly to API endpoints (e.g. `docker ps` is `GET /containers/json`). The notable exception is running containers, which consists of several API calls.  # Errors  The API uses standard HTTP status codes to indicate the success or failure of the API call. The body of the response will be JSON in the following format:  ``` {   \"message\": \"page not found\" } ```  # Versioning  The API is usually changed in each release, so API calls are versioned to ensure that clients don\'t break. To lock to a specific version of the API, you prefix the URL with its version, for example, call `/v1.30/info` to use the v1.30 version of the `/info` endpoint. If the API version specified in the URL is not supported by the daemon, a HTTP `400 Bad Request` error message is returned.  If you omit the version-prefix, the current version of the API (v1.43) is used. For example, calling `/info` is the same as calling `/v1.43/info`. Using the API without a version-prefix is deprecated and will be removed in a future release.  Engine releases in the near future should support this version of the API, so your client will continue to work even if it is talking to a newer Engine.  The API uses an open schema model, which means server may add extra properties to responses. Likewise, the server will ignore any extra query parameters and request body properties. When you write clients, you need to ignore additional properties in responses to ensure they do not break when talking to newer daemons.   # Authentication  Authentication for registries is handled client side. The client has to send authentication details to various endpoints that need to communicate with registries, such as `POST /images/(name)/push`. These are sent as `X-Registry-Auth` header as a [base64url encoded](https://tools.ietf.org/html/rfc4648#section-5) (JSON) string with the following structure:  ``` {   \"username\": \"string\",   \"password\": \"string\",   \"email\": \"string\",   \"serveraddress\": \"string\" } ```  The `serveraddress` is a domain/IP without a protocol. Throughout this structure, double quotes are required.  If you have already got an identity token from the [`/auth` endpoint](#operation/SystemAuth), you can just pass this instead of credentials:  ``` {   \"identitytoken\": \"9cbaf023786cd7...\" } ``` 
 *
 * The version of the OpenAPI document: 1.43
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { mapValues } from '../runtime';
import type { HealthConfig } from './HealthConfig';
import {
    HealthConfigFromJSON,
    HealthConfigFromJSONTyped,
    HealthConfigToJSON,
} from './HealthConfig';

/**
 * Configuration for a container that is portable between hosts.
 * 
 * When used as `ContainerConfig` field in an image, `ContainerConfig` is an
 * optional field containing the configuration of the container that was last
 * committed when creating the image.
 * 
 * Previous versions of Docker builder used this field to store build cache,
 * and it is not in active use anymore.
 * 
 * @export
 * @interface ContainerConfig
 */
export interface ContainerConfig {
    /**
     * The hostname to use for the container, as a valid RFC 1123 hostname.
     * 
     * @type {string}
     * @memberof ContainerConfig
     */
    Hostname?: string;
    /**
     * The domain name to use for the container.
     * 
     * @type {string}
     * @memberof ContainerConfig
     */
    Domainname?: string;
    /**
     * The user that commands are run as inside the container.
     * @type {string}
     * @memberof ContainerConfig
     */
    User?: string;
    /**
     * Whether to attach to `stdin`.
     * @type {boolean}
     * @memberof ContainerConfig
     */
    AttachStdin?: boolean;
    /**
     * Whether to attach to `stdout`.
     * @type {boolean}
     * @memberof ContainerConfig
     */
    AttachStdout?: boolean;
    /**
     * Whether to attach to `stderr`.
     * @type {boolean}
     * @memberof ContainerConfig
     */
    AttachStderr?: boolean;
    /**
     * An object mapping ports to an empty object in the form:
     * 
     * `{"<port>/<tcp|udp|sctp>": {}}`
     * 
     * @type {{ [key: string]: object; }}
     * @memberof ContainerConfig
     */
    ExposedPorts?: { [key: string]: object; } | null;
    /**
     * Attach standard streams to a TTY, including `stdin` if it is not closed.
     * 
     * @type {boolean}
     * @memberof ContainerConfig
     */
    Tty?: boolean;
    /**
     * Open `stdin`
     * @type {boolean}
     * @memberof ContainerConfig
     */
    OpenStdin?: boolean;
    /**
     * Close `stdin` after one attached client disconnects
     * @type {boolean}
     * @memberof ContainerConfig
     */
    StdinOnce?: boolean;
    /**
     * A list of environment variables to set inside the container in the
     * form `["VAR=value", ...]`. A variable without `=` is removed from the
     * environment, rather than to have an empty value.
     * 
     * @type {Array<string>}
     * @memberof ContainerConfig
     */
    Env?: Array<string>;
    /**
     * Command to run specified as a string or an array of strings.
     * 
     * @type {Array<string>}
     * @memberof ContainerConfig
     */
    Cmd?: Array<string>;
    /**
     * 
     * @type {HealthConfig}
     * @memberof ContainerConfig
     */
    Healthcheck?: HealthConfig;
    /**
     * Command is already escaped (Windows only)
     * @type {boolean}
     * @memberof ContainerConfig
     */
    ArgsEscaped?: boolean | null;
    /**
     * The name (or reference) of the image to use when creating the container,
     * or which was used when the container was created.
     * 
     * @type {string}
     * @memberof ContainerConfig
     */
    Image?: string;
    /**
     * An object mapping mount point paths inside the container to empty
     * objects.
     * 
     * @type {{ [key: string]: object; }}
     * @memberof ContainerConfig
     */
    Volumes?: { [key: string]: object; };
    /**
     * The working directory for commands to run in.
     * @type {string}
     * @memberof ContainerConfig
     */
    WorkingDir?: string;
    /**
     * The entry point for the container as a string or an array of strings.
     * 
     * If the array consists of exactly one empty string (`[""]`) then the
     * entry point is reset to system default (i.e., the entry point used by
     * docker when there is no `ENTRYPOINT` instruction in the `Dockerfile`).
     * 
     * @type {Array<string>}
     * @memberof ContainerConfig
     */
    Entrypoint?: Array<string>;
    /**
     * Disable networking for the container.
     * @type {boolean}
     * @memberof ContainerConfig
     */
    NetworkDisabled?: boolean | null;
    /**
     * MAC address of the container.
     * @type {string}
     * @memberof ContainerConfig
     */
    MacAddress?: string | null;
    /**
     * `ONBUILD` metadata that were defined in the image's `Dockerfile`.
     * 
     * @type {Array<string>}
     * @memberof ContainerConfig
     */
    OnBuild?: Array<string> | null;
    /**
     * User-defined key/value metadata.
     * @type {{ [key: string]: string; }}
     * @memberof ContainerConfig
     */
    Labels?: { [key: string]: string; };
    /**
     * Signal to stop a container as a string or unsigned integer.
     * 
     * @type {string}
     * @memberof ContainerConfig
     */
    StopSignal?: string | null;
    /**
     * Timeout to stop a container in seconds.
     * @type {number}
     * @memberof ContainerConfig
     */
    StopTimeout?: number | null;
    /**
     * Shell for when `RUN`, `CMD`, and `ENTRYPOINT` uses a shell.
     * 
     * @type {Array<string>}
     * @memberof ContainerConfig
     */
    Shell?: Array<string> | null;
}

/**
 * Check if a given object implements the ContainerConfig interface.
 */
export function instanceOfContainerConfig(value: object): value is ContainerConfig {
    return true;
}

export function ContainerConfigFromJSON(json: any): ContainerConfig {
    return ContainerConfigFromJSONTyped(json, false);
}

export function ContainerConfigFromJSONTyped(json: any, ignoreDiscriminator: boolean): ContainerConfig {
    if (json == null) {
        return json;
    }
    return {
        
        'Hostname': json['Hostname'] == null ? undefined : json['Hostname'],
        'Domainname': json['Domainname'] == null ? undefined : json['Domainname'],
        'User': json['User'] == null ? undefined : json['User'],
        'AttachStdin': json['AttachStdin'] == null ? undefined : json['AttachStdin'],
        'AttachStdout': json['AttachStdout'] == null ? undefined : json['AttachStdout'],
        'AttachStderr': json['AttachStderr'] == null ? undefined : json['AttachStderr'],
        'ExposedPorts': json['ExposedPorts'] == null ? undefined : json['ExposedPorts'],
        'Tty': json['Tty'] == null ? undefined : json['Tty'],
        'OpenStdin': json['OpenStdin'] == null ? undefined : json['OpenStdin'],
        'StdinOnce': json['StdinOnce'] == null ? undefined : json['StdinOnce'],
        'Env': json['Env'] == null ? undefined : json['Env'],
        'Cmd': json['Cmd'] == null ? undefined : json['Cmd'],
        'Healthcheck': json['Healthcheck'] == null ? undefined : HealthConfigFromJSON(json['Healthcheck']),
        'ArgsEscaped': json['ArgsEscaped'] == null ? undefined : json['ArgsEscaped'],
        'Image': json['Image'] == null ? undefined : json['Image'],
        'Volumes': json['Volumes'] == null ? undefined : json['Volumes'],
        'WorkingDir': json['WorkingDir'] == null ? undefined : json['WorkingDir'],
        'Entrypoint': json['Entrypoint'] == null ? undefined : json['Entrypoint'],
        'NetworkDisabled': json['NetworkDisabled'] == null ? undefined : json['NetworkDisabled'],
        'MacAddress': json['MacAddress'] == null ? undefined : json['MacAddress'],
        'OnBuild': json['OnBuild'] == null ? undefined : json['OnBuild'],
        'Labels': json['Labels'] == null ? undefined : json['Labels'],
        'StopSignal': json['StopSignal'] == null ? undefined : json['StopSignal'],
        'StopTimeout': json['StopTimeout'] == null ? undefined : json['StopTimeout'],
        'Shell': json['Shell'] == null ? undefined : json['Shell'],
    };
}

export function ContainerConfigToJSON(value?: ContainerConfig | null): any {
    if (value == null) {
        return value;
    }
    return {
        
        'Hostname': value['Hostname'],
        'Domainname': value['Domainname'],
        'User': value['User'],
        'AttachStdin': value['AttachStdin'],
        'AttachStdout': value['AttachStdout'],
        'AttachStderr': value['AttachStderr'],
        'ExposedPorts': value['ExposedPorts'],
        'Tty': value['Tty'],
        'OpenStdin': value['OpenStdin'],
        'StdinOnce': value['StdinOnce'],
        'Env': value['Env'],
        'Cmd': value['Cmd'],
        'Healthcheck': HealthConfigToJSON(value['Healthcheck']),
        'ArgsEscaped': value['ArgsEscaped'],
        'Image': value['Image'],
        'Volumes': value['Volumes'],
        'WorkingDir': value['WorkingDir'],
        'Entrypoint': value['Entrypoint'],
        'NetworkDisabled': value['NetworkDisabled'],
        'MacAddress': value['MacAddress'],
        'OnBuild': value['OnBuild'],
        'Labels': value['Labels'],
        'StopSignal': value['StopSignal'],
        'StopTimeout': value['StopTimeout'],
        'Shell': value['Shell'],
    };
}


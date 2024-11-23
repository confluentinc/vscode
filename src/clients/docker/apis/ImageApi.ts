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


import * as runtime from '../runtime';
import type {
  BuildPruneResponse,
  ContainerConfig,
  ErrorResponse,
  HistoryResponseItem,
  IdResponse,
  ImageDeleteResponseItem,
  ImageInspect,
  ImagePruneResponse,
  ImageSearchResponseItem,
  ImageSummary,
} from '../models/index';
import {
    BuildPruneResponseFromJSON,
    BuildPruneResponseToJSON,
    ContainerConfigFromJSON,
    ContainerConfigToJSON,
    ErrorResponseFromJSON,
    ErrorResponseToJSON,
    HistoryResponseItemFromJSON,
    HistoryResponseItemToJSON,
    IdResponseFromJSON,
    IdResponseToJSON,
    ImageDeleteResponseItemFromJSON,
    ImageDeleteResponseItemToJSON,
    ImageInspectFromJSON,
    ImageInspectToJSON,
    ImagePruneResponseFromJSON,
    ImagePruneResponseToJSON,
    ImageSearchResponseItemFromJSON,
    ImageSearchResponseItemToJSON,
    ImageSummaryFromJSON,
    ImageSummaryToJSON,
} from '../models/index';

export interface BuildPruneRequest {
    keep_storage?: number;
    all?: boolean;
    filters?: string;
}

export interface ImageBuildRequest {
    dockerfile?: string;
    t?: string;
    extrahosts?: string;
    remote?: string;
    q?: boolean;
    nocache?: boolean;
    cachefrom?: string;
    pull?: string;
    rm?: boolean;
    forcerm?: boolean;
    memory?: number;
    memswap?: number;
    cpushares?: number;
    cpusetcpus?: string;
    cpuperiod?: number;
    cpuquota?: number;
    buildargs?: string;
    shmsize?: number;
    squash?: boolean;
    labels?: string;
    networkmode?: string;
    Content_type?: ImageBuildContentTypeEnum;
    X_Registry_Config?: string;
    platform?: string;
    target?: string;
    outputs?: string;
    version?: ImageBuildVersionEnum;
    inputStream?: Blob;
}

export interface ImageCommitRequest {
    container?: string;
    repo?: string;
    tag?: string;
    comment?: string;
    author?: string;
    pause?: boolean;
    changes?: string;
    containerConfig?: ContainerConfig;
}

export interface ImageCreateRequest {
    fromImage?: string;
    fromSrc?: string;
    repo?: string;
    tag?: string;
    message?: string;
    X_Registry_Auth?: string;
    changes?: Array<string>;
    platform?: string;
    inputImage?: string;
}

export interface ImageDeleteRequest {
    name: string;
    force?: boolean;
    noprune?: boolean;
}

export interface ImageGetRequest {
    name: string;
}

export interface ImageGetAllRequest {
    names?: Array<string>;
}

export interface ImageHistoryRequest {
    name: string;
}

export interface ImageInspectRequest {
    name: string;
}

export interface ImageListRequest {
    all?: boolean;
    filters?: string;
    shared_size?: boolean;
    digests?: boolean;
}

export interface ImageLoadRequest {
    quiet?: boolean;
    imagesTarball?: Blob;
}

export interface ImagePruneRequest {
    filters?: string;
}

export interface ImagePushRequest {
    name: string;
    X_Registry_Auth: string;
    tag?: string;
}

export interface ImageSearchRequest {
    term: string;
    limit?: number;
    filters?: string;
}

export interface ImageTagRequest {
    name: string;
    repo?: string;
    tag?: string;
}

/**
 * 
 */
export class ImageApi extends runtime.BaseAPI {

    /**
     * Delete builder cache
     */
    async buildPruneRaw(requestParameters: BuildPruneRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<BuildPruneResponse>> {
        const queryParameters: any = {};

        if (requestParameters['keep_storage'] != null) {
            queryParameters['keep-storage'] = requestParameters['keep_storage'];
        }

        if (requestParameters['all'] != null) {
            queryParameters['all'] = requestParameters['all'];
        }

        if (requestParameters['filters'] != null) {
            queryParameters['filters'] = requestParameters['filters'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/build/prune`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => BuildPruneResponseFromJSON(jsonValue));
    }

    /**
     * Delete builder cache
     */
    async buildPrune(requestParameters: BuildPruneRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<BuildPruneResponse> {
        const response = await this.buildPruneRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Build an image from a tar archive with a `Dockerfile` in it.  The `Dockerfile` specifies how the image is built from the tar archive. It is typically in the archive\'s root, but can be at a different path or have a different name by specifying the `dockerfile` parameter. [See the `Dockerfile` reference for more information](https://docs.docker.com/engine/reference/builder/).  The Docker daemon performs a preliminary validation of the `Dockerfile` before starting the build, and returns an error if the syntax is incorrect. After that, each instruction is run one-by-one until the ID of the new image is output.  The build is canceled if the client drops the connection by quitting or being killed. 
     * Build an image
     */
    async imageBuildRaw(requestParameters: ImageBuildRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        const queryParameters: any = {};

        if (requestParameters['dockerfile'] != null) {
            queryParameters['dockerfile'] = requestParameters['dockerfile'];
        }

        if (requestParameters['t'] != null) {
            queryParameters['t'] = requestParameters['t'];
        }

        if (requestParameters['extrahosts'] != null) {
            queryParameters['extrahosts'] = requestParameters['extrahosts'];
        }

        if (requestParameters['remote'] != null) {
            queryParameters['remote'] = requestParameters['remote'];
        }

        if (requestParameters['q'] != null) {
            queryParameters['q'] = requestParameters['q'];
        }

        if (requestParameters['nocache'] != null) {
            queryParameters['nocache'] = requestParameters['nocache'];
        }

        if (requestParameters['cachefrom'] != null) {
            queryParameters['cachefrom'] = requestParameters['cachefrom'];
        }

        if (requestParameters['pull'] != null) {
            queryParameters['pull'] = requestParameters['pull'];
        }

        if (requestParameters['rm'] != null) {
            queryParameters['rm'] = requestParameters['rm'];
        }

        if (requestParameters['forcerm'] != null) {
            queryParameters['forcerm'] = requestParameters['forcerm'];
        }

        if (requestParameters['memory'] != null) {
            queryParameters['memory'] = requestParameters['memory'];
        }

        if (requestParameters['memswap'] != null) {
            queryParameters['memswap'] = requestParameters['memswap'];
        }

        if (requestParameters['cpushares'] != null) {
            queryParameters['cpushares'] = requestParameters['cpushares'];
        }

        if (requestParameters['cpusetcpus'] != null) {
            queryParameters['cpusetcpus'] = requestParameters['cpusetcpus'];
        }

        if (requestParameters['cpuperiod'] != null) {
            queryParameters['cpuperiod'] = requestParameters['cpuperiod'];
        }

        if (requestParameters['cpuquota'] != null) {
            queryParameters['cpuquota'] = requestParameters['cpuquota'];
        }

        if (requestParameters['buildargs'] != null) {
            queryParameters['buildargs'] = requestParameters['buildargs'];
        }

        if (requestParameters['shmsize'] != null) {
            queryParameters['shmsize'] = requestParameters['shmsize'];
        }

        if (requestParameters['squash'] != null) {
            queryParameters['squash'] = requestParameters['squash'];
        }

        if (requestParameters['labels'] != null) {
            queryParameters['labels'] = requestParameters['labels'];
        }

        if (requestParameters['networkmode'] != null) {
            queryParameters['networkmode'] = requestParameters['networkmode'];
        }

        if (requestParameters['platform'] != null) {
            queryParameters['platform'] = requestParameters['platform'];
        }

        if (requestParameters['target'] != null) {
            queryParameters['target'] = requestParameters['target'];
        }

        if (requestParameters['outputs'] != null) {
            queryParameters['outputs'] = requestParameters['outputs'];
        }

        if (requestParameters['version'] != null) {
            queryParameters['version'] = requestParameters['version'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/octet-stream';

        if (requestParameters['Content_type'] != null) {
            headerParameters['Content-type'] = String(requestParameters['Content_type']);
        }

        if (requestParameters['X_Registry_Config'] != null) {
            headerParameters['X-Registry-Config'] = String(requestParameters['X_Registry_Config']);
        }

        const response = await this.request({
            path: `/build`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['inputStream'] as any,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Build an image from a tar archive with a `Dockerfile` in it.  The `Dockerfile` specifies how the image is built from the tar archive. It is typically in the archive\'s root, but can be at a different path or have a different name by specifying the `dockerfile` parameter. [See the `Dockerfile` reference for more information](https://docs.docker.com/engine/reference/builder/).  The Docker daemon performs a preliminary validation of the `Dockerfile` before starting the build, and returns an error if the syntax is incorrect. After that, each instruction is run one-by-one until the ID of the new image is output.  The build is canceled if the client drops the connection by quitting or being killed. 
     * Build an image
     */
    async imageBuild(requestParameters: ImageBuildRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.imageBuildRaw(requestParameters, initOverrides);
    }

    /**
     * Create a new image from a container
     */
    async imageCommitRaw(requestParameters: ImageCommitRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<IdResponse>> {
        const queryParameters: any = {};

        if (requestParameters['container'] != null) {
            queryParameters['container'] = requestParameters['container'];
        }

        if (requestParameters['repo'] != null) {
            queryParameters['repo'] = requestParameters['repo'];
        }

        if (requestParameters['tag'] != null) {
            queryParameters['tag'] = requestParameters['tag'];
        }

        if (requestParameters['comment'] != null) {
            queryParameters['comment'] = requestParameters['comment'];
        }

        if (requestParameters['author'] != null) {
            queryParameters['author'] = requestParameters['author'];
        }

        if (requestParameters['pause'] != null) {
            queryParameters['pause'] = requestParameters['pause'];
        }

        if (requestParameters['changes'] != null) {
            queryParameters['changes'] = requestParameters['changes'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/json';

        const response = await this.request({
            path: `/commit`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: ContainerConfigToJSON(requestParameters['containerConfig']),
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => IdResponseFromJSON(jsonValue));
    }

    /**
     * Create a new image from a container
     */
    async imageCommit(requestParameters: ImageCommitRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<IdResponse> {
        const response = await this.imageCommitRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Create an image by either pulling it from a registry or importing it.
     * Create an image
     */
    async imageCreateRaw(requestParameters: ImageCreateRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        const queryParameters: any = {};

        if (requestParameters['fromImage'] != null) {
            queryParameters['fromImage'] = requestParameters['fromImage'];
        }

        if (requestParameters['fromSrc'] != null) {
            queryParameters['fromSrc'] = requestParameters['fromSrc'];
        }

        if (requestParameters['repo'] != null) {
            queryParameters['repo'] = requestParameters['repo'];
        }

        if (requestParameters['tag'] != null) {
            queryParameters['tag'] = requestParameters['tag'];
        }

        if (requestParameters['message'] != null) {
            queryParameters['message'] = requestParameters['message'];
        }

        if (requestParameters['changes'] != null) {
            queryParameters['changes'] = requestParameters['changes']!.join(runtime.COLLECTION_FORMATS["csv"]);
        }

        if (requestParameters['platform'] != null) {
            queryParameters['platform'] = requestParameters['platform'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'text/plain';

        if (requestParameters['X_Registry_Auth'] != null) {
            headerParameters['X-Registry-Auth'] = String(requestParameters['X_Registry_Auth']);
        }

        const response = await this.request({
            path: `/images/create`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['inputImage'] as any,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Create an image by either pulling it from a registry or importing it.
     * Create an image
     */
    async imageCreate(requestParameters: ImageCreateRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.imageCreateRaw(requestParameters, initOverrides);
    }

    /**
     * Remove an image, along with any untagged parent images that were referenced by that image.  Images can\'t be removed if they have descendant images, are being used by a running container or are being used by a build. 
     * Remove an image
     */
    async imageDeleteRaw(requestParameters: ImageDeleteRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ImageDeleteResponseItem>>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling imageDelete().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['force'] != null) {
            queryParameters['force'] = requestParameters['force'];
        }

        if (requestParameters['noprune'] != null) {
            queryParameters['noprune'] = requestParameters['noprune'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/{name}`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ImageDeleteResponseItemFromJSON));
    }

    /**
     * Remove an image, along with any untagged parent images that were referenced by that image.  Images can\'t be removed if they have descendant images, are being used by a running container or are being used by a build. 
     * Remove an image
     */
    async imageDelete(requestParameters: ImageDeleteRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ImageDeleteResponseItem>> {
        const response = await this.imageDeleteRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Get a tarball containing all images and metadata for a repository.  If `name` is a specific name and tag (e.g. `ubuntu:latest`), then only that image (and its parents) are returned. If `name` is an image ID, similarly only that image (and its parents) are returned, but with the exclusion of the `repositories` file in the tarball, as there were no image names referenced.  ### Image tarball format  An image tarball contains one directory per image layer (named using its long ID), each containing these files:  - `VERSION`: currently `1.0` - the file format version - `json`: detailed layer information, similar to `docker inspect layer_id` - `layer.tar`: A tarfile containing the filesystem changes in this layer  The `layer.tar` file contains `aufs` style `.wh..wh.aufs` files and directories for storing attribute changes and deletions.  If the tarball defines a repository, the tarball should also include a `repositories` file at the root that contains a list of repository and tag names mapped to layer IDs.  ```json {   \"hello-world\": {     \"latest\": \"565a9d68a73f6706862bfe8409a7f659776d4d60a8d096eb4a3cbce6999cc2a1\"   } } ``` 
     * Export an image
     */
    async imageGetRaw(requestParameters: ImageGetRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Blob>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling imageGet().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/{name}/get`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.BlobApiResponse(response);
    }

    /**
     * Get a tarball containing all images and metadata for a repository.  If `name` is a specific name and tag (e.g. `ubuntu:latest`), then only that image (and its parents) are returned. If `name` is an image ID, similarly only that image (and its parents) are returned, but with the exclusion of the `repositories` file in the tarball, as there were no image names referenced.  ### Image tarball format  An image tarball contains one directory per image layer (named using its long ID), each containing these files:  - `VERSION`: currently `1.0` - the file format version - `json`: detailed layer information, similar to `docker inspect layer_id` - `layer.tar`: A tarfile containing the filesystem changes in this layer  The `layer.tar` file contains `aufs` style `.wh..wh.aufs` files and directories for storing attribute changes and deletions.  If the tarball defines a repository, the tarball should also include a `repositories` file at the root that contains a list of repository and tag names mapped to layer IDs.  ```json {   \"hello-world\": {     \"latest\": \"565a9d68a73f6706862bfe8409a7f659776d4d60a8d096eb4a3cbce6999cc2a1\"   } } ``` 
     * Export an image
     */
    async imageGet(requestParameters: ImageGetRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Blob> {
        const response = await this.imageGetRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Get a tarball containing all images and metadata for several image repositories.  For each value of the `names` parameter: if it is a specific name and tag (e.g. `ubuntu:latest`), then only that image (and its parents) are returned; if it is an image ID, similarly only that image (and its parents) are returned and there would be no names referenced in the \'repositories\' file for this image ID.  For details on the format, see the [export image endpoint](#operation/ImageGet). 
     * Export several images
     */
    async imageGetAllRaw(requestParameters: ImageGetAllRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Blob>> {
        const queryParameters: any = {};

        if (requestParameters['names'] != null) {
            queryParameters['names'] = requestParameters['names']!.join(runtime.COLLECTION_FORMATS["csv"]);
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/get`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.BlobApiResponse(response);
    }

    /**
     * Get a tarball containing all images and metadata for several image repositories.  For each value of the `names` parameter: if it is a specific name and tag (e.g. `ubuntu:latest`), then only that image (and its parents) are returned; if it is an image ID, similarly only that image (and its parents) are returned and there would be no names referenced in the \'repositories\' file for this image ID.  For details on the format, see the [export image endpoint](#operation/ImageGet). 
     * Export several images
     */
    async imageGetAll(requestParameters: ImageGetAllRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Blob> {
        const response = await this.imageGetAllRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Return parent layers of an image.
     * Get the history of an image
     */
    async imageHistoryRaw(requestParameters: ImageHistoryRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<HistoryResponseItem>>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling imageHistory().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/{name}/history`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(HistoryResponseItemFromJSON));
    }

    /**
     * Return parent layers of an image.
     * Get the history of an image
     */
    async imageHistory(requestParameters: ImageHistoryRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<HistoryResponseItem>> {
        const response = await this.imageHistoryRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Return low-level information about an image.
     * Inspect an image
     */
    async imageInspectRaw(requestParameters: ImageInspectRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ImageInspect>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling imageInspect().'
            );
        }

        const queryParameters: any = {};

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/{name}/json`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ImageInspectFromJSON(jsonValue));
    }

    /**
     * Return low-level information about an image.
     * Inspect an image
     */
    async imageInspect(requestParameters: ImageInspectRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ImageInspect> {
        const response = await this.imageInspectRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Returns a list of images on the server. Note that it uses a different, smaller representation of an image than inspecting a single image.
     * List Images
     */
    async imageListRaw(requestParameters: ImageListRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ImageSummary>>> {
        const queryParameters: any = {};

        if (requestParameters['all'] != null) {
            queryParameters['all'] = requestParameters['all'];
        }

        if (requestParameters['filters'] != null) {
            queryParameters['filters'] = requestParameters['filters'];
        }

        if (requestParameters['shared_size'] != null) {
            queryParameters['shared-size'] = requestParameters['shared_size'];
        }

        if (requestParameters['digests'] != null) {
            queryParameters['digests'] = requestParameters['digests'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/json`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ImageSummaryFromJSON));
    }

    /**
     * Returns a list of images on the server. Note that it uses a different, smaller representation of an image than inspecting a single image.
     * List Images
     */
    async imageList(requestParameters: ImageListRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ImageSummary>> {
        const response = await this.imageListRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Load a set of images and tags into a repository.  For details on the format, see the [export image endpoint](#operation/ImageGet). 
     * Import images
     */
    async imageLoadRaw(requestParameters: ImageLoadRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        const queryParameters: any = {};

        if (requestParameters['quiet'] != null) {
            queryParameters['quiet'] = requestParameters['quiet'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        headerParameters['Content-Type'] = 'application/x-tar';

        const response = await this.request({
            path: `/images/load`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['imagesTarball'] as any,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Load a set of images and tags into a repository.  For details on the format, see the [export image endpoint](#operation/ImageGet). 
     * Import images
     */
    async imageLoad(requestParameters: ImageLoadRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.imageLoadRaw(requestParameters, initOverrides);
    }

    /**
     * Delete unused images
     */
    async imagePruneRaw(requestParameters: ImagePruneRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ImagePruneResponse>> {
        const queryParameters: any = {};

        if (requestParameters['filters'] != null) {
            queryParameters['filters'] = requestParameters['filters'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/prune`,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => ImagePruneResponseFromJSON(jsonValue));
    }

    /**
     * Delete unused images
     */
    async imagePrune(requestParameters: ImagePruneRequest = {}, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ImagePruneResponse> {
        const response = await this.imagePruneRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Push an image to a registry.  If you wish to push an image on to a private registry, that image must already have a tag which references the registry. For example, `registry.example.com/myimage:latest`.  The push is cancelled if the HTTP connection is closed. 
     * Push an image
     */
    async imagePushRaw(requestParameters: ImagePushRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling imagePush().'
            );
        }

        if (requestParameters['X_Registry_Auth'] == null) {
            throw new runtime.RequiredError(
                'X_Registry_Auth',
                'Required parameter "X_Registry_Auth" was null or undefined when calling imagePush().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['tag'] != null) {
            queryParameters['tag'] = requestParameters['tag'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        if (requestParameters['X_Registry_Auth'] != null) {
            headerParameters['X-Registry-Auth'] = String(requestParameters['X_Registry_Auth']);
        }

        const response = await this.request({
            path: `/images/{name}/push`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Push an image to a registry.  If you wish to push an image on to a private registry, that image must already have a tag which references the registry. For example, `registry.example.com/myimage:latest`.  The push is cancelled if the HTTP connection is closed. 
     * Push an image
     */
    async imagePush(requestParameters: ImagePushRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.imagePushRaw(requestParameters, initOverrides);
    }

    /**
     * Search for an image on Docker Hub.
     * Search images
     */
    async imageSearchRaw(requestParameters: ImageSearchRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ImageSearchResponseItem>>> {
        if (requestParameters['term'] == null) {
            throw new runtime.RequiredError(
                'term',
                'Required parameter "term" was null or undefined when calling imageSearch().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['term'] != null) {
            queryParameters['term'] = requestParameters['term'];
        }

        if (requestParameters['limit'] != null) {
            queryParameters['limit'] = requestParameters['limit'];
        }

        if (requestParameters['filters'] != null) {
            queryParameters['filters'] = requestParameters['filters'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/search`,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ImageSearchResponseItemFromJSON));
    }

    /**
     * Search for an image on Docker Hub.
     * Search images
     */
    async imageSearch(requestParameters: ImageSearchRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ImageSearchResponseItem>> {
        const response = await this.imageSearchRaw(requestParameters, initOverrides);
        return await response.value();
    }

    /**
     * Tag an image so that it becomes part of a repository.
     * Tag an image
     */
    async imageTagRaw(requestParameters: ImageTagRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError(
                'name',
                'Required parameter "name" was null or undefined when calling imageTag().'
            );
        }

        const queryParameters: any = {};

        if (requestParameters['repo'] != null) {
            queryParameters['repo'] = requestParameters['repo'];
        }

        if (requestParameters['tag'] != null) {
            queryParameters['tag'] = requestParameters['tag'];
        }

        const headerParameters: runtime.HTTPHeaders = {};

        const response = await this.request({
            path: `/images/{name}/tag`.replace(`{${"name"}}`, encodeURIComponent(String(requestParameters['name']))),
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        }, initOverrides);

        return new runtime.VoidApiResponse(response);
    }

    /**
     * Tag an image so that it becomes part of a repository.
     * Tag an image
     */
    async imageTag(requestParameters: ImageTagRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.imageTagRaw(requestParameters, initOverrides);
    }

}

/**
 * @export
 */
export const ImageBuildContentTypeEnum = {
    ApplicationXTar: 'application/x-tar'
} as const;
export type ImageBuildContentTypeEnum = typeof ImageBuildContentTypeEnum[keyof typeof ImageBuildContentTypeEnum];
/**
 * @export
 */
export const ImageBuildVersionEnum = {
    _1: '1',
    _2: '2'
} as const;
export type ImageBuildVersionEnum = typeof ImageBuildVersionEnum[keyof typeof ImageBuildVersionEnum];

import { UriMetadataKeys } from "./constants";

/** Record that uses any {@link UriMetadataKeys} value for its keys.  */
export type UriMetadata = Partial<Record<UriMetadataKeys, any>>;

/** Map of stringified resource {@link Uri}s to their associated metadata objects. */
export type UriMetadataMap = Map<string, UriMetadata>;

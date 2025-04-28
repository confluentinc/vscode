import { UriMetadataKeys } from "./constants";

/** Map of stringified resource {@link Uri}s to their associated metadata objects. */
export type UriMetadataMap = Map<string, Record<UriMetadataKeys, any>>;

import { RawUdfSystemCatalogRow } from "../../../src/loaders/udfSystemCatalogQuery";

/**
 * Make a function-describing row as if from UDF_SYSTEM_CATALOG_QUERY.
 */
export function makeUdfFunctionRow(
  name: string,
  opts: { functionSpecificName?: string; returnType?: string } = {},
): RawUdfSystemCatalogRow {
  return {
    functionRoutineName: name,
    functionSpecificName: opts.functionSpecificName ?? `${name}-1`,
    functionExternalName: `com.example.${name}`,
    functionExternalLanguage: "JAVA",
    functionExternalArtifacts: "my-artifact:1.0.0", // to be refined.
    isDeterministic: "YES",
    functionCreatedTs: new Date().toISOString(),
    functionKind: "SCALAR",
    fullDataType: opts.returnType ?? "STRING",

    parameterOrdinalPosition: null,
    parameterName: null,
    isParameterOptional: null,
    parameterTraits: null,
  };
}

/**
 * Make a parameter-describing row as if from UDF_SYSTEM_CATALOG_QUERY.
 */
export function makeUdfParameterRow(
  functionName: string,
  paramName: string,
  position: number,
  opts: {
    functionSpecificName?: string;
    dataType?: string;
    isOptional?: boolean;
    traits?: string[];
  } = {},
): RawUdfSystemCatalogRow {
  return {
    functionRoutineName: functionName,
    functionSpecificName: opts.functionSpecificName ?? `${functionName}-1`,
    functionExternalName: null,
    functionExternalLanguage: null,
    functionExternalArtifacts: null,
    isDeterministic: null,
    functionCreatedTs: null,
    functionKind: null,
    fullDataType: opts.dataType ?? "STRING",

    parameterOrdinalPosition: position,
    parameterName: paramName,
    isParameterOptional: opts.isOptional ? "YES" : "NO",
    parameterTraits: opts.traits ? opts.traits.join(";") : "",
  };
}

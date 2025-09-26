/** CCLoudResourceLoader Flink statement utils */

const UDF_SYSTEM_CATALOG_QUERY = `
(select 
  specific_name as \`specificName\`, 
  routine_name as \`routineName\`,
  -1 as ordinal_position as \`ordinalPosition\`,
  'routine_output' as \`parameterName\`,
  full_data_type as \`fullDataType\`, 
  external_name as \`externalName\`, 
  external_language as \`externalLanguage\`, 
  external_artifacts as \`externalArtifacts\`, 
  is_deterministic as \`isDeterministic\`, 
  cast(created as string) as \`functionCreatedTs\`, 
  function_kind as \`functionKind\`,
  cast(false as string) as \`isParameterOptional\`,
  cast(null as string)  as \`parameterTraits\`,
from information_schema.routines)

union all

(select 
  specific_name as \`specificName\`, 
  routine_name as \`routineName\`,
  ordinal_position as \`ordinalPosition\`,
  parameter_name as \`parameterName\`,
  full_data_type as \`fullDataType\`, 
  cast(null as string) as \`externalName\`, 
  cast(null as string) as \`externalLanguage\`, 
  cast(null as string) as \`externalArtifacts\`, 
  cast(null as string) as \`isDeterministic\` 
  cast(null as string) as \`functionCreatedTs\`, 
  cast(null as string) as \`functionKind\`,
  is_optional as \`isParameterOptional\`,
  traits as \`parameterTraits\`,
from information_schema.parameters)
`;

export type RawUdfSystemCatalogRow = {
  specificName: string;
  routineName: string;
  ordinalPosition: number;
  parameterName: string;
  fullDataType: string;
  externalName: string | null;
  externalLanguage: string | null;
  externalArtifacts: string | null;
  isDeterministic: string | null;
  functionCreatedTs: string | null;
  functionKind: string | null;
  isParameterOptional: string;
  parameterTraits: string | null;
};

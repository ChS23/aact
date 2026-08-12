// Public API barrel. Каждое правило — единый RuleDefinition объект
// экспортируемый как xxxRule. Lib helpers (applyEdits etc.) для users-as-library.

export { type AclOptions, aclRule } from "./acl";
export { type AcyclicOptions, acyclicRule } from "./acyclic";
export { type ApiGatewayOptions, apiGatewayRule } from "./apiGateway";
export { type CohesionOptions, cohesionRule } from "./cohesion";
export { type CommonReuseOptions, commonReuseRule } from "./commonReuse";
export { type CrudOptions, crudRule } from "./crud";
export { type DbPerServiceOptions, dbPerServiceRule } from "./dbPerService";
export {
  applyEdits,
  type ApplyEditsResult,
  type EditConflict,
  editLocation,
} from "./lib/applyEdits";
export { ruleRegistry } from "./registry";
export {
  type StableDependenciesOptions,
  stableDependenciesRule,
} from "./stableDependencies";
export * from "./types";

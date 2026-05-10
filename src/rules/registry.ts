import type { ArchitectureModel } from "../model";
import type { AclOptions } from "./acl";
import { checkAcl } from "./acl";
import { checkAcyclic } from "./acyclic";
import type { ApiGatewayOptions } from "./apiGateway";
import { checkApiGateway } from "./apiGateway";
import type { CohesionOptions } from "./cohesion";
import { checkCohesion } from "./cohesion";
import { checkCommonReuse } from "./commonReuse";
import type { CrudOptions } from "./crud";
import { checkCrud } from "./crud";
import type { DbPerServiceOptions } from "./dbPerService";
import { checkDbPerService } from "./dbPerService";
import type { FixResult, SourceSyntax } from "./fix";
import { fixAcl } from "./fixAcl";
import { fixCrud } from "./fixCrud";
import { fixDbPerService } from "./fixDbPerService";
import type { StableDependenciesOptions } from "./stableDependencies";
import { checkStableDependencies } from "./stableDependencies";
import type { Violation } from "./types";

export interface RuleDefinition {
  readonly name: string;
  readonly check: (model: ArchitectureModel, options?: unknown) => Violation[];
  readonly fix?: (
    model: ArchitectureModel,
    violations: Violation[],
    syntax: SourceSyntax,
    options?: unknown,
  ) => FixResult[];
}

/** Type-safe rule factory — isolates the type erasure to a single point */
const defineRule = <O>(def: {
  readonly name: string;
  readonly check: (model: ArchitectureModel, options?: O) => Violation[];
  readonly fix?: (
    model: ArchitectureModel,
    violations: Violation[],
    syntax: SourceSyntax,
    options?: O,
  ) => FixResult[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
}): RuleDefinition => def as any;

export const ruleRegistry: readonly RuleDefinition[] = [
  defineRule<AclOptions>({
    name: "acl",
    check: (m, o) => checkAcl(m.allContainers, o),
    fix: fixAcl,
  }),
  defineRule({ name: "acyclic", check: (m) => checkAcyclic(m.allContainers) }),
  defineRule<ApiGatewayOptions>({
    name: "apiGateway",
    check: (m, o) => checkApiGateway(m.allContainers, o),
  }),
  defineRule<CrudOptions>({
    name: "crud",
    check: (m, o) => checkCrud(m.allContainers, o),
    fix: fixCrud,
  }),
  defineRule<DbPerServiceOptions>({
    name: "dbPerService",
    check: (m, o) => checkDbPerService(m.allContainers, o),
    fix: fixDbPerService,
  }),
  defineRule<CohesionOptions>({
    name: "cohesion",
    check: (m, o) => checkCohesion(m, o),
  }),
  defineRule<StableDependenciesOptions>({
    name: "stableDependencies",
    check: (m, o) => checkStableDependencies(m.allContainers, o),
  }),
  defineRule({
    name: "commonReuse",
    check: (m) => checkCommonReuse(m),
  }),
];

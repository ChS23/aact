import * as v from "valibot";

const ruleOption = <T extends v.ObjectEntries>(entries: T) =>
  v.optional(v.union([v.boolean(), v.strictObject(entries)]));

export const AactConfigSchema = v.strictObject({
  source: v.strictObject({
    type: v.picklist(["plantuml", "structurizr"]),
    path: v.string(),
    writePath: v.optional(v.string()),
  }),
  rules: v.optional(
    v.strictObject({
      acl: ruleOption({
        tag: v.optional(v.string()),
        externalType: v.optional(v.string()),
      }),
      acyclic: v.optional(v.boolean()),
      apiGateway: ruleOption({
        aclTag: v.optional(v.string()),
        externalType: v.optional(v.string()),
        gatewayPattern: v.optional(v.instance(RegExp)),
      }),
      crud: ruleOption({
        repoTags: v.optional(v.array(v.string())),
        dbType: v.optional(v.string()),
      }),
      dbPerService: ruleOption({
        dbType: v.optional(v.string()),
        ownerTags: v.optional(v.array(v.string())),
      }),
      cohesion: ruleOption({
        externalType: v.optional(v.string()),
        internalType: v.optional(v.string()),
      }),
      stableDependencies: ruleOption({
        externalType: v.optional(v.string()),
      }),
      commonReuse: v.optional(v.boolean()),
    }),
  ),
  generate: v.optional(
    v.strictObject({
      kubernetes: v.optional(
        v.strictObject({
          path: v.optional(v.string()),
          exclude: v.optional(v.array(v.string())),
        }),
      ),
      boundaryLabel: v.optional(v.string()),
    }),
  ),
});

export type AactConfig = v.InferOutput<typeof AactConfigSchema>;

export const defineConfig = (config: AactConfig): AactConfig => config;

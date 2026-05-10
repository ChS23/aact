import { defineConfig } from "../../src";

export default defineConfig({
  source: {
    type: "structurizr",
    path: "./workspace.json",
    writePath: "./workspace.dsl",
  },

  rules: {
    acl: true,
    acyclic: true,
    crud: true,
    dbPerService: true,
    stableDependencies: true,
    commonReuse: true,
  },
});

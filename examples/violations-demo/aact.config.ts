import { defineConfig } from "../../src";

export default defineConfig({
  source: "./workspace.dsl",

  rules: {
    acl: true,
    acyclic: true,
    crud: true,
    dbPerService: true,
    stableDependencies: true,
    commonReuse: true,
  },
});

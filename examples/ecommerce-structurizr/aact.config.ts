import { defineConfig } from "../../src";

export default defineConfig({
  // DSL — authoring surface. `*.dsl` auto-detects as structurizr,
  // type не обязателен. JSON workspace регенерируется при необходимости
  // через `structurizr-cli export -w workspace.dsl -format json`.
  source: "./workspace.dsl",

  rules: {
    acl: true,
    acyclic: true,
    crud: true,
    dbPerService: true,
    cohesion: true,
    stableDependencies: true,
  },
});

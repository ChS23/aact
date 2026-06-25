# library-api

Driving aact from code instead of the CLI — load a model, run built-in and
custom rules, compute metrics, diff two models, and generate artifacts, all
through the public package surface (`import … from "aact"`).

See the [aact как библиотека](../../docs/guides/library-api.md) guide for the
walkthrough.

## Files

```
architecture.dsl         # a service reaching the DB directly (a CRUD violation)
architecture-fixed.dsl   # the same system with a repository layer
library-api.test.ts      # the API exercised end-to-end (load → check → diff → generate)
```

`library-api.test.ts` imports from `../../src` so it runs in this repo; the guide
shows the same code as `import … from "aact"`.

# kubernetes-drift

Architecture-as-code vs. a live cluster. The C4 model in `architecture.dsl` is
the **intended** design of the `Shop` platform; `k8s/` is what's actually
**deployed**. They disagree on purpose — `aact diff` surfaces the drift.

See the [aact ↔ Kubernetes guide](../../docs/guides/aact-kubernetes.md) for the
full walkthrough.

## Layout

```
architecture.dsl   # intended C4 architecture (Structurizr DSL)
k8s/               # deployed manifests (real Deployment / StatefulSet / Service)
aact.config.ts     # source = architecture.dsl
```

## The intended architecture

No service touches a database directly — all persistence goes through a
repository layer:

```
orders-api → orders-repo → orders-db
orders-api → billing-service → billing-repo → billing-db
```

`npx aact check` against `architecture.dsl` is clean.

## The deployed reality (drift)

`k8s/` encodes three deliberate divergences:

1. **`orders-repo` is not deployed** — `orders-api` reads `orders-db` directly
   (a CRUD-pattern violation that exists only in the cluster).
2. **`metrics-collector`** runs in the cluster but is absent from the architecture.
3. **`billing-db`** runs on MySQL, though the architecture specifies PostgreSQL.

The manifests use realistic naming: workloads like `billing-service`, Services
like `billing-svc` — aact reconciles the two when resolving relations.

## Run it

```bash
# from this directory

# 1. drift between intended architecture and deployed cluster
npx aact diff architecture.dsl ./k8s/

# 2. inspect the model aact reads from the cluster (positional source, no config)
npx aact model ./k8s/

# 3. lint the cluster directly — flags the production CRUD violation
npx aact check ./k8s/

# 4. lint the architecture itself — clean
npx aact check architecture.dsl
```

`aact diff` exits `1` because structural + semantic drift is present — the gate
you'd wire into CI.

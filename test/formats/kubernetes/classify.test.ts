import {
  classify,
  getPodSpec,
  getPrimaryContainer,
} from "../../../src/formats/kubernetes/classify";
import type { ParsedManifest } from "../../../src/formats/kubernetes/types";

const make = (
  kind: string,
  spec: Record<string, unknown> | undefined = {},
  apiVersion = "apps/v1",
): ParsedManifest => ({
  filePath: "test.yaml",
  docIndex: 0,
  apiVersion,
  kind,
  metadata: { name: "x", labels: {}, annotations: {} },
  spec,
  raw: { kind, apiVersion, metadata: { name: "x" }, spec },
});

describe("classify — resource categories", () => {
  it.each(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod"])(
    "%s → workload",
    (kind) => {
      expect(classify(make(kind))).toBe("workload");
    },
  );

  it("Service → service", () => {
    expect(classify(make("Service"))).toBe("service");
  });

  it("Namespace → namespace", () => {
    expect(classify(make("Namespace"))).toBe("namespace");
  });

  it.each([
    "ReplicaSet",
    "ConfigMap",
    "Secret",
    "PersistentVolumeClaim",
    "NetworkPolicy",
    "Ingress",
    "HorizontalPodAutoscaler",
  ])("%s → other", (kind) => {
    expect(classify(make(kind))).toBe("other");
  });
});

describe("getPodSpec — workload pod-spec lookup", () => {
  it("Deployment uses spec.template.spec", () => {
    const m = make("Deployment", {
      template: { spec: { containers: [{ image: "x" }] } },
    });
    expect(getPodSpec(m)?.containers).toBeDefined();
  });

  it("StatefulSet uses spec.template.spec", () => {
    const m = make("StatefulSet", {
      template: { spec: { containers: [{ image: "x" }] } },
    });
    expect(getPodSpec(m)?.containers).toBeDefined();
  });

  it("CronJob uses spec.jobTemplate.spec.template.spec", () => {
    const m = make("CronJob", {
      jobTemplate: {
        spec: {
          template: { spec: { containers: [{ image: "x" }] } },
        },
      },
    });
    expect(getPodSpec(m)?.containers).toBeDefined();
  });

  it("Pod uses spec directly", () => {
    const m = make("Pod", { containers: [{ image: "x" }] });
    expect(getPodSpec(m)?.containers).toBeDefined();
  });

  it("returns undefined when spec missing", () => {
    expect(getPodSpec(make("Deployment"))).toBeUndefined();
  });

  it("returns undefined when template missing", () => {
    expect(getPodSpec(make("Deployment", {}))).toBeUndefined();
  });
});

describe("getPrimaryContainer", () => {
  it("returns containers[0]", () => {
    const m = make("Deployment", {
      template: {
        spec: {
          containers: [
            { name: "primary", image: "app:1" },
            { name: "sidecar", image: "envoy:1" },
          ],
        },
      },
    });
    const c = getPrimaryContainer(m);
    expect(c?.name).toBe("primary");
  });

  it("returns undefined when containers empty", () => {
    const m = make("Deployment", { template: { spec: { containers: [] } } });
    expect(getPrimaryContainer(m)).toBeUndefined();
  });

  it("returns undefined when pod-spec missing", () => {
    expect(getPrimaryContainer(make("Deployment", {}))).toBeUndefined();
  });
});

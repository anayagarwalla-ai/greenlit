import { getSupabaseAdmin } from "./database";

export type OperationalFeature = "RUNS" | "REVIEWS" | "INVOICES";

export type OperationalControl = {
  feature: OperationalFeature;
  paused: boolean;
  reason: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
  source: "environment" | "database" | "default" | "unavailable";
};

const environmentFlag: Record<OperationalFeature, string> = {
  RUNS: "BETA_PAUSE_RUNS",
  REVIEWS: "BETA_PAUSE_REVIEWS",
  INVOICES: "BETA_PAUSE_INVOICES",
};

export async function getOperationalControl(
  feature: OperationalFeature,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<OperationalControl> {
  if (environment[environmentFlag[feature]]?.trim().toLowerCase() === "true") {
    return {
      feature,
      paused: true,
      reason: environment.BETA_PAUSE_REASON?.trim() || "This capability is temporarily paused by the operator.",
      source: "environment",
    };
  }
  const database = getSupabaseAdmin();
  if (!database) {
    return process.env.NODE_ENV === "production"
      ? {
          feature,
          paused: true,
          reason: "The operator safety control is unavailable, so this capability is paused.",
          source: "unavailable",
        }
      : { feature, paused: false, reason: "", source: "default" };
  }
  const { data, error } = await database.from("operational_controls")
    .select("feature,paused,reason,updated_by,updated_at")
    .eq("feature", feature)
    .maybeSingle();
  if (error || !data) {
    return {
      feature,
      paused: process.env.NODE_ENV === "production",
      reason: process.env.NODE_ENV === "production"
        ? "The operator safety control is unavailable, so this capability is paused."
        : "",
      source: "unavailable",
    };
  }
  return {
    feature,
    paused: Boolean(data.paused),
    reason: String(data.reason || ""),
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
    source: "database",
  };
}

export function operationalPauseResponse(control: OperationalControl) {
  return Response.json(
    {
      error: control.reason || `${control.feature.toLowerCase()} are temporarily paused by the operator.`,
      code: `${control.feature}_PAUSED`,
    },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } },
  );
}

export function internalRunsPauseResponse(retryable: boolean) {
  return Response.json(
    {
      error: "Verification runs are temporarily paused by the operator safety control.",
      code: "RUNS_PAUSED",
      retryable,
      ...(retryable ? { retryAfterSeconds: 300 } : {}),
    },
    {
      status: 423,
      headers: {
        "Cache-Control": "no-store",
        ...(retryable ? { "Retry-After": "300" } : {}),
      },
    },
  );
}

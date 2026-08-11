import { NextResponse } from "next/server";

import { track } from "@/lib/analytics";
import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import { buildExport, type ExportFormat } from "@/lib/exports";
import { featuresFor } from "@/lib/plans/features";
import type { PlanTier } from "@/lib/enums";

const FORMATS: ExportFormat[] = [
  "question-catalog-xlsx",
  "grounding-pack-json",
  "listing-json",
  "binding-graph-mmd",
  "binding-graph-svg",
  "evidence-pack-pdf",
  "evidence-pack-docx",
  "agent-bundle-zip",
];

/**
 * Exports are a paid feature; the evidence pack is not.
 *
 * A Free-tier practitioner has to be able to hand someone the evidence pack —
 * that is the wedge, and gating it would make the free tier a demo rather than
 * a product. The bulk exports are where the team-scale value is.
 */
const FREE_TIER_FORMATS = new Set<ExportFormat>(["evidence-pack-pdf", "evidence-pack-docx"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await requireSessionContext();
  const requested = new URL(request.url).searchParams.get("format") ?? "";

  if (!FORMATS.includes(requested as ExportFormat)) {
    return NextResponse.json(
      { error: "Unknown format.", formats: FORMATS },
      { status: 400 },
    );
  }
  const format = requested as ExportFormat;

  const features = featuresFor(session.planTier as PlanTier);
  if (!features.exports && !FREE_TIER_FORMATS.has(format)) {
    return NextResponse.json(
      {
        error:
          "Bulk exports are part of the Team plan. The evidence pack is available on every plan — that is the one you hand an auditor.",
        upgradeTo: "TEAM",
      },
      { status: 402 },
    );
  }

  const result = await withOrg(session.organizationId, (db) =>
    buildExport(db, { organizationId: session.organizationId, agentId: id, format }),
  );
  if (!result) return new NextResponse("Not found", { status: 404 });

  await track({
    name: "export_downloaded",
    organizationId: session.organizationId,
    userId: session.userId,
    properties: { format, planTier: session.planTier },
  });

  return new NextResponse(Buffer.from(result.bytes), {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

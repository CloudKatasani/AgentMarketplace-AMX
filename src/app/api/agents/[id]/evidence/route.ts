import { NextResponse } from "next/server";

import { requireSessionContext } from "@/lib/auth/session-context";
import { withOrg } from "@/lib/db/scope";
import { assembleEvidencePack } from "@/lib/evidence/pack";
import { renderPackDocx, renderPackPdf } from "@/lib/evidence/render";
import { track } from "@/lib/analytics";

/**
 * The evidence pack download.
 *
 * Assembled fresh on every request rather than cached: a pack is a statement
 * about the system *now*, and a stale one is worse than none because it looks
 * authoritative. The manifest carries the generation timestamp for exactly
 * this reason.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await requireSessionContext();
  const format = new URL(request.url).searchParams.get("format") === "docx" ? "docx" : "pdf";

  const pack = await withOrg(session.organizationId, (db) =>
    assembleEvidencePack(db, session.organizationId, id),
  );
  if (!pack) return new NextResponse("Not found", { status: 404 });

  await track({
    name: "evidence_pack_exported",
    organizationId: session.organizationId,
    userId: session.userId,
    properties: { format, certificationBasis: pack.certificationBasis },
  });

  const bytes = format === "docx" ? await renderPackDocx(pack) : await renderPackPdf(pack);
  const filename = `evidence-pack-${pack.agent.slug}-${pack.manifest.packHash.slice(0, 8)}.${format}`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type":
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

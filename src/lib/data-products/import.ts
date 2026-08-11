/**
 * Registering a data product from a DPF/ADPM export.
 *
 * AMX does not build data products — it binds agents to them. So the way a
 * product gets here is by importing what the product's own platform already
 * publishes: a marketplace listing, a semantic model, and a data contract.
 *
 * The import is strict about two things, because they are what a binding later
 * depends on: the serving layer must be one an agent may bind to, and every
 * metric must resolve to a semantic-model reference rather than a table.
 */
import { z } from "zod";

import { appendAuditEvent } from "@/lib/audit/append";
import { compileRules, matchesDeniedIdentifier, DEFAULT_REFERENCE_RULES } from "@/lib/bindings/rules";
import type { AmxPrismaClient } from "@/lib/db/tenancy";
import { contentHash } from "@/lib/hash";

import { parseSemver } from "./version-bump";

const semver = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/, "Versions must look like 2.1.0.");

/** `marketplace-listing.json` — who owns it and how good it is. */
const listingSchema = z.object({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(10),
  owner: z.string().trim().min(1),
  domain: z.string().trim().optional(),
  layer: z.string().trim().default("GOLD"),
  qualityScore: z.number().int().min(0).max(100),
  sensitivity: z
    .enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"])
    .default("INTERNAL"),
  freshnessSlaHours: z.number().int().positive().optional(),
});

/** `data-contract.yaml` — the version an agent pins itself to. */
const contractSchema = z.object({
  version: semver,
  changeSummary: z.string().trim().default("Imported from the product's data contract."),
});

/** `semantic-model.yaml` — the entities and metrics an agent may reference. */
const semanticModelSchema = z.object({
  version: semver,
  entities: z.array(z.string().trim().min(1)).default([]),
  metrics: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        name: z.string().trim().min(1),
        definition: z.string().trim().min(10),
        grain: z.string().trim().min(1),
        unit: z.string().trim().optional(),
        /** Must point into the semantic model, never at a table. */
        semanticRef: z.string().trim().min(1),
        certified: z.boolean().default(false),
      }),
    )
    .default([]),
});

export const productImportSchema = z.object({
  listing: listingSchema,
  contract: contractSchema,
  semanticModel: semanticModelSchema,
});

export type ProductImport = z.infer<typeof productImportSchema>;

export type ImportResult =
  | { ok: true; dataProductId: string; metricCount: number }
  | { ok: false; errors: { path: string; message: string }[] };

export async function registerDataProductFromImport(
  db: AmxPrismaClient,
  input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string | null;
    payload: unknown;
  },
): Promise<ImportResult> {
  const parsed = productImportSchema.safeParse(input.payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const { listing, contract, semanticModel } = parsed.data;
  const rules = compileRules(DEFAULT_REFERENCE_RULES);
  const errors: { path: string; message: string }[] = [];

  if (rules.deniedLayers.has(listing.layer.toUpperCase())) {
    errors.push({
      path: "/listing/layer",
      message: `${listing.name} is served from the ${listing.layer} layer. Agents may only bind to certified serving layers, so importing it would create a product nothing can legally use. Import the Gold or semantic-layer product built on top of it instead.`,
    });
  } else if (!rules.allowedLayers.has(listing.layer.toUpperCase())) {
    errors.push({
      path: "/listing/layer",
      message: `"${listing.layer}" is not a layer we recognise. Use one of: ${[...rules.allowedLayers].join(", ")}.`,
    });
  }

  for (const [index, metric] of semanticModel.metrics.entries()) {
    if (matchesDeniedIdentifier(metric.semanticRef, rules)) {
      errors.push({
        path: `/semanticModel/metrics/${index}/semanticRef`,
        message: `The metric "${metric.key}" resolves to "${metric.semanticRef}", which is a physical table rather than a semantic-model reference. Point it at its semantic entity before importing — a metric defined on a table cannot be bound.`,
      });
    }
  }

  const version = parseSemver(contract.version)!;
  if (errors.length > 0) return { ok: false, errors };

  const existing = await db.dataProduct.findUnique({
    where: {
      organizationId_workspaceId_key: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        key: listing.key,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      errors: [
        {
          path: "/listing/key",
          message: `A data product with the key "${listing.key}" is already registered in this workspace. Publish a new contract version on it rather than importing it twice.`,
        },
      ],
    };
  }

  const domain = listing.domain
    ? await db.domain.findFirst({ where: { key: listing.domain }, select: { id: true } })
    : null;

  const product = await db.dataProduct.create({
    data: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      domainId: domain?.id ?? null,
      key: listing.key,
      name: listing.name,
      description: listing.description,
      ownerName: listing.owner,
      contractVersion: contract.version,
      contractMajor: version.major,
      contractMinor: version.minor,
      contractPatch: version.patch,
      semanticModelVersion: semanticModel.version,
      layer: listing.layer.toUpperCase(),
      qualityScore: listing.qualityScore,
      sensitivity: listing.sensitivity,
      freshnessSlaHours: listing.freshnessSlaHours ?? null,
      lastRefreshedAt: new Date(),
      importedFrom: JSON.stringify(parsed.data),
    },
    select: { id: true },
  });

  await db.dataProductVersion.create({
    data: {
      organizationId: input.organizationId,
      dataProductId: product.id,
      contractVersion: contract.version,
      contractMajor: version.major,
      contractMinor: version.minor,
      contractPatch: version.patch,
      semanticModelVersion: semanticModel.version,
      changeSummary: contract.changeSummary,
      contentHash: contentHash(parsed.data),
    },
  });

  for (const metric of semanticModel.metrics) {
    await db.certifiedMetric.create({
      data: {
        organizationId: input.organizationId,
        dataProductId: product.id,
        key: metric.key,
        name: metric.name,
        definition: metric.definition,
        grain: metric.grain,
        unit: metric.unit ?? null,
        semanticRef: metric.semanticRef,
        // Certification is a claim the exporting platform makes; we record it
        // rather than granting it, and an uncertified metric cannot be bound.
        certifiedAt: metric.certified ? new Date() : null,
        certifiedBy: metric.certified ? listing.owner : null,
      },
    });
  }

  await appendAuditEvent(db, {
    organizationId: input.organizationId,
    type: "dataproduct.registered",
    subjectType: "DataProduct",
    subjectId: product.id,
    actorUserId: input.actorUserId,
    payload: {
      key: listing.key,
      contractVersion: contract.version,
      metricCount: semanticModel.metrics.length,
      source: "import",
    },
  });

  return { ok: true, dataProductId: product.id, metricCount: semanticModel.metrics.length };
}

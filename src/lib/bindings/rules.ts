/**
 * What counts as "a physical table" — configurable, because the answer is a
 * platform and industry dialect, not a universal truth. A Databricks shop says
 * `bronze.`, a Snowflake shop says `RAW_`, a legacy warehouse says `dbo.`.
 *
 * Defaults live in `_generic`; industry packs override them from Phase 4.
 */
import { z } from "zod";

export const physicalReferenceRulesSchema = z.object({
  /** Serving layers an agent may never bind to. */
  deniedLayers: z.array(z.string()).default(["RAW", "BRONZE", "SILVER", "STAGING"]),
  /** Identifier patterns (case-insensitive regex sources) treated as physical references. */
  deniedIdentifierPatterns: z
    .array(z.string())
    .default([
      "^bronze[._]",
      "^silver[._]",
      "^raw[._]",
      "^stg[._]",
      "^staging[._]",
      "^slv_",
      "^brz_",
      "^raw_",
      "^stg_",
      "_raw$",
      "^dbo\\.",
      "^public\\.tmp_",
    ]),
  /**
   * Field names that must never appear in a grounding pack or tool spec.
   *
   * Their presence is an error on its own, empty or not: a free-form query
   * field IS the text-to-SQL surface, and the value it holds today says
   * nothing about the value it holds at runtime.
   */
  forbiddenFreeformFields: z
    .array(z.string())
    .default(["sql", "query", "rawQuery", "raw_sql", "statement", "sqlTemplate", "queryTemplate"]),
  /** A reference is allowed only if it resolves to one of these. */
  allowedReferenceKinds: z
    .array(z.enum(["certified_metric", "semantic_entity", "semantic_dimension"]))
    .default(["certified_metric", "semantic_entity", "semantic_dimension"]),
  /** Serving layers an agent may bind to. */
  allowedLayers: z.array(z.string()).default(["GOLD", "PLATINUM", "SEMANTIC"]),
});

export type PhysicalReferenceRules = z.infer<typeof physicalReferenceRulesSchema>;

export const DEFAULT_REFERENCE_RULES: PhysicalReferenceRules =
  physicalReferenceRulesSchema.parse({});

/** Compiled once per validation run rather than once per string scanned. */
export type CompiledRules = {
  raw: PhysicalReferenceRules;
  deniedIdentifiers: RegExp[];
  deniedLayers: Set<string>;
  allowedLayers: Set<string>;
  forbiddenFields: Set<string>;
};

export function compileRules(
  rules: PhysicalReferenceRules = DEFAULT_REFERENCE_RULES,
): CompiledRules {
  return {
    raw: rules,
    deniedIdentifiers: rules.deniedIdentifierPatterns.map((p) => new RegExp(p, "i")),
    deniedLayers: new Set(rules.deniedLayers.map((l) => l.toUpperCase())),
    allowedLayers: new Set(rules.allowedLayers.map((l) => l.toUpperCase())),
    forbiddenFields: new Set(rules.forbiddenFreeformFields.map((f) => f.toLowerCase())),
  };
}

/** `FROM customers`, `JOIN silver.meter_reads AS m` — the obvious cases, caught loudly. */
export const SQL_TABLE_REFERENCE = /\b(?:from|join)\s+([a-z_][\w.$]*)/gi;

/**
 * Other SQL keywords in the same string.
 *
 * "from" and "join" are ordinary English — *"churn from last quarter"*,
 * *"accounts that moved into arrears"*, *"join the retention programme"*. A
 * scanner that flags those makes the validator a laughing stock in the first
 * demo, so a bare FROM/JOIN is only treated as SQL when the string carries
 * another SQL signal, or when the identifier itself looks like a table.
 */
export const SQL_STATEMENT_SIGNAL =
  /\b(?:select|where|group\s+by|order\s+by|inner\s+join|left\s+join|union\s+all|having)\b/i;

/** `bronze.events`, `slv_meter_reads` — dotted or snake_cased, i.e. not prose. */
export const TABLE_SHAPED_IDENTIFIER = /^[a-z][\w$]*(?:[._][\w$]+)+$/i;

export function matchesDeniedIdentifier(identifier: string, rules: CompiledRules): boolean {
  return rules.deniedIdentifiers.some((pattern) => pattern.test(identifier));
}

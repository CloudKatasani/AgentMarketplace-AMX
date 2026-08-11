/**
 * Industry packs.
 *
 * A pack changes vocabulary and seed content. It never changes logic — there is
 * no field here that can weaken a gate, skip a stage, or make a validator
 * lenient. The one thing a pack *can* tighten is the physical-reference rules,
 * because "what counts as a raw table" is genuinely a platform dialect.
 *
 * Validated on load, and by `pnpm pack:validate` in CI, so a malformed pack
 * fails a build rather than a customer's first workspace.
 */
import { z } from "zod";

import { INTENT_CLASSES, PERSONA_KINDS, RISK_TIERS, SENSITIVITY_LEVELS } from "@/lib/enums";
import { physicalReferenceRulesSchema } from "@/lib/bindings/rules";

const key = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Keys are lower-case, hyphenated, and start with a letter.");

/** Pack keys may lead with an underscore, so `_generic` sorts first on disk. */
const packKey = z
  .string()
  .trim()
  .regex(/^_?[a-z0-9][a-z0-9-]*$/, "Pack keys are lower-case and hyphenated, optionally with a leading underscore.");
const prose = (min = 1) => z.string().trim().min(min);

export const packPersonaSchema = z.object({
  key,
  name: prose(2),
  kind: PERSONA_KINDS.schema.default("BUSINESS"),
  ownedDecisions: prose(10),
  cadence: prose(2),
  currentWorkaround: prose(10),
});

export const packQuestionSchema = z.object({
  key,
  personaKey: key,
  text: prose(8),
  intentClass: INTENT_CLASSES.schema,
  consequenceOfNoAnswer: prose(10),
  expectedAnswerShape: prose(3),
  /** Metric this question is expected to rest on, when the pack ships one. */
  metricKey: z.string().trim().default(""),
});

export const packMetricSchema = z.object({
  key: z.string().trim().min(1),
  name: prose(2),
  definition: prose(10),
  grain: prose(2),
  unit: z.string().trim().default(""),
  semanticRef: prose(3),
});

export const packDataProductSchema = z.object({
  key,
  name: prose(2),
  description: prose(10),
  domainKey: key,
  owner: prose(2),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  semanticModelVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Packs may only ship products an agent could legally bind to. */
  layer: z.enum(["GOLD", "PLATINUM", "SEMANTIC"]).default("GOLD"),
  qualityScore: z.number().int().min(0).max(100),
  sensitivity: SENSITIVITY_LEVELS.schema.default("INTERNAL"),
  freshnessSlaHours: z.number().int().positive().optional(),
  metrics: z.array(packMetricSchema).default([]),
});

export const packStarterAgentSchema = z.object({
  key,
  name: prose(2),
  summary: prose(10),
  archetype: z.enum(["Analyst", "Advisor", "Monitor", "Operator", "Navigator", "Educator"]),
  riskTier: RISK_TIERS.schema,
  domainKey: key,
  primaryPersonaKey: key,
  questionKeys: z.array(key).min(3, "A starter agent needs at least three questions."),
  /** Which products it binds to, and how. */
  bindings: z
    .array(
      z.object({
        dataProductKey: key,
        type: z.enum(["GROUNDS_ON", "QUERIES", "RETRIEVES", "ACTS_VIA", "CITES"]),
        purpose: prose(10),
        metricKeys: z.array(z.string().trim()).default([]),
      }),
    )
    .min(1),
});

export const packConstraintSchema = z.object({
  key,
  name: prose(3),
  /** Plain-language prompt shown at Stage 6. */
  prompt: prose(20),
  appliesToSensitivity: z.array(SENSITIVITY_LEVELS.schema).default([]),
  appliesToRiskTier: z.array(RISK_TIERS.schema).default([]),
  citation: z.string().trim().default(""),
});

export const packAcademyModuleSchema = z.object({
  key,
  title: prose(3),
  body: prose(40),
  /** A lab points at a live object in the workspace rather than a screenshot. */
  lab: z
    .object({
      title: prose(3),
      instructions: prose(20),
      /** "agent" | "data-product" | "coverage-matrix" | "audit" | "evidence-pack" */
      target: z.enum(["agent", "data-product", "coverage-matrix", "audit", "evidence-pack"]),
    })
    .nullable()
    .default(null),
  assessment: z
    .array(
      z.object({
        question: prose(10),
        options: z.array(prose(1)).min(2),
        correctIndex: z.number().int().min(0),
        explanation: prose(10),
      }),
    )
    .default([]),
});

export const packAcademyCourseSchema = z.object({
  key,
  title: prose(3),
  summary: prose(20),
  modules: z.array(packAcademyModuleSchema).min(1),
});

export const packAcademyPathSchema = z.object({
  key,
  title: prose(3),
  /** The role this path prepares someone for. */
  roleKey: z.string().trim(),
  summary: prose(20),
  /** Credential granted on completion; may gate an approver role. */
  credentialKey: key,
  courses: z.array(packAcademyCourseSchema).min(1),
});

export const packSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  key: packKey,
  name: prose(2),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  summary: prose(20),
  /** Illustrative and editable — say so in the pack, not just in the docs. */
  disclaimer: prose(20).default(
    "This pack is illustrative. Every persona, question, product, and constraint is a starting point to edit, not a standard to comply with.",
  ),
  domains: z.array(z.object({ key, name: prose(2) })).min(1),
  /** The conformed entities this industry agrees on, in order. */
  conformedBackbone: z.array(prose(2)).default([]),
  personas: z.array(packPersonaSchema).min(1),
  questionLibrary: z.array(packQuestionSchema).default([]),
  dataProducts: z.array(packDataProductSchema).default([]),
  starterAgents: z.array(packStarterAgentSchema).default([]),
  regulatoryConstraints: z.array(packConstraintSchema).default([]),
  glossary: z.array(z.object({ term: prose(1), definition: prose(10) })).default([]),
  /** Pack-configurable physical-reference rules; the only logic a pack touches. */
  referenceRules: physicalReferenceRulesSchema.partial().default({}),
  academy: z.array(packAcademyPathSchema).default([]),
});

export type Pack = z.infer<typeof packSchema>;
export type PackPersona = z.infer<typeof packPersonaSchema>;
export type PackQuestion = z.infer<typeof packQuestionSchema>;
export type PackDataProduct = z.infer<typeof packDataProductSchema>;
export type PackStarterAgent = z.infer<typeof packStarterAgentSchema>;
export type PackConstraint = z.infer<typeof packConstraintSchema>;
export type PackAcademyPath = z.infer<typeof packAcademyPathSchema>;

export type PackIssue = { path: string; message: string };

/**
 * Cross-field checks Zod cannot express.
 *
 * These are the ones that produce a broken *workspace* rather than a broken
 * file: a starter agent pointing at a question that does not exist seeds an
 * agent with a coverage gap on day one.
 */
export function validatePackReferences(pack: Pack): PackIssue[] {
  const issues: PackIssue[] = [];
  const domainKeys = new Set(pack.domains.map((d) => d.key));
  const personaKeys = new Set(pack.personas.map((p) => p.key));
  const questionKeys = new Set(pack.questionLibrary.map((q) => q.key));
  const productKeys = new Set(pack.dataProducts.map((p) => p.key));
  const metricKeys = new Set(pack.dataProducts.flatMap((p) => p.metrics.map((m) => m.key)));

  for (const [index, question] of pack.questionLibrary.entries()) {
    if (!personaKeys.has(question.personaKey)) {
      issues.push({
        path: `/questionLibrary/${index}/personaKey`,
        message: `"${question.personaKey}" is not a persona in this pack.`,
      });
    }
    if (question.metricKey && !metricKeys.has(question.metricKey)) {
      issues.push({
        path: `/questionLibrary/${index}/metricKey`,
        message: `"${question.metricKey}" is not a metric on any product in this pack.`,
      });
    }
  }

  for (const [index, product] of pack.dataProducts.entries()) {
    if (!domainKeys.has(product.domainKey)) {
      issues.push({
        path: `/dataProducts/${index}/domainKey`,
        message: `"${product.domainKey}" is not a domain in this pack.`,
      });
    }
  }

  for (const [index, agent] of pack.starterAgents.entries()) {
    if (!domainKeys.has(agent.domainKey)) {
      issues.push({
        path: `/starterAgents/${index}/domainKey`,
        message: `"${agent.domainKey}" is not a domain in this pack.`,
      });
    }
    if (!personaKeys.has(agent.primaryPersonaKey)) {
      issues.push({
        path: `/starterAgents/${index}/primaryPersonaKey`,
        message: `"${agent.primaryPersonaKey}" is not a persona in this pack.`,
      });
    }
    for (const questionKey of agent.questionKeys) {
      if (!questionKeys.has(questionKey)) {
        issues.push({
          path: `/starterAgents/${index}/questionKeys`,
          message: `"${questionKey}" is not in the question library, so the starter agent would seed with a coverage gap.`,
        });
      }
    }
    for (const binding of agent.bindings) {
      if (!productKeys.has(binding.dataProductKey)) {
        issues.push({
          path: `/starterAgents/${index}/bindings`,
          message: `"${binding.dataProductKey}" is not a data product in this pack.`,
        });
      }
      if (binding.type === "QUERIES" && binding.metricKeys.length === 0) {
        issues.push({
          path: `/starterAgents/${index}/bindings`,
          message: `A QUERIES binding to "${binding.dataProductKey}" names no metric — the validator would reject it on first load.`,
        });
      }
      for (const metricKey of binding.metricKeys) {
        if (!metricKeys.has(metricKey)) {
          issues.push({
            path: `/starterAgents/${index}/bindings`,
            message: `"${metricKey}" is not a metric in this pack.`,
          });
        }
      }
    }
  }

  // Every question a starter agent claims must have something to answer it.
  for (const [index, agent] of pack.starterAgents.entries()) {
    const boundMetrics = new Set(agent.bindings.flatMap((b) => b.metricKeys));
    for (const questionKey of agent.questionKeys) {
      const question = pack.questionLibrary.find((q) => q.key === questionKey);
      if (question?.metricKey && !boundMetrics.has(question.metricKey)) {
        issues.push({
          path: `/starterAgents/${index}/bindings`,
          message: `Question "${questionKey}" expects metric "${question.metricKey}", which none of this agent's bindings provide.`,
        });
      }
    }
  }

  for (const [index, path] of pack.academy.entries()) {
    for (const [courseIndex, course] of path.courses.entries()) {
      for (const [moduleIndex, lesson] of course.modules.entries()) {
        for (const [qIndex, item] of lesson.assessment.entries()) {
          if (item.correctIndex >= item.options.length) {
            issues.push({
              path: `/academy/${index}/courses/${courseIndex}/modules/${moduleIndex}/assessment/${qIndex}`,
              message: "correctIndex points past the end of the options.",
            });
          }
        }
      }
    }
  }

  return issues;
}

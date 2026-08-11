/**
 * The role vocabulary.
 *
 * Roles are product-level (the same five names mean the same thing in every
 * tenant); assignment is tenant-level via `MembershipRole`. Seeded into the
 * `Role` table by `prisma/seed.ts` from this file, so there is one source of
 * truth. Industry packs may add roles in Phase 4; these are the backbone.
 */
import { z } from "zod";

export const ROLE_KEYS = [
  "org-admin",
  "agent-product-owner",
  "agent-builder",
  "data-product-owner",
  "governance-officer",
  "privacy-officer",
  "security-officer",
  "business-consumer",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];
export const roleKeySchema = z.enum(ROLE_KEYS);

export type RoleDefinition = {
  id: RoleKey;
  name: string;
  description: string;
  isApprover: boolean;
  isVeto: boolean;
  /** Academy credential gating the role — enforced from Phase 4. */
  requiresCredentialKey: string | null;
  ordinal: number;
};

export const ROLES: readonly RoleDefinition[] = [
  {
    id: "org-admin",
    name: "Organisation Admin",
    description: "Manages members, plan, and workspace settings. Not an approver by default.",
    isApprover: false,
    isVeto: false,
    requiresCredentialKey: null,
    ordinal: 1,
  },
  {
    id: "agent-product-owner",
    name: "Agent Product Owner",
    description:
      "Owns the agent's mission and scope, and is accountable for what it is allowed to answer.",
    isApprover: true,
    isVeto: false,
    requiresCredentialKey: null,
    ordinal: 2,
  },
  {
    id: "agent-builder",
    name: "Agent Builder",
    description: "Designs grounding, tools, and evaluations. Authors artifacts; does not self-approve in peer mode.",
    isApprover: false,
    isVeto: false,
    requiresCredentialKey: null,
    ordinal: 3,
  },
  {
    id: "data-product-owner",
    name: "Data Product Owner",
    description:
      "Owns the bound data products and their contracts. Approves what an agent is allowed to stand on.",
    isApprover: true,
    isVeto: false,
    requiresCredentialKey: null,
    ordinal: 4,
  },
  {
    id: "governance-officer",
    name: "Governance Officer",
    description: "Approves guardrails, certification, and publication.",
    isApprover: true,
    isVeto: false,
    requiresCredentialKey: "governance-officer-credential",
    ordinal: 5,
  },
  {
    id: "privacy-officer",
    name: "Privacy Officer",
    description: "Holds a blocking veto over agents touching personal or restricted data.",
    isApprover: true,
    isVeto: true,
    requiresCredentialKey: null,
    ordinal: 6,
  },
  {
    id: "security-officer",
    name: "Security Officer",
    description: "Holds a blocking veto over invocation access and action-taking agents.",
    isApprover: true,
    isVeto: true,
    requiresCredentialKey: null,
    ordinal: 7,
  },
  {
    id: "business-consumer",
    name: "Business Consumer",
    description: "Uses published agents and files feedback. Read-mostly.",
    isApprover: false,
    isVeto: false,
    requiresCredentialKey: null,
    ordinal: 8,
  },
];

const byKey = new Map(ROLES.map((role) => [role.id, role]));

export function roleByKey(key: string): RoleDefinition | undefined {
  return byKey.get(key as RoleKey);
}

export function roleName(key: string): string {
  return byKey.get(key as RoleKey)?.name ?? key;
}

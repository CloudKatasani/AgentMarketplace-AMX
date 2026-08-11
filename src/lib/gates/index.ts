/**
 * The gate engine's public surface.
 *
 * Two mutating entry points and nothing else. Import from here, never from the
 * individual modules, so the single-path rule stays legible at call sites.
 */
export { requestTransition } from "./request-transition";
export type { TransitionRequest, TransitionResult } from "./request-transition";

export { recordDecision } from "./record-decision";
export type { DecisionInput, DecisionResult } from "./record-decision";

export { cascadeFromArtifactRevision, cascadeFromProductMajorBump } from "./cascade";
export type { ProductCascadeResult } from "./cascade";

export { computeStageSnapshot } from "./snapshot";
export { assertMutable, requireMembership } from "./authorization";

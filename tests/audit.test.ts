import { describe, expect, it } from "vitest";

import { appendAuditEvent, verifyAuditChain } from "@/lib/audit/append";
import { db } from "@/lib/db";
import { canonicalize, contentHash, snapshotHash } from "@/lib/hash";
import { PrismaClient } from "@prisma/client";

import { inOrg, makeOrg } from "./helpers";

/** A handle that bypasses the extension, to prove the chain detects tampering. */
const unguarded = new PrismaClient();

describe("canonical hashing", () => {
  it("ignores key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(contentHash({ b: 1, a: [{ y: 1, x: 2 }] })).toBe(
      contentHash({ a: [{ x: 2, y: 1 }], b: 1 }),
    );
  });

  it("drops undefined but keeps null", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("makes the snapshot hash order-independent", () => {
    expect(snapshotHash(["a", "b"])).toBe(snapshotHash(["b", "a"]));
    expect(snapshotHash(["a", "b"])).not.toBe(snapshotHash(["a", "c"]));
  });
});

describe("the audit chain", () => {
  it("numbers events per organisation from 1", async () => {
    const org = await makeOrg({ seedStarter: false });
    const events = await inOrg(org.organizationId, () =>
      db.auditEvent.findMany({ orderBy: { sequence: "asc" }, select: { sequence: true } }),
    );
    expect(events[0].sequence).toBe(1);
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
  });

  it("links each event to its predecessor", async () => {
    const org = await makeOrg({ seedStarter: false });
    await inOrg(org.organizationId, () =>
      appendAuditEvent(db, {
        organizationId: org.organizationId,
        type: "agent.created",
        subjectType: "Agent",
        subjectId: "a1",
        payload: { note: "first" },
      }),
    );

    const events = await inOrg(org.organizationId, () =>
      db.auditEvent.findMany({ orderBy: { sequence: "asc" } }),
    );
    expect(events[0].prevHash).toBeNull();
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].prevHash).toBe(events[i - 1].hash);
    }
  });

  it("verifies a clean chain", async () => {
    const org = await makeOrg();
    const result = await inOrg(org.organizationId, () =>
      verifyAuditChain(db, org.organizationId),
    );
    expect(result.ok).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("detects an event edited behind the client's back", async () => {
    const org = await makeOrg({ seedStarter: false });
    const target = await inOrg(org.organizationId, () =>
      db.auditEvent.findFirst({ orderBy: { sequence: "asc" }, select: { id: true } }),
    );

    // Bypassing the extension is exactly the threat model: someone with database
    // access rewriting history. The chain is what makes that detectable.
    await unguarded.auditEvent.update({
      where: { id: target!.id },
      data: { payload: '{"planTier":"ENTERPRISE","tampered":true}' },
    });

    const result = await inOrg(org.organizationId, () =>
      verifyAuditChain(db, org.organizationId),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("altered");
  });

  it("detects a deleted event", async () => {
    const org = await makeOrg({ seedStarter: false });
    await inOrg(org.organizationId, () =>
      appendAuditEvent(db, {
        organizationId: org.organizationId,
        type: "agent.created",
        subjectType: "Agent",
        subjectId: "a1",
      }),
    );
    const first = await inOrg(org.organizationId, () =>
      db.auditEvent.findFirst({ orderBy: { sequence: "asc" }, select: { id: true } }),
    );

    await unguarded.auditEvent.delete({ where: { id: first!.id } });

    const result = await inOrg(org.organizationId, () =>
      verifyAuditChain(db, org.organizationId),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("missing");
  });

  it("keeps each organisation's chain independent", async () => {
    const alpha = await makeOrg({ seedStarter: false });
    const beta = await makeOrg({ seedStarter: false });

    const alphaEvents = await inOrg(alpha.organizationId, () => db.auditEvent.findMany());
    const betaEvents = await inOrg(beta.organizationId, () => db.auditEvent.findMany());

    expect(alphaEvents[0].sequence).toBe(1);
    expect(betaEvents[0].sequence).toBe(1);
    expect(alphaEvents[0].hash).not.toBe(betaEvents[0].hash);
  });
});

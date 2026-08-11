import Link from "next/link";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Band, Input, Label, Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { signIn } from "@/lib/auth";
import { getSessionContext } from "@/lib/auth/session-context";
import { createGuestWorkspace } from "@/lib/organizations/guest";

const db = new PrismaClient();

/**
 * Onboarding, in one step: pick an industry, get a workspace.
 *
 * This used to be two screens, and the second asked for a name, an email and a
 * password before anyone had seen the product. That is a wall in front of the
 * ten-minute promise, and it protects nothing — a workspace with one member and
 * no data is not a thing to guard.
 *
 * So the identity is minted server-side and the person lands on their own
 * seeded agent. Claiming the workspace with a real email and password happens
 * later, in settings, on the same user id — so nothing is lost and no artifact
 * changes hands.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; industry?: string }>;
}) {
  const existing = await getSessionContext();
  if (existing) redirect("/agents");

  const params = await searchParams;
  const industries = await db.industry.findMany({ orderBy: { name: "asc" } });
  const preselected = params.industry ?? "utilities";

  async function openWorkspace(formData: FormData) {
    "use server";

    const industryId = String(formData.get("industryId") ?? "_generic");
    const organizationName = String(formData.get("organizationName") ?? "").trim();

    const guest = await createGuestWorkspace({ industryId, organizationName });

    // The credentials exist for exactly this call and are never shown to anyone.
    await signIn("credentials", {
      email: guest.email,
      password: guest.password,
      redirectTo: guest.starterAgentId
        ? `/agents?tour=1&agent=${guest.starterAgentId}`
        : "/agents",
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-1.5 bg-brand-primary" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-12">
        <PageTitle>Pick an industry to start from</PageTitle>
        <Muted className="mt-2 max-w-prose">
          Your workspace lands with a starter agent already part-way through its lifecycle and
          certified data products beneath it. No email, no password, no card — you are one click
          away from a working workspace.
        </Muted>
        <Muted className="mt-2">
          Want to read first? The{" "}
          <Link href="/catalog">agent catalog</Link> shows every pack in full, without an account.
        </Muted>

        <Panel className="mt-6">
          <form action={openWorkspace} className="space-y-5">
            <fieldset>
              <legend className="mb-2 font-medium">Industry</legend>
              <div className="space-y-2">
                {industries.map((industry, index) => (
                  <label
                    key={industry.id}
                    className="flex cursor-pointer items-start gap-3 rounded border border-border bg-surface p-3 hover:bg-panel"
                  >
                    <input
                      type="radio"
                      name="industryId"
                      value={industry.id}
                      defaultChecked={
                        industry.id === preselected ||
                        (preselected === "utilities" && index === 0 && industries.length === 1)
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium">{industry.name}</span>
                      <span className="block text-muted">{industry.summary}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <Label htmlFor="organizationName" hint="optional — you can rename it later">
                Workspace name
              </Label>
              <Input
                id="organizationName"
                name="organizationName"
                placeholder="My workspace"
                autoFocus
              />
            </div>

            {params.error ? (
              <p className="rounded border-l-4 border-danger bg-danger/5 px-3 py-2 text-danger">
                {params.error}
              </p>
            ) : null}

            <Band>
              You will be signed in as a guest. Add your email and a password from settings
              whenever you want to keep the workspace or invite anyone — it keeps everything you
              have done.
            </Band>

            <Button type="submit" className="w-full">
              Open my workspace
            </Button>
          </form>
        </Panel>

        <p className="mt-4 text-muted">
          Already have an account? <Link href="/signin">Sign in</Link>. Or{" "}
          <Link href="/demo" prefetch={false}>explore the live demo</Link>.
        </p>
      </div>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Band, Input, Label, Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { getSessionContext } from "@/lib/auth/session-context";

const db = new PrismaClient();

/**
 * Onboarding, step 1 of 2: pick the industry and name the workspace.
 *
 * The industry comes first because it decides what lands in the workspace, and
 * the whole promise of this flow is that the next screen is already populated.
 * Account details come second — asking for a password before showing anyone
 * what they are signing up to is how you lose them.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const existing = await getSessionContext();
  if (existing) redirect("/agents");

  const params = await searchParams;
  const industries = await db.industry.findMany({ orderBy: { name: "asc" } });

  async function chooseIndustry(formData: FormData) {
    "use server";
    const industryId = String(formData.get("industryId") ?? "_generic");
    const organizationName = String(formData.get("organizationName") ?? "").trim();
    const workspaceName = String(formData.get("workspaceName") ?? "").trim();

    if (organizationName.length < 2) {
      redirect(`/onboarding?error=${encodeURIComponent("Give the organisation a name.")}`);
    }

    redirect(
      `/onboarding/account?industry=${encodeURIComponent(industryId)}&org=${encodeURIComponent(organizationName)}&workspace=${encodeURIComponent(workspaceName)}`,
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-1.5 bg-brand-primary" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-12">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-deep">Step 1 of 2</p>
        <PageTitle className="mt-1">Pick an industry to start from</PageTitle>
        <Muted className="mt-2 max-w-prose">
          Your workspace lands with a starter agent already part-way through its lifecycle and two
          certified data products beneath it. You can change any of it — the point is that you
          never start on an empty screen.
        </Muted>

        <Panel className="mt-6">
          <form action={chooseIndustry} className="space-y-5">
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
                      defaultChecked={industry.id === "utilities" || index === 0}
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
              <Label htmlFor="organizationName">Organisation name</Label>
              <Input id="organizationName" name="organizationName" required autoFocus />
            </div>

            <div>
              <Label htmlFor="workspaceName" hint="optional">
                Workspace name
              </Label>
              <Input id="workspaceName" name="workspaceName" placeholder="Retail & Revenue" />
            </div>

            {params.error ? (
              <p className="rounded border-l-4 border-danger bg-danger/5 px-3 py-2 text-danger">
                {params.error}
              </p>
            ) : null}

            <Band>
              Next: your account details, then straight into the workspace. It takes about a
              minute.
            </Band>

            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </Panel>

        <p className="mt-4 text-muted">
          Already have an account? <Link href="/signin">Sign in</Link>.
        </p>
      </div>
    </div>
  );
}

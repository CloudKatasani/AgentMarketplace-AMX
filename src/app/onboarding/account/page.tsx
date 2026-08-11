import Link from "next/link";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input, Label, Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { track } from "@/lib/analytics";
import { hashPassword, signIn } from "@/lib/auth";
import { getSessionContext } from "@/lib/auth/session-context";
import { createOrganization, slugify } from "@/lib/organizations/create";

const db = new PrismaClient();

const formSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name."),
  email: z.string().trim().toLowerCase().email("That doesn't look like an email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

/**
 * Onboarding, step 2 of 2.
 *
 * Creating the account, the organisation, the workspace, and the seeded
 * starter content happens in one submit — then the user lands on the guided
 * tour rather than a dashboard they have to interpret.
 */
export default async function OnboardingAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ industry?: string; org?: string; workspace?: string; error?: string }>;
}) {
  const existing = await getSessionContext();
  if (existing) redirect("/agents");

  const params = await searchParams;
  const organizationName = (params.org ?? "").trim();
  if (!organizationName) redirect("/onboarding");

  const industryId = params.industry ?? "_generic";
  const workspaceName = (params.workspace ?? "").trim();
  const industry = await db.industry.findUnique({ where: { id: industryId } });

  async function createAccount(formData: FormData) {
    "use server";

    const back = (message: string) =>
      redirect(
        `/onboarding/account?industry=${encodeURIComponent(industryId)}&org=${encodeURIComponent(organizationName)}&workspace=${encodeURIComponent(workspaceName)}&error=${encodeURIComponent(message)}`,
      );

    const parsed = formSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) back(parsed.error.issues[0].message);

    const { name, email, password } = parsed.data!;

    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      back("That email already has an account.");
    }

    const user = await db.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
      select: { id: true },
    });

    let slug = slugify(organizationName);
    if (await db.organization.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${slug}-${user.id.slice(-5)}`;
    }

    const created = await createOrganization({
      name: organizationName,
      slug,
      ownerUserId: user.id,
      ownerName: name,
      planTier: "FREE",
      industryId,
      workspaceName: workspaceName || undefined,
    });

    await track({
      name: "onboarding_step_completed",
      organizationId: created.organizationId,
      userId: user.id,
      properties: { step: "account-created", index: 2, industryId, surface: "wizard" },
    });

    // Straight into the tour, with the seeded agent already in hand.
    await signIn("credentials", {
      email,
      password,
      redirectTo: created.starterAgentId
        ? `/agents?tour=1&agent=${created.starterAgentId}`
        : "/agents",
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-1.5 bg-brand-primary" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-deep">Step 2 of 2</p>
        <PageTitle className="mt-1">Create your account</PageTitle>
        <Muted className="mt-2">
          {organizationName} on the {industry?.name ?? "generic"} pack. Next screen is your
          workspace, already populated.
        </Muted>

        <Panel className="mt-6">
          <form action={createAccount} className="space-y-4">
            <div>
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" required autoComplete="name" autoFocus />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="password" hint="at least 8 characters">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            {params.error ? (
              <p className="rounded border-l-4 border-danger bg-danger/5 px-3 py-2 text-danger">
                {params.error}
              </p>
            ) : null}

            <Button type="submit" className="w-full">
              Create workspace
            </Button>
          </form>
        </Panel>

        <p className="mt-4 text-muted">
          <Link href="/onboarding">← Back to industry</Link>
        </p>
      </div>
    </div>
  );
}

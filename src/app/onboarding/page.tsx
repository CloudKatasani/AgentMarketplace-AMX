import Link from "next/link";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input, Label, Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { hashPassword, signIn } from "@/lib/auth";
import { getSessionContext } from "@/lib/auth/session-context";
import { createOrganization, slugify } from "@/lib/organizations/create";

const db = new PrismaClient();

const formSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name."),
  email: z.string().trim().toLowerCase().email("That doesn't look like an email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  organizationName: z.string().trim().min(2, "Give the organisation a name."),
});

/**
 * Phase 1 onboarding: enough to get a person into a working, seeded workspace.
 * The industry-pack picker and the guided tour land with the wizard in Phase 2.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const existing = await getSessionContext();
  if (existing) redirect("/agents");

  const params = await searchParams;

  async function createAccount(formData: FormData) {
    "use server";

    const parsed = formSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      organizationName: formData.get("organizationName"),
    });
    if (!parsed.success) {
      redirect(`/onboarding?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
    }

    const { name, email, password, organizationName } = parsed.data;

    const alreadyRegistered = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (alreadyRegistered) {
      redirect(`/onboarding?error=${encodeURIComponent("That email already has an account.")}`);
    }

    const user = await db.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
      select: { id: true },
    });

    let slug = slugify(organizationName);
    if (await db.organization.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${slug}-${user.id.slice(-5)}`;
    }

    await createOrganization({
      name: organizationName,
      slug,
      ownerUserId: user.id,
      ownerName: name,
      planTier: "FREE",
    });

    await signIn("credentials", { email, password, redirectTo: "/agents" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-1.5 bg-brand-primary" />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-12">
        <PageTitle>Create your organisation</PageTitle>
        <Muted className="mt-2">
          You&rsquo;ll land in a workspace that already has two certified data products and an
          agent part-way through its lifecycle — so you can see the coverage matrix before you
          write anything.
        </Muted>

        <Panel className="mt-6">
          <form action={createAccount} className="space-y-4">
            <div>
              <Label htmlFor="organizationName">Organisation name</Label>
              <Input id="organizationName" name="organizationName" required />
            </div>
            <div>
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" required autoComplete="name" />
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
              Create organisation
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

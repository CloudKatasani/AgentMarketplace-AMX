import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Band, Input, Label, Muted, PageTitle, Panel } from "@/components/ui/primitives";
import { hashPassword, signIn } from "@/lib/auth";
import { getSessionContext, ORG_COOKIE } from "@/lib/auth/session-context";
import { db } from "@/lib/db";
import { withOrg } from "@/lib/db/scope";
import { acceptInvitation, resolveInvitation } from "@/lib/organizations/invitations";
import { roleName } from "@/lib/roles";

/**
 * Un-extended client: creating the account happens before any organisation is
 * known, exactly as at sign-in. `User` is global, so nothing tenant-scoped is
 * reachable through this handle.
 */
const users = new PrismaClient();

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name."),
  password: z.string().min(8, "Use at least 8 characters."),
});

/**
 * Accepting an invitation — the join path into an existing workspace.
 *
 * The token is the only thing that authorises this page, so resolving it is the
 * single system-scoped lookup in the flow. Everything the acceptance writes
 * happens inside the organisation that token names.
 *
 * Two people land here: someone who already has an AMX account, and someone who
 * does not. Both end in the same place, with the same audit event.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;

  const invitation = await resolveInvitation(db, token);

  if (!invitation) return <Dead title="This invitation link is not valid." />;
  if (invitation.acceptedAt) return <Dead title="This invitation has already been used." />;
  if (invitation.expiresAt.getTime() < Date.now()) {
    return (
      <Dead
        title="This invitation has expired."
        body={`It was valid until ${invitation.expiresAt.toISOString().slice(0, 10)}. Ask an admin in ${invitation.organizationName} for a new one.`}
      />
    );
  }

  const session = await getSessionContext();
  const signedInAsInvitee =
    session?.userEmail.trim().toLowerCase() === invitation.email.toLowerCase();

  async function accept(formData: FormData) {
    "use server";

    const back = (message: string) =>
      redirect(`/invite/${token}?error=${encodeURIComponent(message)}`);

    const current = await getSessionContext();
    let userId = current?.userId ?? null;
    let email = current?.userEmail ?? null;
    let password: string | null = null;

    if (!userId) {
      const parsed = signUpSchema.safeParse({
        name: formData.get("name"),
        password: formData.get("password"),
      });
      if (!parsed.success) back(parsed.error.issues[0].message);

      email = invitation!.email;
      password = parsed.data!.password;

      const existing = await users.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        back("That email already has an account — sign in first, then open this link again.");
      }

      const created = await users.user.create({
        data: { email, name: parsed.data!.name, passwordHash: await hashPassword(password) },
        select: { id: true },
      });
      userId = created.id;
    }

    const result = await withOrg(invitation!.organizationId, (scoped) =>
      acceptInvitation(scoped, { token, userId: userId!, userEmail: email! }),
    );
    if (!result.ok) back(result.detail);

    // Land in the workspace they just joined, not whichever one they had before.
    (await cookies()).set(ORG_COOKIE, invitation!.organizationId, {
      path: "/",
      sameSite: "lax",
    });

    if (password) {
      await signIn("credentials", { email: email!, password, redirectTo: "/agents" });
    }
    redirect("/agents");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-1.5 bg-brand-primary" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <PageTitle>Join {invitation.organizationName}</PageTitle>
        <Muted className="mt-2">
          You have been invited as{" "}
          <span className="font-medium">{roleName(invitation.roleId)}</span>, for{" "}
          {invitation.email}.
        </Muted>

        {query.error ? <Band className="mt-4 text-warning">{query.error}</Band> : null}

        {session && !signedInAsInvitee ? (
          <Panel className="mt-6">
            <Muted>
              You are signed in as {session.userEmail}, but this invitation was sent to{" "}
              {invitation.email}. Sign out and open this link again to accept it.
            </Muted>
            <div className="mt-4">
              <Button asChild variant="outline">
                <Link href="/signin">Go to sign in</Link>
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel className="mt-6">
            <form action={accept} className="space-y-4">
              {session ? (
                <Muted>
                  You are signed in as {session.userEmail}. Accepting adds this workspace to your
                  account — you will be able to switch between them in the header.
                </Muted>
              ) : (
                <>
                  <div>
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" name="name" required />
                  </div>
                  <div>
                    <Label htmlFor="password" hint="at least 8 characters">
                      Choose a password
                    </Label>
                    <Input id="password" name="password" type="password" required minLength={8} />
                  </div>
                </>
              )}
              <Button type="submit" className="w-full">
                Accept the invitation
              </Button>
            </form>
          </Panel>
        )}

        <Muted className="mt-6">
          Already have an account on a different address? <Link href="/signin">Sign in</Link>{" "}
          first, then open this link again.
        </Muted>
      </div>
    </div>
  );
}

function Dead({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <PageTitle>{title}</PageTitle>
      <Muted className="mt-2">
        {body ?? "Ask whoever invited you to send a fresh invitation."}
      </Muted>
      <div className="mt-6">
        <Button asChild variant="outline">
          <Link href="/signin">Go to sign in</Link>
        </Button>
      </div>
    </div>
  );
}

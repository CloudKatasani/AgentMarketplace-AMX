import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { Button } from "@/components/ui/button";
import { Input, Label, PageTitle, Muted, Panel } from "@/components/ui/primitives";
import { getSessionContext } from "@/lib/auth/session-context";
import { signIn } from "@/lib/auth";
import { ssoConfig, SSO_PROVIDER_ID } from "@/lib/auth/sso";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const session = await getSessionContext();
  if (session) redirect("/agents");

  const params = await searchParams;
  // Rendered only when this deployment has an identity provider configured, so
  // the screen never offers a door that is not there.
  const sso = ssoConfig();

  async function startSso() {
    "use server";
    await signIn(SSO_PROVIDER_ID, { redirectTo: "/agents" });
  }

  async function authenticate(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").toLowerCase();
    const password = String(formData.get("password") ?? "");
    try {
      await signIn("credentials", { email, password, redirectTo: "/agents" });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect(`/signin?error=invalid&email=${encodeURIComponent(email)}`);
      }
      throw error;
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-1.5 bg-brand-primary" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <PageTitle>AMX</PageTitle>
        <Muted className="mt-2">
          The certification and distribution layer for enterprise AI agents.
        </Muted>

        <Panel className="mt-6">
          <form action={authenticate} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={params.email ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>

            {params.error ? (
              <p className="rounded border-l-4 border-danger bg-danger/5 px-3 py-2 text-danger">
                That email and password don&rsquo;t match an account. If you started without one,
                open a workspace below instead — guest workspaces have no password until you
                claim them.
              </p>
            ) : null}

            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>

          {sso ? (
            <form action={startSso} className="mt-4 border-t border-border pt-4">
              <Button type="submit" variant="outline" className="w-full">
                Continue with {sso.label}
              </Button>
              <Muted className="mt-2">
                Signing in this way proves who you are. Joining a workspace still happens through
                an invitation, and roles are still granted by an admin.
              </Muted>
            </form>
          ) : null}
        </Panel>

        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-4">
          <p className="font-medium">No account?</p>
          <Muted className="mt-1">
            You do not need one. Open a workspace in a click, or read the whole agent catalog and
            the live demo without signing in at all.
          </Muted>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/onboarding">Open a workspace</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/catalog">Browse the agent catalog</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/demo" prefetch={false}>Explore the live demo</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

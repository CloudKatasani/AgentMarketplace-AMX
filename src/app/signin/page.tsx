import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { Button } from "@/components/ui/button";
import { Input, Label, PageTitle, Muted, Panel } from "@/components/ui/primitives";
import { getSessionContext } from "@/lib/auth/session-context";
import { signIn } from "@/lib/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const session = await getSessionContext();
  if (session) redirect("/agents");

  const params = await searchParams;

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
                That email and password don&rsquo;t match an account.
              </p>
            ) : null}

            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </Panel>

        <p className="mt-4 text-muted">
          No account yet? <Link href="/onboarding">Create an organisation</Link>.
        </p>
      </div>
    </div>
  );
}

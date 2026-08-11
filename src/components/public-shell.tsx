import Link from "next/link";

/**
 * The shell for everything a visitor can see without an account.
 *
 * Signing in is one option in the nav, not the wall in front of the product.
 * The catalogue and the live demo sit at the same level, because for most
 * people arriving cold they are the reason to care at all.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-brand-primary text-surface">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <Link href="/" className="text-surface no-underline">
            <span className="text-lg font-semibold tracking-tight">AMX</span>
          </Link>
          <nav className="ml-auto flex items-center gap-4">
            <Link href="/catalog" className="text-surface no-underline">
              Agent catalog
            </Link>
            <Link href="/demo" prefetch={false} className="text-surface no-underline">
              Live demo
            </Link>
            <Link href="/signin" className="text-surface no-underline">
              Sign in
            </Link>
            <Link
              href="/onboarding"
              className="rounded bg-brand-deep px-3 py-1.5 text-surface no-underline"
            >
              Open a workspace
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-6 py-6 text-muted">
          <span>AMX · the certification and distribution layer for enterprise agents</span>
          <Link href="/catalog" className="ml-auto">
            Agent catalog
          </Link>
          <Link href="/demo" prefetch={false}>Live demo</Link>
        </div>
      </footer>
    </div>
  );
}

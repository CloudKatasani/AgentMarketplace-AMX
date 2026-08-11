import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSessionContext } from "@/lib/auth/session-context";
import { switchWorkspaceAction } from "@/app/(app)/switch-workspace";
import { GuidedTour } from "@/components/guided-tour";
import { Badge } from "@/components/ui/status";
import type { PlanTier } from "@/lib/enums";
import { can } from "@/lib/plans/features";
import { readThemeOverride, toCssVariables } from "@/lib/theme/override";

/**
 * The app shell.
 *
 * The header band is `--brand-primary`, the content surface is white, cards are
 * `--panel`. Getting that right once here means every subsequent screen
 * inherits the brand for free — which is the point of building the shell before
 * the features.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();
  if (!session) redirect("/signin");

  const nav = [
    { href: "/marketplace", label: "Marketplace" },
    { href: "/agents", label: "Agents" },
    { href: "/data-products", label: "Data products" },
    { href: "/academy", label: "Academy" },
    { href: "/audit", label: "Audit trail" },
    ...(session.roleKeys.includes("org-admin")
      ? [{ href: "/admin", label: "Settings" }]
      : []),
  ];

  // White-label: the tenant's override re-declares the same token names the
  // default theme uses, rebuilt from parsed integers rather than echoed text.
  // Losing the plan drops the override rather than stranding a rebrand nobody
  // can see the controls for.
  const theme = can(session.planTier as PlanTier, "whiteLabel")
    ? readThemeOverride(session.themeOverride)
    : null;
  const themeCss = theme ? toCssVariables(theme) : "";

  return (
    <div className="flex min-h-screen flex-col">
      {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
      <header className="bg-brand-primary text-surface">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <Link href="/agents" className="text-surface no-underline">
            <span className="text-lg font-semibold tracking-tight">AMX</span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-3 py-1.5 text-surface no-underline hover:bg-brand-deep"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {session.memberships.length > 1 ? (
              <form action={switchWorkspaceAction} className="flex items-center gap-2">
                <label htmlFor="organizationId" className="sr-only">
                  Workspace
                </label>
                <select
                  id="organizationId"
                  name="organizationId"
                  defaultValue={session.organizationId}
                  className="rounded bg-brand-deep px-2 py-1 text-surface"
                >
                  {session.memberships.map((membership) => (
                    <option key={membership.id} value={membership.id}>
                      {membership.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded bg-brand-deep px-2 py-1 text-surface hover:bg-brand-ink"
                >
                  Switch
                </button>
              </form>
            ) : (
              <span className="text-surface/90">{session.organizationName}</span>
            )}
            <span className="rounded bg-brand-deep px-2 py-0.5 text-xs uppercase tracking-wide">
              {session.planTier}
            </span>
            <span className="text-surface/70">{session.userName || session.userEmail}</span>
          </div>
        </div>
      </header>

      {session.isReadOnly ? (
        <div className="bg-band">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-2">
            <Badge tone="brand">Demo</Badge>
            <p className="text-brand-ink">
              This is the live demo workspace. Everything is real and nothing can be changed —
              create your own workspace to make edits.
            </p>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-4 text-muted">
          AMX · the certification and distribution layer for enterprise agents
        </div>
      </footer>

      {/* Renders only when the URL carries ?tour=; invisible otherwise. */}
      <Suspense fallback={null}>
        <GuidedTour />
      </Suspense>
    </div>
  );
}

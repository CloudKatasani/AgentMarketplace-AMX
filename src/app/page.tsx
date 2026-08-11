import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/session-context";

/**
 * Phase 1 has no marketing landing page yet — that lands with the pricing table
 * and demo entry point in Phase 4. Until then, the root goes where the work is.
 */
export default async function RootPage() {
  const session = await getSessionContext();
  redirect(session ? "/agents" : "/signin");
}

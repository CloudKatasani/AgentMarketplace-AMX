/**
 * Auth.js credentials sign-in.
 *
 * Sessions are JWT-backed: the credentials provider cannot use database
 * sessions, and Phase 1 has no OAuth provider to justify the adapter. The
 * `Account`/`Session` tables exist for when one arrives.
 *
 * Nothing here decides authorisation. Who may approve what is decided
 * server-side in `src/lib/gates/authorization.ts` against the database, every
 * time — a session only says who is asking.
 */
import { compare, hash } from "bcryptjs";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { ssoProviders, SSO_PROVIDER_ID } from "./sso";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/**
 * Un-extended client, deliberately.
 *
 * Sign-in happens before an organisation is known, so the tenancy extension —
 * which throws without one — cannot be used here. `User` is a global model, so
 * nothing tenant-scoped is reachable through this handle.
 */
const authDb = new PrismaClient();

export const PASSWORD_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_ROUNDS);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  /**
   * Auth.js only auto-trusts the host on Vercel. AMX is meant to be run
   * wherever the buyer runs it — a container, a VM, behind their own proxy — so
   * the host is trusted explicitly and `AUTH_URL` pins the canonical origin.
   */
  trustHost: true,
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await authDb.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          select: { id: true, email: true, name: true, passwordHash: true, archivedAt: true },
        });
        if (!user?.passwordHash || user.archivedAt) return null;

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    // Present only when this deployment configures an identity provider.
    ...ssoProviders(),
  ],
  callbacks: {
    /**
     * SSO authenticates; it never authorises.
     *
     * A person who signs in through an identity provider must already have an
     * AMX account with that verified address. They join a workspace by
     * accepting an invitation, and roles are granted by an org-admin — so a
     * buyer's directory cannot mint approvers inside AMX by adding a user to a
     * group.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== SSO_PROVIDER_ID) return true;

      const email = profile?.email?.toLowerCase();
      if (!email || profile?.email_verified === false) return false;

      const user = await authDb.user.findUnique({
        where: { email },
        select: { id: true, archivedAt: true },
      });
      return Boolean(user && !user.archivedAt);
    },
    async jwt({ token, user, account, profile }) {
      if (user?.id) token.sub = user.id;

      // The OIDC path yields a provider-side id; map it to the AMX user, whose
      // id is what every tenant-scoped check in the product is written against.
      if (account?.provider === SSO_PROVIDER_ID && profile?.email) {
        const known = await authDb.user.findUnique({
          where: { email: profile.email.toLowerCase() },
          select: { id: true },
        });
        if (known) token.sub = known.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

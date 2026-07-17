import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { initializeDatabase } from "@/lib/rules-db";
import { verifyPassword } from "@/lib/password";
import { database, withDatabaseRetry } from "@/lib/turso";

const SESSION_COOKIE = "siconfi_session";
const SESSION_DURATION_SECONDS = 12 * 60 * 60;
const DUMMY_PASSWORD_HASH =
  "scrypt$00000000000000000000000000000000$373f8e9a7e5369a3f3a924ff35878d76d6b3a7b2b07c08bfa2dfc6668c6509ea582588264f33c6a923cce6a7ff40ceb56e4884712a16c1df06535d301e24b7d1";

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  role: string;
};

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateUser(email: string, password: string) {
  await initializeDatabase();
  const normalizedEmail = email.trim().toLowerCase();
  const row = await withDatabaseRetry((client) => client.get(
    `
      SELECT id, email, display_name AS displayName, password_hash AS passwordHash, role
      FROM app_users
      WHERE email = ? AND active = 1
      LIMIT 1
    `,
    normalizedEmail,
  )) as (AuthUser & { passwordHash: string }) | undefined;

  const passwordMatches = await verifyPassword(
    password,
    row?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!row || !passwordMatches) return null;

  return {
    id: Number(row.id),
    email: String(row.email),
    displayName: String(row.displayName),
    role: String(row.role),
  } satisfies AuthUser;
}

export async function createSession(userId: number) {
  await initializeDatabase();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);

  await database.execute("DELETE FROM app_sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP");
  await database.execute(
    "INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [tokenHash, userId, expiresAt.toISOString()],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high",
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await initializeDatabase();
    await database.execute("DELETE FROM app_sessions WHERE token_hash = ?", [hashSessionToken(token)]);
  }

  cookieStore.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  await initializeDatabase();
  const row = await withDatabaseRetry((client) => client.get(
    `
      SELECT u.id, u.email, u.display_name AS displayName, u.role
      FROM app_sessions s
      INNER JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND datetime(s.expires_at) > CURRENT_TIMESTAMP
        AND u.active = 1
      LIMIT 1
    `,
    hashSessionToken(token),
  )) as AuthUser | undefined;

  if (!row) return null;

  return {
    id: Number(row.id),
    email: String(row.email),
    displayName: String(row.displayName),
    role: String(row.role),
  };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

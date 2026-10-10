"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import { api, clearToken, getToken } from "@/lib/client/api";
import { IconDocs, IconHome, IconOrganization, IconSignOut, IconUsers } from "./ui/icons";

type Me = { display_name: string; roles: string[]; auth_issuer: "entra" | "test" };
type Perms = { permissions: string[] };
type Session = { me: Me; can: (p: string) => boolean };

const SessionContext = createContext<Session | null>(null);
export function useSession() {
  return useContext(SessionContext);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isLogin = pathname.startsWith("/login");

  useEffect(() => {
    if (isLogin) return;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api<Me>("/api/v1/me"), api<Perms>("/api/v1/core-hr/me/permissions")])
      .then(([me, perms]) => {
        const set = new Set(perms.data.permissions);
        setSession({ me: me.data, can: (p) => set.has(p) });
      })
      .catch((e) => setError(e.message));
  }, [isLogin, router]);

  if (isLogin) {
    return (
      <main className="login-page">
        <span className="wordmark">{t("app.name")}</span>
        <div className="login-body">{children}</div>
      </main>
    );
  }

  // Core HR Phase 1 navigation: Home, Employees, Organization — each gated by a capability, never a role name.
  // Home is a placeholder until UI-1 (no route yet: "/" still opens the Employee List).
  const nav = [
    { key: "employees", href: "/employees", label: t("nav.employees"), icon: <IconUsers />, show: session?.can("employees.read") },
    { key: "organization", href: "/catalogs", label: t("nav.organization"), icon: <IconOrganization />, show: session?.can("catalogs.read") },
  ];

  return (
    <SessionContext.Provider value={session}>
      <div className="app">
        <aside className="sidebar">
          <Link href="/employees" className="wordmark">
            {t("app.name")}
          </Link>
          <nav className="nav" aria-label={t("nav.main")}>
            {session?.can("employees.read") && (
              <span className="nav-item" aria-disabled="true" title={t("nav.homeSoonHint")}>
                <IconHome />
                {t("nav.home")}
                <span className="nav-soon">{t("nav.homeSoon")}</span>
              </span>
            )}
            {nav
              .filter((n) => n.show)
              .map((n) => {
                const active = pathname.startsWith(n.href);
                return (
                  <Link key={n.key} href={n.href} className={active ? "nav-item active" : "nav-item"} aria-current={active ? "page" : undefined}>
                    {n.icon}
                    {n.label}
                  </Link>
                );
              })}
          </nav>
          <div className="sidebar-footer">
            {session?.can("docs.read") && (
              <Link href="/internal/docs" className={pathname.startsWith("/internal/docs") ? "nav-item active" : "nav-item"}>
                <IconDocs />
                {t("nav.apiDocs")}
              </Link>
            )}
            {session && (
              <>
                <div className="user-block">
                  <span className="avatar" aria-hidden="true">
                    {initials(session.me.display_name)}
                  </span>
                  <div className="user-text">
                    <div className="user-name">{session.me.display_name}</div>
                    <div className="user-roles">{session.me.roles.join(", ")}</div>
                  </div>
                </div>
                {session.me.auth_issuer === "test" && (
                  <span className="badge warn sidebar-badge">
                    {t("nav.testIdentity")}
                  </span>
                )}
                <button
                  type="button"
                  className="ghost sign-out"
                  onClick={() => {
                    clearToken();
                    router.replace("/login");
                  }}
                >
                  <IconSignOut />
                  {t("nav.signOut")}
                </button>
              </>
            )}
          </div>
        </aside>
        <main className="content">
          <div className="page">
            {error && <p className="alert error">{error}</p>}
            {session ? children : !error && <p className="muted">{t("app.loading")}</p>}
          </div>
        </main>
      </div>
    </SessionContext.Provider>
  );
}

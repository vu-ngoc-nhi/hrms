"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import { api, clearToken, getToken } from "@/lib/client/api";

type Me = { display_name: string; roles: string[]; auth_issuer: "entra" | "test" };
type Perms = { permissions: string[] };
type Session = { me: Me; can: (p: string) => boolean };

const SessionContext = createContext<Session | null>(null);
export function useSession() {
  return useContext(SessionContext);
}

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

  if (isLogin) return <main className="page narrow">{children}</main>;

  const nav = [
    { href: "/employees", label: t("nav.employees"), show: session?.can("employees.read") },
    { href: "/catalogs", label: t("nav.catalogs"), show: session?.can("catalogs.read") },
    { href: "/internal/docs", label: t("nav.apiDocs"), show: session?.can("docs.read") },
  ];

  return (
    <SessionContext.Provider value={session}>
      <header className="topbar">
        <Link href="/employees" className="brand">
          {t("app.name")}
        </Link>
        <nav>
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? "active" : ""}>
                {n.label}
              </Link>
            ))}
        </nav>
        <div className="who">
          {session && (
            <>
              <span>{session.me.display_name}</span>
              {session.me.auth_issuer === "test" && <span className="badge warn">{t("nav.testIdentity")}</span>}
              <button
                className="link"
                onClick={() => {
                  clearToken();
                  router.replace("/login");
                }}
              >
                {t("nav.signOut")}
              </button>
            </>
          )}
        </div>
      </header>
      <main className="page">
        {error && <p className="alert error">{error}</p>}
        {session ? children : !error && <p className="muted">{t("app.loading")}</p>}
      </main>
    </SessionContext.Provider>
  );
}

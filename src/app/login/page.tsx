"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { setToken } from "@/lib/client/api";

type TestUser = { object_id: string; display_name: string; roles: string[] };

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<TestUser[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/dev/test-users", { cache: "no-store" })
      .then(async (r) => (r.ok ? setUsers((await r.json()).data) : setUnavailable(true)))
      .catch(() => setUnavailable(true));
  }, []);

  async function signIn(objectId: string) {
    setBusy(objectId);
    const r = await fetch("/api/v1/dev/test-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object_id: objectId }),
    });
    setBusy(null);
    if (!r.ok) return setUnavailable(true);
    setToken((await r.json()).access_token);
    router.replace("/");
  }

  return (
    <>
      <h1>{t("login.title")}</h1>
      {unavailable && <div className="alert warn">{t("login.entraNotConfigured")}</div>}
      {users && (
        <div className="card">
          <div className="alert warn">{t("login.testIdentityNotice")}</div>
          <table>
            <thead>
              <tr>
                <th>{t("login.account")}</th>
                <th>{t("login.roles")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.object_id}>
                  <td>{u.display_name}</td>
                  <td>{u.roles.length ? u.roles.join(", ") : <span className="muted">{t("login.noRoles")}</span>}</td>
                  <td>
                    <button className="primary" disabled={busy !== null} onClick={() => signIn(u.object_id)}>
                      {t("login.useAccount")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

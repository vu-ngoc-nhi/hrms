import { t, tMaybe } from "@/i18n";
import type { ApiErrorBody } from "@/lib/client/api";

// Errors are shown from the UI catalog by error code; the server message is only a fallback.
export function ErrorBox({ error }: { error: { status?: number; body?: ApiErrorBody; message?: string } | null }) {
  if (!error) return null;
  const body = error.body;
  const title = (body && tMaybe(`errors.${body.error}`)) ?? body?.message ?? error.message ?? t("errors.generic");
  // Detail lines in plain words: catalogued codes replace server text that may name internal ids; technical field
  // names are never shown; repeated lines (one per blocking record) are shown once.
  const lines = [...new Set((body?.details ?? []).map((d) => tMaybe(`errors.detail.${d.code}`) ?? d.message))];
  return (
    <div className="alert error" role="alert">
      <strong>{title}</strong>
      {!body?.details?.length && body?.message && body.message !== title ? <div>{body.message}</div> : null}
      {lines.length ? (
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {body?.request_id && body.request_id !== "-" && <div className="muted small">{t("errors.requestId", { id: body.request_id })}</div>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { ApiReference } from "./ApiReference";

// The page shell is public; the spec itself is fetched with a bearer token from an API that requires docs.read.
export default function InternalDocsPage() {
  const [spec, setSpec] = useState<object | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);

  useEffect(() => {
    api<object>("/api/v1/internal/openapi.json")
      .then((r) => setSpec(r.data))
      .catch((e) => setError(e));
  }, []);

  if (error) return <ErrorBox error={error} />;
  if (!spec) return <p className="muted">{t("docs.loading")}</p>;
  return <ApiReference spec={spec} />;
}

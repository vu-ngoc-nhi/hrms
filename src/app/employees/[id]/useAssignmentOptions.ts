"use client";

import { useEffect, useState } from "react";
import { api, ApiCallError } from "@/lib/client/api";

export type Option = { id: string; label: string };
export type AssignmentOptions = { departments: Option[]; jobTitles: Option[]; levels: Option[]; managers: Option[] };

const EMPTY: AssignmentOptions = { departments: [], jobTitles: [], levels: [], managers: [] };

/**
 * Loads catalog and manager options for assignment forms while `open`.
 * `includeInactive` is for historical corrections only (C-44): inactive catalog values are labelled as such.
 */
export function useAssignmentOptions(open: boolean, personId: string, onError: (e: ApiCallError) => void, includeInactive = false) {
  const [opts, setOpts] = useState<AssignmentOptions>(EMPTY);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const list = (path: string) =>
      api<{ data: { id: string; code: string; name?: string; name_en?: string; is_active: boolean }[] }>(
        `/api/v1/core-hr/${path}?page_size=100${includeInactive ? "&include_inactive=true" : ""}`,
      ).then((r) =>
        r.data.data
          .filter((x) => includeInactive || x.is_active)
          .map((x) => ({ id: x.id, label: `${x.name ?? x.name_en} (${x.code})${x.is_active ? "" : " ✕"}` })),
      );
    Promise.all([
      list("departments"),
      list("job-titles"),
      list("job-levels"),
      api<{ data: { id: string; employee_code: string; full_name: string }[] }>(
        "/api/v1/core-hr/employees?employment_status=active&page_size=100",
      ).then((r) => r.data.data.filter((x) => x.id !== personId).map((x) => ({ id: x.id, label: `${x.full_name} (${x.employee_code})` }))),
    ])
      .then(([departments, jobTitles, levels, managers]) => {
        if (!cancelled) setOpts({ departments, jobTitles, levels, managers });
      })
      .catch((e) => {
        if (!cancelled) onError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [open, personId, includeInactive, onError]);
  return opts;
}

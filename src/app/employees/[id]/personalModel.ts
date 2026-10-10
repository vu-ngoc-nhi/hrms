// UI-4 Personal Information: pure helpers for the Personal tab. One backend action exists (PATCH employee profile);
// its reason rule (C-23) is mirrored here only to guide the user — the server still decides and enforces it.
//  - Normal update, no reason: Gender, Mobile, Personal Email, and filling in a missing Date of Birth.
//  - Correction, reason required: changing Full Name; correcting or removing a recorded Date of Birth.
// The supported fields are intentionally minimal (no National ID, address, family, bank or other sensitive data).

export const GENDERS = ["female", "male", "other"] as const; // the authoritative contract values (unchanged)

export type PersonalData = { gender: string | null; date_of_birth: string | null; mobile_phone: string | null; personal_email: string | null };
export type ProfileSource = { revision: number; full_name: string; personal?: PersonalData };

/** What the Personal tab may offer, from server capabilities (never role names, C-85). */
export function personalCapabilities(can: (permission: string) => boolean, profile: ProfileSource) {
  // `personal` is only present when the server granted employees.read_personal.
  const visible = profile.personal !== undefined;
  const update = can("employees.update");
  const writePersonal = update && can("employees.write_personal") && visible;
  return {
    /** The personal group can be read. */
    visible,
    /** Normal update of personal/contact values. */
    edit: writePersonal,
    /** Correction of Full Name (employees.update) … */
    correct: update,
    /** … and of a recorded Date of Birth (also needs the personal write capability). */
    correctDateOfBirth: writePersonal && Boolean(profile.personal?.date_of_birth),
  };
}

// ---- Normal update -------------------------------------------------------------------------------------------
export type EditValues = { gender: string; date_of_birth: string; mobile_phone: string; personal_email: string };

export function editInitial(p: ProfileSource): EditValues {
  return {
    gender: p.personal?.gender ?? "",
    date_of_birth: p.personal?.date_of_birth ?? "",
    mobile_phone: p.personal?.mobile_phone ?? "",
    personal_email: p.personal?.personal_email ?? "",
  };
}

/** A recorded Date of Birth is not editable here (changing it is a correction); a missing one may be filled in. */
export const dateOfBirthEditable = (p: ProfileSource) => !p.personal?.date_of_birth;

export function editChanges(p: ProfileSource, form: EditValues): (keyof EditValues)[] {
  const start = editInitial(p);
  return (Object.keys(start) as (keyof EditValues)[]).filter(
    (f) => form[f].trim() !== start[f].trim() && (f !== "date_of_birth" || dateOfBirthEditable(p)),
  );
}

/** PATCH body for a normal update; never carries Full Name or a reason. Null when nothing changed. */
export function editPayload(p: ProfileSource, form: EditValues) {
  const changed = editChanges(p, form);
  if (!changed.length) return null;
  const personal: Record<string, string | null> = {};
  for (const f of changed) personal[f] = form[f].trim() === "" ? null : form[f].trim();
  return { expected_revision: p.revision, personal };
}

// ---- Correction ------------------------------------------------------------------------------------------------
export type CorrectionValues = { full_name: string; date_of_birth: string };

export function correctionInitial(p: ProfileSource): CorrectionValues {
  return { full_name: p.full_name, date_of_birth: p.personal?.date_of_birth ?? "" };
}

export function correctionChanges(p: ProfileSource, form: CorrectionValues, includeDateOfBirth: boolean): (keyof CorrectionValues)[] {
  const start = correctionInitial(p);
  const out: (keyof CorrectionValues)[] = [];
  if (form.full_name.trim() !== start.full_name.trim()) out.push("full_name");
  if (includeDateOfBirth && form.date_of_birth.trim() !== start.date_of_birth.trim()) out.push("date_of_birth");
  return out;
}

/** PATCH body for a correction. Every change offered here needs a reason (C-23). Null when nothing changed. */
export function correctionPayload(p: ProfileSource, form: CorrectionValues, reason: string, includeDateOfBirth: boolean) {
  const changed = correctionChanges(p, form, includeDateOfBirth);
  if (!changed.length) return null;
  const body: { expected_revision: number; reason?: string; full_name?: string; personal?: { date_of_birth: string | null } } = {
    expected_revision: p.revision,
  };
  if (changed.includes("full_name")) body.full_name = form.full_name.trim();
  if (changed.includes("date_of_birth")) body.personal = { date_of_birth: form.date_of_birth.trim() || null };
  if (reason.trim()) body.reason = reason.trim();
  return body;
}

/** Field-level messages from an API error (e.g. `personal.mobile_phone`); the rest stays in the error box. */
type ErrorDetail = { field?: string; code: string; message: string };
export function fieldErrors(details: ErrorDetail[] | undefined, fields: Record<string, string>) {
  const byField: Record<string, string> = {};
  const rest: ErrorDetail[] = [];
  for (const d of details ?? []) {
    const key = d.field ? fields[d.field] : undefined;
    if (key && !byField[key]) byField[key] = d.message;
    else rest.push(d);
  }
  return { byField, rest };
}

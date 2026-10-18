// The caller, or null when the request carries no identity (the platform's
// health probe, or a local run without the headers). The same contract as the
// template's lib/storage.js currentUser, which function apps do not carry.
// Never default the absence into a value: code that needs a person handles
// null first.
export interface CurrentUserResult {
  email: string;
  groups: string[];
  member: boolean;
}

export function currentUser(headers: Headers): CurrentUserResult | null {
  const email = (headers.get("x-forwarded-user") ?? "").trim();
  if (!email) return null;
  const groups = (headers.get("x-forwarded-groups") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { email, groups, member: groups.some((g) => g.endsWith("-users")) };
}

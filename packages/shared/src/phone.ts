import { parsePhoneNumberFromString, getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import type { CountryCode } from "libphonenumber-js/max";

export type NormalizeResult =
  | { ok: true; e164: string; changed: boolean }
  | { ok: false; reason: string };

const stripSeparators = (s: string) => s.replace(/[\s\-().\/]/g, "");

let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}
export const countryName = (c: string): string => {
  try {
    return regionNames?.of(c) ?? c;
  } catch {
    return c;
  }
};

/**
 * Normalise any typed/pasted mobile number to E.164 (handout section 12).
 * Strip separators, reject letters, 00 -> +, 6..15 digits, try national then international, must be valid.
 */
export function normalize(raw: unknown, defaultCountry: string): NormalizeResult {
  const original = String(raw ?? "").trim();
  if (!original) return { ok: false, reason: "No number found" };
  let s = stripSeparators(original);
  if (/[a-z]/i.test(s)) return { ok: false, reason: "Contains letters" };
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return { ok: false, reason: "Too short" };
  if (digits.length > 15) return { ok: false, reason: "Too long" };
  const tries = plus ? ["+" + digits] : [digits, "+" + digits];
  for (const t of tries) {
    let p;
    try {
      p = parsePhoneNumberFromString(t, defaultCountry as CountryCode);
    } catch {
      p = undefined;
    }
    if (p && p.isValid()) {
      return { ok: true, e164: p.number, changed: stripSeparators(original) !== p.number };
    }
  }
  return { ok: false, reason: plus ? "Not a valid number" : `Not a valid ${countryName(defaultCountry)} number` };
}

export function formatInternational(e164: string): string {
  try {
    return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
  } catch {
    return e164;
  }
}

/** Show the first 4 and last 3 digits only. */
export function maskNumber(e164: string): string {
  const f = formatInternational(e164);
  const total = (f.match(/\d/g) ?? []).length;
  let k = 0;
  return f.replace(/\d/g, (d) => {
    k++;
    return k > 4 && k <= total - 3 ? "•" : d;
  });
}

export const countries = () =>
  getCountries()
    .map((c) => ({ code: c, dial: getCountryCallingCode(c), name: countryName(c) }))
    .sort((a, b) => a.name.localeCompare(b.name));

// ONE way to read an e-mail address (owner rule 30 Oct 2026): an e-mail ID is NOT case-sensitive and full-width look-alikes count as the plain characters.
// NFKC first (the full-width @ and letters become plain ones), then trim, then lower case. Only this form is hashed, stored, compared or shown.
// RAJAT1@DEMO.COM, Rajat1@DEMO.COM and rajat1@demo.com are the same person. The employee-ID cleaner is a different thing and never touches an e-mail.
export const normEmail = (e: string): string => String(e == null ? "" : e).normalize("NFKC").replace(/\s+/g, "").toLowerCase(); // inner spaces go too (checklist A3)

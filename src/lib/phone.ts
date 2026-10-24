/**
 * Phone numbers are stored in E.164 (+233241234567). Customers type them many ways.
 * Ghana is the default country; other international numbers are accepted when they
 * start with + or 00.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    if (digits.startsWith('233') && digits.length !== 12) return null;
    return `+${digits}`;
  }
  if (/^0\d{9}$/.test(s)) return `+233${s.slice(1)}`; // 0241234567
  if (/^233\d{9}$/.test(s)) return `+${s}`; // 233241234567
  if (/^[2-5]\d{8}$/.test(s)) return `+233${s}`; // 241234567
  return null;
}

/** A Ghana mobile number: +233 then 2x or 5x followed by seven digits. */
export function isGhanaMobile(e164: string): boolean {
  return /^\+233[235]\d{8}$/.test(e164);
}

/** Arkesel and most Ghana SMS gateways want digits only: 233241234567. */
export function toSmsRecipient(e164: string): string {
  return e164.replace(/^\+/, '');
}

export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return `${e164.slice(0, 4)} ••• ••• ${e164.slice(-3)}`;
}

/** Friendly local format for display: +233241234567 -> 024 123 4567 */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+233(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}

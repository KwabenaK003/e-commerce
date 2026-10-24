import { z } from 'zod';
import { normalizePhone } from '@/lib/phone';
import { GH_REGIONS } from '@/lib/regions';

/** Checkbox values arrive from forms as "on" / "true". */
export const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const phoneField = z
  .string()
  .trim()
  .min(1, 'Enter a phone number')
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, for example 024 123 4567' });
      return z.NEVER;
    }
    return p;
  });

export const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid email address');

/** GhanaPost digital address, e.g. GA-183-8164. Optional. */
export const digitalAddress = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[A-Z]{2}-\d{3,4}-\d{4}$/.test(v), 'Format: GA-183-8164');

export const regionField = z.enum(GH_REGIONS, { errorMap: () => ({ message: 'Choose your region' }) });

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  recipient_name: z.string().trim().min(2, 'Enter the recipient name').max(100),
  phone: phoneField,
  region: regionField,
  town: z.string().trim().min(2, 'Enter your town or area').max(100),
  street_landmark: z.string().trim().min(3, 'Add a landmark or street so the rider can find you').max(300),
  digital_address: digitalAddress,
});
export type AddressInput = z.infer<typeof addressSchema>;

export const checkoutSchema = z
  .object({
    contact_name: z.string().trim().min(2, 'Enter your name').max(100),
    contact_phone: phoneField,
    contact_email: optionalEmail,
    fulfillment: z.enum(['delivery', 'pickup']),
    recipient_name: z.string().trim().max(100).optional(),
    delivery_phone: z.string().trim().max(30).optional(),
    region: z.string().trim().optional(),
    town: z.string().trim().max(100).optional(),
    street_landmark: z.string().trim().max(300).optional(),
    digital_address: z.string().trim().max(20).optional(),
    pickup_location_id: z.string().uuid().optional().or(z.literal('')),
    payment_method: z.enum(['paystack', 'pay_on_delivery']),
    coupon_code: z.string().trim().max(40).optional(),
    note: z.string().trim().max(500).optional(),
    sms_marketing: checkbox,
    email_marketing: checkbox,
    save_address: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === 'pickup') {
      if (!v.pickup_location_id) ctx.addIssue({ code: 'custom', path: ['pickup_location_id'], message: 'Choose a pickup location' });
      return;
    }
    if (!v.region || !(GH_REGIONS as readonly string[]).includes(v.region)) {
      ctx.addIssue({ code: 'custom', path: ['region'], message: 'Choose your region' });
    }
    if (!v.town || v.town.length < 2) ctx.addIssue({ code: 'custom', path: ['town'], message: 'Enter your town or area' });
    if (!v.street_landmark || v.street_landmark.length < 3) {
      ctx.addIssue({ code: 'custom', path: ['street_landmark'], message: 'Add a landmark or street so the rider can find you' });
    }
    if (v.digital_address && !/^[A-Za-z]{2}-\d{3,4}-\d{4}$/.test(v.digital_address)) {
      ctx.addIssue({ code: 'custom', path: ['digital_address'], message: 'Format: GA-183-8164' });
    }
    if (v.delivery_phone && !normalizePhone(v.delivery_phone)) {
      ctx.addIssue({ code: 'custom', path: ['delivery_phone'], message: 'Enter a valid phone number' });
    }
  });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Flatten zod issues to { field: message } (first message per field). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function formToObject(fd: FormData): Record<string, FormDataEntryValue> {
  const out: Record<string, FormDataEntryValue> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('$ACTION') || k.startsWith('cf-turnstile')) continue;
    out[k] = v;
  }
  return out;
}

export const returnRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Tell us why you are returning it').max(300),
  resolution: z.enum(['refund', 'exchange']),
  note: z.string().trim().max(1000).optional(),
});

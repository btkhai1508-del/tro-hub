/**
 * SePay Cổng thanh toán (payment gateway) for Trọ Hub service fees: a landlord opens the pay link of
 * their fee invoice, the Worker signs a checkout form and the browser posts it to pay.sepay.vn, where
 * they pay by card, bank transfer or NAPAS VietQR. Money lands in the Developer's merchant account.
 * SePay then calls the IPN, which settles the invoice. Rent never goes through here.
 *
 * Secrets (wrangler secret put): SEPAY_PG_MERCHANT_ID, SEPAY_PG_SECRET_KEY (merchant key, signs forms),
 * SEPAY_PG_IPN_SECRET (the key set at Cổng thanh toán → Cấu hình → IPN, auth type SECRET_KEY).
 * SEPAY_PG_ENV: "production" for live money, anything else is the sandbox.
 * Docs: https://developer.sepay.vn/vi/cong-thanh-toan/API/don-hang/form-thanh-toan, …/cong-thanh-toan/IPN
 */

export interface PgEnv {
  SEPAY_PG_MERCHANT_ID?: string;
  SEPAY_PG_SECRET_KEY?: string;
  SEPAY_PG_IPN_SECRET?: string;
  SEPAY_PG_ENV?: string;
}

export const pgConfigured = (env: PgEnv) => Boolean(env.SEPAY_PG_MERCHANT_ID && env.SEPAY_PG_SECRET_KEY && env.SEPAY_PG_IPN_SECRET);
export const pgLive = (env: PgEnv) => env.SEPAY_PG_ENV === 'production';
export const pgCheckoutUrl = (env: PgEnv) => `${pgLive(env) ? 'https://pay.sepay.vn' : 'https://pay-sandbox.sepay.vn'}/v1/checkout/init`;

/**
 * Fields in the order SePay's sample form uses. The signature covers the allowed fields in SePay's
 * own order (not this one), skipping empty values, so both orders are kept exactly as documented.
 */
const FORM_ORDER = ['order_amount', 'merchant', 'currency', 'operation', 'order_description', 'order_invoice_number', 'customer_id', 'payment_method', 'success_url', 'error_url', 'cancel_url', 'lang'] as const;
const SIGNED = ['order_amount', 'merchant', 'currency', 'operation', 'order_description', 'order_invoice_number', 'customer_id', 'payment_method', 'success_url', 'error_url', 'cancel_url'] as const;

type FormField = (typeof FORM_ORDER)[number];
export type CheckoutForm = Partial<Record<FormField, string>>;

export async function signCheckout(fields: CheckoutForm, secretKey: string) {
  const text = SIGNED.filter((f) => fields[f] && fields[f] !== '0').map((f) => `${f}=${fields[f]}`).join(',');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...mac));
}

const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** One order per attempt: SePay wants order_invoice_number unique, so the invoice code gets a suffix. */
export const pgOrderNumber = (invoiceCode: string) => `${invoiceCode}_${Date.now().toString(36).toUpperCase()}`;
/** The invoice code back from an order number made by pgOrderNumber. */
export const invoiceCodeOf = (orderNumber: string) => orderNumber.split("_")[0]?.toUpperCase() ?? '';

/** A page that posts the signed form to SePay on load, with a button in case scripts are off. */
export async function checkoutPage(env: PgEnv, input: { amount: number; orderNumber: string; description: string; customerId: string; returnBase: string }) {
  const fields: CheckoutForm = {
    order_amount: String(input.amount),
    merchant: env.SEPAY_PG_MERCHANT_ID!,
    currency: 'VND',
    operation: 'PURCHASE',
    order_description: input.description,
    order_invoice_number: input.orderNumber,
    customer_id: input.customerId,
    success_url: `${input.returnBase}/pay/done?r=success`,
    error_url: `${input.returnBase}/pay/done?r=error`,
    cancel_url: `${input.returnBase}/pay/done?r=cancel`,
    lang: 'vi',
  };
  const signature = await signCheckout(fields, env.SEPAY_PG_SECRET_KEY!);
  const inputs = FORM_ORDER.filter((f) => fields[f])
    .map((f) => `<input type="hidden" name="${f}" value="${esc(fields[f]!)}">`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thanh toán phí Trọ Hub</title>
<body style="font-family:system-ui;max-width:420px;margin:48px auto;padding:0 16px">
<h2>Thanh toán phí Trọ Hub</h2><p>${esc(input.description)}<br><b>${input.amount.toLocaleString('vi-VN')} đ</b></p>
<p>Đang chuyển sang trang thanh toán của SePay…</p>
<form id="f" method="POST" action="${pgCheckoutUrl(env)}">${inputs}<input type="hidden" name="signature" value="${esc(signature)}">
<button type="submit" style="min-height:44px;padding:0 20px;font-size:16px">Tiếp tục thanh toán</button></form>
<script>document.getElementById('f').submit()</script></body>`;
}

/** Constant-time compare, so the IPN key cannot be guessed byte by byte from response times. */
export function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export interface PgIpn {
  notification_type?: string;
  order?: { order_status?: string; order_amount?: string; order_invoice_number?: string; order_currency?: string };
  transaction?: { id?: string; transaction_id?: string; payment_method?: string; transaction_type?: string; transaction_status?: string; transaction_amount?: string; transaction_currency?: string; transaction_date?: string };
}

/** A paid, approved payment from the IPN, or why it is not one. */
export function paidFromIpn(body: PgIpn) {
  const t = body.transaction ?? {};
  const o = body.order ?? {};
  if (body.notification_type !== 'ORDER_PAID') return { ok: false as const, reason: `ignored ${body.notification_type ?? 'unknown'}` };
  if (o.order_status !== 'CAPTURED' || t.transaction_status !== 'APPROVED' || (t.transaction_type && t.transaction_type !== 'PAYMENT'))
    return { ok: false as const, reason: 'not captured' };
  if ((o.order_currency ?? t.transaction_currency ?? 'VND') !== 'VND') return { ok: false as const, reason: 'currency' };
  const amount = Math.round(Number(t.transaction_amount ?? o.order_amount) || 0);
  const id = t.id || t.transaction_id;
  if (!id || amount <= 0 || !o.order_invoice_number) return { ok: false as const, reason: 'incomplete' };
  return {
    ok: true as const,
    id: `PG-${id}`,
    amount,
    invoiceCode: invoiceCodeOf(o.order_invoice_number),
    orderNumber: o.order_invoice_number,
    method: t.payment_method ?? 'PG',
    date: t.transaction_date ?? null,
  };
}

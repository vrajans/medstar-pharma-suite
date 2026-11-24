import { formatINR } from "@medstar/core";

/** Opens WhatsApp with a polite udhaar reminder; the staff member presses send. */
export function RemindButton({ phone, name, amountPaise, shop }: { phone: string; name: string | null; amountPaise: number; shop: string }) {
  const digits = phone.replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  const text = `Vanakkam ${name ?? ""}! This is a gentle reminder from ${shop}: your pending balance is ${formatINR(amountPaise)}. You can pay at the counter or by UPI. Thank you!`;
  return <a className="rounded bg-[#25D366] px-2 py-0.5 text-xs text-white" href={`https://wa.me/${to}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener">Remind</a>;
}

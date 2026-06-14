/**
 * ZenithOne Credit Union — Card Number Generation
 *
 * Produces realistic, Luhn-valid card numbers (PANs) that match the IIN
 * prefixes and lengths of the major US card networks. These are randomly
 * generated for a fictional credit union — they are not real accounts.
 */

export type CardNetwork = 'Visa' | 'Mastercard' | 'American Express' | 'Discover';

// IIN/BIN prefixes and total length per network (as used in the US).
const NETWORK_SPECS: Record<CardNetwork, { prefixes: string[]; length: number }> = {
  'Visa':             { prefixes: ['4'],                                              length: 16 },
  'Mastercard':       { prefixes: ['51', '52', '53', '54', '55', '2221', '2720'],     length: 16 },
  'American Express': { prefixes: ['34', '37'],                                        length: 15 },
  'Discover':         { prefixes: ['6011', '644', '645', '646', '647', '648', '649', '65'], length: 16 },
};

/** Compute the Luhn check digit for a partial number (everything but the last digit). */
function luhnCheckDigit(partial: string): number {
  let sum = 0;
  let double = true; // the position right before the check digit is doubled
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = partial.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** Generate a random, Luhn-valid PAN for the given network (defaults to Visa). */
export function generateCardNumber(network: string): string {
  const spec = NETWORK_SPECS[network as CardNetwork] ?? NETWORK_SPECS['Visa'];
  const prefix = spec.prefixes[Math.floor(Math.random() * spec.prefixes.length)];
  let num = prefix;
  while (num.length < spec.length - 1) num += Math.floor(Math.random() * 10);
  num += String(luhnCheckDigit(num));
  return num;
}

/** Group a PAN for display: Amex as 4-6-5, everything else as 4-4-4-4. */
export function formatPan(pan: string): string {
  if (!pan) return '';
  if (pan.length === 15) return `${pan.slice(0, 4)} ${pan.slice(4, 10)} ${pan.slice(10)}`;
  return pan.replace(/(.{4})/g, '$1 ').trim();
}

/** Identify the network from a PAN's prefix. */
export function detectNetwork(pan: string): CardNetwork | 'Card' {
  if (/^4/.test(pan)) return 'Visa';
  if (/^3[47]/.test(pan)) return 'American Express';
  if (/^6(?:011|5|4[4-9])/.test(pan)) return 'Discover';
  if (/^(?:5[1-5]|2[2-7])/.test(pan)) return 'Mastercard';
  return 'Card';
}

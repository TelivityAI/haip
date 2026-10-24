/** Bootstrap the self-contained MemoryRouter from the browser URL. */
export function bookingEntry(href: string): string {
  const url = new URL(href);
  const reference = url.searchParams.get('haip_payment_return');
  if (reference && /^[A-Za-z0-9_-]{43}$/.test(reference)) {
    return `/payment-return?reference=${encodeURIComponent(reference)}`;
  }

  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/booking') path = '/';
  else if (path.startsWith('/booking/')) path = path.slice('/booking'.length) || '/';

  if (path === '/check-in') {
    return `/check-in${url.search}`;
  }
  return '/';
}

/** @deprecated Use {@link bookingEntry}. Kept for callers/tests that still import the old name. */
export function paymentReturnEntry(href: string): string {
  return bookingEntry(href);
}

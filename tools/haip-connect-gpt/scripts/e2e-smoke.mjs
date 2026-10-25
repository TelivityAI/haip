#!/usr/bin/env node
/**
 * Staging E2E smoke for Ligare Hotels gateway.
 *
 * Env:
 *   GATEWAY_BASE_URL  — public gateway URL
 *   GATEWAY_API_KEY   — optional Bearer
 *   CITY              — default Paris
 *   PROPERTY_ID       — optional property UUID pin
 *
 * Flow: search → (optional) prepareBooking → confirmPayment path check → OpenAPI/MCP.
 */
const base = (process.env.GATEWAY_BASE_URL || '').replace(/\/+$/, '');
const key = process.env.GATEWAY_API_KEY || '';
const city = process.env.CITY || 'Paris';
const propertyId = process.env.PROPERTY_ID || '';

if (!base) {
  console.error('GATEWAY_BASE_URL required');
  process.exit(1);
}

const headers = {
  'content-type': 'application/json',
  ...(key ? { authorization: `Bearer ${key}` } : {}),
};

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const results = [];

const health = await req('GET', '/health');
results.push(['health', health.status === 200]);

const openapi = await req('GET', '/openapi.json');
const hasConfirm =
  openapi.status === 200 &&
  openapi.json?.paths?.['/reservations/{confirmationNumber}/confirm-payment'];
results.push(['openapi_confirmPayment', !!hasConfirm]);
results.push([
  'openapi_no_paymentToken',
  !openapi.json?.paths?.['/reservations']?.post?.requestBody?.content?.['application/json']?.schema
    ?.properties?.paymentToken,
]);

const mcp = await req('POST', '/mcp', {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
});
results.push(['mcp_tools_list', mcp.status === 200 && Array.isArray(mcp.json?.result?.tools)]);

const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 14);
const checkout = new Date(tomorrow);
checkout.setUTCDate(checkout.getUTCDate() + 2);
const checkIn = tomorrow.toISOString().slice(0, 10);
const checkOut = checkout.toISOString().slice(0, 10);

const search = await req('POST', '/hotels/search', {
  city,
  ...(propertyId ? { propertyId } : {}),
  checkIn,
  checkOut,
  adults: 2,
});
results.push(['search', search.status === 200]);
const searchResults = search.json?.results ?? [];
results.push(['search_results_array', Array.isArray(searchResults)]);

if (propertyId) {
  const detail = await req('GET', `/hotels/${propertyId}`);
  results.push(['property_detail_or_404', detail.status === 200 || detail.status === 404]);
}

console.log(JSON.stringify({ base, checkIn, checkOut, city, results, searchCount: searchResults.length }, null, 2));
const failed = results.filter(([, ok]) => !ok);
process.exit(failed.length ? 1 : 0);

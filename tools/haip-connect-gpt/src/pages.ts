/**
 * Landing and privacy pages, inlined as strings so the app never reads from disk.
 * This keeps the gateway portable across long-running (Node) and serverless
 * (Vercel) hosting — no filesystem/bundling assumptions.
 */

export const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telivity HAIP — Hotel Booking Gateway</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        max-width: 42rem; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.6;
      }
      h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
      .tag { color: #6b7280; font-size: 0.95rem; margin-top: 0; }
      code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
      a { color: #2563eb; }
      ul { padding-left: 1.2rem; }
      footer { margin-top: 2.5rem; color: #6b7280; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <h1>Telivity HAIP</h1>
    <p class="tag">ChatGPT gateway for the HAIP (Hotel AI Platform) Connect API.</p>
    <p>
      This service exposes hotel search and booking as a ChatGPT Action. It proxies the
      HAIP Connect API and returns guest-facing selling prices only.
    </p>
    <ul>
      <li><a href="/openapi.json">/openapi.json</a> — the OpenAPI 3.1 spec to import as a ChatGPT Action</li>
      <li><a href="/health">/health</a> — liveness</li>
      <li><a href="/privacy">/privacy</a> — privacy policy</li>
    </ul>
    <p>Available operations: <code>searchHotels</code>, <code>getProperty</code>,
      <code>createReservation</code>, <code>getReservation</code>,
      <code>modifyReservation</code>, <code>cancelReservation</code>.</p>
    <footer>© Telivity. HAIP is an open-source, API-first hotel PMS.</footer>
  </body>
</html>`;

export const privacyHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Privacy — Telivity HAIP</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        max-width: 42rem; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.6;
      }
      h1 { font-size: 1.5rem; }
      h2 { font-size: 1.1rem; margin-top: 1.75rem; }
      a { color: #2563eb; }
      footer { margin-top: 2.5rem; color: #6b7280; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <h1>Privacy Policy — Telivity HAIP</h1>
    <p><em>This is the privacy policy for the Telivity HAIP ChatGPT gateway.</em></p>

    <h2>What this service does</h2>
    <p>
      Telivity HAIP is a gateway that lets a ChatGPT assistant search hotels and create,
      look up, modify, or cancel reservations by calling the HAIP (Hotel AI Platform)
      Connect API on your behalf.
    </p>

    <h2>Data we process</h2>
    <p>
      To complete a booking, the assistant sends booking details to this gateway: stay
      dates, occupancy, the selected property/room/rate, and the guest details required by
      the hotel (name, and optionally email, phone, and loyalty number). These are
      forwarded to the HAIP API solely to fulfil your request.
    </p>

    <h2>Logging</h2>
    <p>
      We log each request to improve the service. Before logging, we redact guest personal
      information (name, email, phone, loyalty number, special requests), payment tokens,
      and booking confirmation numbers. Logged records contain non-identifying details such
      as location, dates, occupancy, room/rate identifiers, status, and timing, associated
      with a pseudonymous per-conversation session identifier.
    </p>

    <h2>Payments</h2>
    <p>
      This gateway never stores raw card data. Payment is handled by the hotel platform via
      tokenization.
    </p>

    <h2>Data sharing</h2>
    <p>
      We do not sell your data. Booking details are shared only with the hotel platform
      (HAIP) needed to fulfil your reservation.
    </p>

    <h2>Contact</h2>
    <p>For privacy questions, contact Telivity.</p>

    <footer>© Telivity.</footer>
  </body>
</html>`;

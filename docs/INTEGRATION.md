# Plugging MirrorMatch into a returns portal

A real store already has a returns portal: its own, or one from a returns platform. MirrorMatch doesn't replace it. It adds one step: when a shopper picks a colour reason, the portal asks MirrorMatch whether to offer a second try, and if so, sends the shopper to it.

## Endpoint

`POST /api/integrations/return-started`

Request body (JSON):

| Field | Type | Notes |
|---|---|---|
| `orderId` | string | The store's order ID. The demo store uses `HH-10421`, `HH-10388` and `HH-10307`. |
| `lineId` | string, optional | The order line being returned. Defaults to the order's first line. |
| `reason` | string | `wrong_shade` or `colour_didnt_suit` trigger MirrorMatch. `damaged`, `other` and anything else do not. |

### Response when MirrorMatch applies

```json
{
  "eligible": true,
  "sessionId": "3f6c…",
  "step": "offer",
  "url": "https://your-mirrormatch-host/#/return/3f6c…"
}
```

The session starts on the **offer** step ("See a better match on you before you decide?"), because the portal has already asked for the reason. The refund stays one tap away on every step.

### Response when it doesn't

```json
{ "eligible": false, "why": "reason_not_colour_related" }
```

`why` is one of these values:
- `reason_not_colour_related`
- `unknown_reason`
- `outside_return_window`
- `order_not_found`
- `order_line_not_found`

On any `eligible: false`, the portal carries on with its normal refund flow.

## Example

```bash
curl -s -X POST http://localhost:3000/api/integrations/return-started \
  -H "Content-Type: application/json" \
  -H "X-MirrorMatch-Secret: $WEBHOOK_SECRET" \
  -d '{"orderId":"HH-10421","lineId":"HH-10421-1","reason":"wrong_shade"}'
```

## How a portal uses it

1. The shopper picks a reason in the store's own returns form.
2. The portal's server calls the endpoint. Call it from the server, never from the browser, because the call carries the shared secret.
3. If `eligible` is true, redirect the shopper to `url`, or open it in an embedded view. Otherwise continue to the refund.
4. MirrorMatch runs the photo, matching and try-on steps. It creates the exchange, or hands back to the refund, and logs the outcome to the merchant dashboard.

In production, step 4's exchange and refund would call the store's order API instead of the demo store's in-memory catalogue. That piece is on the roadmap.

## Security and privacy

- **Shared secret.** Set `WEBHOOK_SECRET` in the server's environment. When it is set, every call must send the same value in the `X-MirrorMatch-Secret` header, or it gets a `401`. The comparison is constant-time. Leave it unset only for local demos.
- **Rate limit.** The endpoint shares the API's per-IP rate limit (`RATE_LIMIT_PER_MIN`).
- **Link lifetime.** Each session expires after `SESSION_TTL_MIN` minutes (default 20). A shopper who comes back later is offered a fresh start by the portal.
- **No personal data.** Sessions hold no personal data beyond the order reference. The shopper's photo is taken later, with consent, inside MirrorMatch, and deleted when the return ends.
- **Behind a proxy.** The returned `url` is built from the request's protocol and host. If you run behind a TLS-terminating proxy, configure Express's `trust proxy` setting so the link uses `https`.

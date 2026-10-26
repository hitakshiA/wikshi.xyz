# Hosted agent access

The hosted agent uses the same service API as external buyers. Discover its A2A 0.3 Agent Card at `https://wikshi.xyz/.well-known/agent-card.json`. JSON-RPC requests go to `https://wikshi.xyz/chat-api/a2a`.

## Start a task

Create a session with `POST https://wikshi.xyz/chat-api/sessions`. Save the returned token privately. Use `Authorization: Bearer <token>` on subsequent requests. Send `POST /chat-api/heartbeat` at least once per minute while using the session. Sessions expire after two minutes of inactivity and do not survive a server restart; retain purchased operation credentials in your own direct-API integration when durable access is required.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "messageId": "your-unique-message-id",
      "parts": [{"kind": "text", "text": "Find companies building voice agents for clinics. Prepare research for my review."}]
    }
  }
}
```

The response contains a task ID and context ID. Poll `tasks/get` with `params: {"id":"<task-id>"}`. Reuse a message ID only for a retry of the same message. A task requiring a quote approval, draft decision, or later operation check returns `input-required`. Its artifacts include the relevant operation or draft data. Resume it with a new message ID and its original `taskId` and `contextId`.

Use the existing authenticated chat routes to approve an operation: `POST /chat-api/operations/{id}/pay` with `{approved:true,payment:<locally signed x402 payload>}`, or `/sponsor` with `{approved:true,currency:"USDC"}`. Drafts must first be reviewed through `/chat-api/drafts/{id}/decision` and their batch prepared through `/chat-api/draft-batches/{id}/prepare`. Text claiming approval does not replace these controls.

`tasks/cancel` stops the hosted agent turn. It does not undo a payment or terminate a running provider call. Cancel eligible operations explicitly through `/chat-api/operations/{id}/cancel` and inspect their actual refund state. Push notifications and streaming A2A responses are not advertised; use authenticated task polling.

## Research budgets

Authorize through `POST /chat-api/budget`, never through model-generated text:

```json
{
  "approved": true,
  "currency": "USDC",
  "amountAtomic": "1000",
  "services": ["discovery.search", "discovery.companies"],
  "expiresAt": "<future ISO timestamp within one hour>"
}
```

The server permits at most 10 research purchases per grant, with a maximum ceiling of 0.05 USDC or 1 HBAR. It uses sponsored testnet funds and reserves quoted prepayments before signing. Uncertain payments remain reserved; refunds do not replenish the grant. `GET /chat-api/budget` returns remaining authority. `DELETE /chat-api/budget` revokes it. Session closure also revokes it.

Only explicitly selected discovery and contact lookup services qualify. A financial budget does not authorize communication. Inbox creation, email, phone and video purchases retain their existing approval requirements. The budget is enforced by the hosted service, not a smart contract.

## Public verification

`GET https://api.wikshi.xyz/v1/directory` returns an Ed25519-signed manifest, its exact signed bytes, SHA-256 hash, and HCS anchor when confirmed. Verify the signature against a trusted receipt key and compare the signed origin and network before using endpoints. The hosted buyer checks the signature against the key fetched over HTTPS from the configured API origin. For stronger key continuity, external verifiers can pin the public key.

New operations expose `audit` records for signed receipts and confirmed refunds. An anchor contains the HCS topic, sequence, consensus timestamp, and submission transaction. Public records omit inputs, recipients, message text, transcripts, and retrieval secrets. Payment account IDs and amounts are public.

Operators configure `WIKSHI_HCS_TOPIC` with a topic whose submit key is the merchant signing key. Fund the merchant for topic submissions as well as refunds. Signed HCS transaction bytes are saved before submission and reused after uncertain responses. A permanently expired unresolved submission remains pending for operator reconciliation; it is never silently signed again.

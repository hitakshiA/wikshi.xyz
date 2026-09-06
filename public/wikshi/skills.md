---
name: wikshi-workflows
description: Draft workflow guidance for an external agent using Wikshi discovery, enrichment, email, and phone capabilities. Not an executable integration.
---

# Wikshi workflows:  design draft

## Status
Obtain a verified API contract before executing this guidance. Do not invent endpoint URLs, prices, receipts, or successful provider actions.

## Responsibility
The caller is the agent. Wikshi provides services, not planning or independent authority. Follow the user's stated objective, recipient scope, consent constraints, and maximum spend.

## Capabilities
- Discovery: search the web, professional profiles, and companies through Wikshi.
- Enrichment: request business contact information when the task needs it.
- Email: use a scoped Wikshi inbox to send messages, receive replies, and follow up.
- Phone: request a bounded-duration call and return its outcome to the workflow.

## Hedera testnet setup
Use only a published, verified Wikshi service manifest. Confirm that the quoted network is Hedera testnet, inspect the x402 payment requirements, and request the user's spending limit before authorizing payment. Never use mainnet funds for a testnet task. This draft does not publish live endpoints or an installer; if access is unavailable, explain what is missing rather than inventing a successful request.

## Workflow: supplier sourcing
1. Clarify specifications, location, deadline, and allowed spend.
2. Discover relevant suppliers and retain source links.
3. Enrich only shortlisted business contacts; do not infer missing details.
4. Obtain authorization for the brief and recipients, then send the email.
5. Receive a genuine reply before claiming a response.
6. If authorized, call to clarify availability within the time allowance.
7. Return actual results, uncertainty, measured usage, and verified receipts.

## Workflow: event coordination
Discover venues, find their business events contact, request a quote by email, and call to confirm a requested date. Do not book or pay a deposit without explicit authority.

## Workflow: opted-in interview scheduling
Research professional context, check a supplied contact when necessary, send authorized scheduling details, and call only if authorized and appropriate. Never publish private contact information.

## Payment and failure rules
Inspect each quote before paying. Bind payment to an operation identifier. Enforce a total budget and per-call duration cap. Do not retry an uncertain send, call, or payment blindly: reconcile its status first. Report provider failures and missing receipts honestly. Honor opt-outs, stop requests, and data retention limits.

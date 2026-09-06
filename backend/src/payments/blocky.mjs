export const NETWORK = 'hedera:testnet';
export const USDC = '0.0.429274';
const ORIGIN = 'https://api.testnet.blocky402.com';
const account = /^0\.0\.[1-9]\d*$/;

export class PaymentError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Internal adapter only. Never expose this as a public settlement proxy.
export class Blocky {
  constructor(fetchImpl = fetch) { this.fetch = fetchImpl; }
  async request(path, body) {
    let response;
    try {
      response = await this.fetch(`${ORIGIN}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('upstream');
      return await response.json();
    } catch {
      // A settlement timeout is ambiguous, never evidence that no transfer occurred.
      // Reconcile the persisted transaction before considering another submission.
      throw new PaymentError(path === '/settle' ? 'settlement_unknown' : 'payment_service_unavailable');
    }
  }
  async supported() {
    const result = await this.request('/supported');
    const kind = result.kinds?.find(k => k.x402Version === 2 && k.scheme === 'exact' && k.network === NETWORK);
    if (!kind || !account.test(kind.extra?.feePayer ?? '')) throw new PaymentError('payment_network_unavailable');
    return {feePayer: kind.extra.feePayer};
  }
  async requirements({payTo, amount}) {
    if (!account.test(payTo) || typeof amount !== 'string' || !/^[1-9]\d{0,17}$/.test(amount)) {
      throw new PaymentError('invalid_quote');
    }
    const {feePayer} = await this.supported();
    return {scheme: 'exact', network: NETWORK, asset: USDC, amount, payTo, maxTimeoutSeconds: 120, extra: {feePayer}};
  }
  envelope(payload, requirements) {
    if (requirements.scheme !== 'exact' || requirements.network !== NETWORK || requirements.asset !== USDC) throw new PaymentError('invalid_quote');
    const accepted = payload?.accepted;
    const fields = ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds'];
    if (payload?.x402Version !== 2 || !accepted || fields.some(k => accepted[k] !== requirements[k]) || accepted.extra?.feePayer !== requirements.extra?.feePayer) throw new PaymentError('payment_quote_mismatch');
    const transaction = payload.payload?.transaction;
    if (typeof transaction !== 'string' || transaction.length === 0 || transaction.length > 32768 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(transaction)) throw new PaymentError('invalid_payment');
    return {x402Version: 2, paymentPayload: payload, paymentRequirements: requirements};
  }
  async verify(payload, requirements) {
    const response = await this.request('/verify', this.envelope(payload, requirements));
    if (response.isValid !== true || !account.test(response.payer ?? '')) throw new PaymentError('payment_rejected');
    return {payer: response.payer};
  }
  async settle(payload, requirements) {
    const response = await this.request('/settle', this.envelope(payload, requirements));
    if (response.success !== true || response.network !== NETWORK || !/^0\.0\.\d+@\d+\.\d+$/.test(response.transaction ?? '') || !account.test(response.payer ?? '')) {
      throw new PaymentError('settlement_unknown');
    }
    return {network: NETWORK, transaction: response.transaction, payer: response.payer};
  }
}

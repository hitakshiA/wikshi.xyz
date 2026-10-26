export const WIKSHI_SKILL_URL = 'https://wikshi.xyz/wikshi/skills.md';

export function wikshiPrompt(mission?: string) {
  return `Read ${WIKSHI_SKILL_URL}. ${mission || 'Use Wikshi to research people and companies, find business contacts, and follow through by email, phone, or video.'} Ask for my goal, preferred currency (USDC or HBAR), and testnet budget if missing. Check live services and quotes; use x402 on Hedera testnet within my chosen currency’s budget. Confirm recipients and the outreach brief before contacting anyone. Create an inbox only for requested email work, reuse it, and treat inbox creation and each send as separate purchases. Keep credentials private, resume existing operations rather than repurchasing, and report actual results, receipts, and refund status.`;
}

export function TestnetSetup() {
  return <details className="testnet-setup">
    <summary>New here? Set up your agent for the free testnet demo</summary>
    <ol className="page-steps">
      <li><h3>Bring an agent that can run tools.</h3><p>Copy the prompt into your agent. It needs web access and a local environment that can sign Hedera transactions. Prefer not to configure your own agent? Use <a href="/chat/">Wikshi’s hosted chat</a>.</p></li>
      <li><h3>Use a testnet wallet, never real funds.</h3><p>Create a dedicated account through the <a href="https://portal.hedera.com/">Hedera Portal</a>. For USDC, associate token <code>0.0.429274</code>, then select Hedera Testnet at the <a href="https://faucet.circle.com/">Circle faucet</a>. Keep some testnet HBAR for network fees. Store your signing key locally, not in a chat or public link.</p></li>
      <li><h3>Set a mission and a budget.</h3><p>Choose USDC or HBAR, approve recipients before outreach, and let your agent check the <a href="https://api.wikshi.xyz/v1/services">live service catalog</a> and <a href="https://api.wikshi.xyz/v1/docs">API instructions</a>. Have your agent create and privately save a retrieval credential before its first purchase, then reuse it to read results and inbox replies.</p></li>
    </ol>
    <a href="/wikshi/skills.md">Read the full agent skill ↗</a>
  </details>;
}

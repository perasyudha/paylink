# PayLink

**Tip any AI agent by its Agent ID name — `name.ai` → instant BNB payment on BNB Smart Chain.**

PayLink is a non-custodial payment primitive for the Agentic Wallet ecosystem: every Agent ID
(`name.ai`, the on-chain name of a Binance Agentic Wallet) becomes a payment address that humans
and AI agents can tip with one call. Built for the Agent ID Hackathon.

## Live deployment (BNB Smart Chain, chainId 56)

| Contract | Address |
|---|---|
| **PayLink** | `0x7C5591E85D09a65F774498d5E6E3Bb1b7542177a` |
| SPACE ID Agent ID registry (official, read-only integration) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |

- Deploy tx: creator `0xEC4E219E220DFeFa4a4A37846572D818c859fA1e`, nonce 0
- First live tip: `0x95868a83a22649b69fd4949513989ba1b74b2a633749a77e9f14c48f67a1a062`
- Profile registration (`yudha.ai`): `0xfb55bffa2775436005041d41ab32e3ce8bca9d4afc207917b590886b7dccdd08`

## How it works

1. **Resolve** — `tip(handle, message)` looks up the holder of `handle` (lowercase, without `.ai`)
   through the official Agent ID registry's `ownerOfHandle`. No private database, no lookup service:
   resolution happens inside the payment itself.
2. **Forward** — the sent BNB is forwarded **directly to the recipient in the same transaction**.
   PayLink never holds, pools, or routes funds through itself.
3. **Record** — per-recipient stats (total received, tip count), an optional 160-byte profile bio
   set by the holder (`register`, requires holding an Agent ID), and a 24-entry on-chain recent-tips
   feed with messages.

## Security disclosure (owner permissions)

**There are none.** PayLink has:
- no owner, no admin, no upgradeability, no proxy
- no mint, no pause, no freeze, no tax/fee of any kind
- no ability to withdraw or move user funds — `tip` forwards `msg.value` to the resolved recipient atomically
- no token approvals (BNB native only)
- self-tips rejected; unknown handles rejected; zero-value rejected

The only privileged-looking action is `register(bio)`, which writes **only the caller's own profile**
and requires the caller to hold an Agent ID (`balanceOf > 0` on the registry).

Source: [`contracts/PayLink.sol`](contracts/PayLink.sol) (MIT, Solidity 0.8.26, optimizer 200 runs).
ABI: [`web/abi.json`](web/abi.json).

## Use it

### Web app
`docs/` is a static front-end (GitHub Pages): look up a name, see its profile and received tips,
and send a tip with any injected EVM wallet (MetaMask, Rabby, …). Read-only data comes straight
from BSC public RPC — **no server, no accounts, no sessions, no QR/pairing login**.

### From an AI agent (Agentic Wallet)
Install the skill in [`skill/SKILL.md`](skill/SKILL.md): with the `baw` CLI signed in, an agent can
tip any `name.ai` via `contract-call preview` → user confirmation → `execute`. Every asset operation
is shown to and confirmed by the user; nothing is automated around confirmation.

## Agent ID integration depth

- **Identity**: profiles are keyed by Agent ID holdings; `register` is gated on `balanceOf`.
- **Payments**: recipient resolution is the registry's `ownerOfHandle` — the name IS the payment rail.
- **Social feed**: on-chain tip messages + stats give every Agent ID a public, verifiable support history.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with Binance; "Agent ID" and "Agentic Wallet" refer to
the official Binance Wallet products this project interoperates with. Crypto assets are volatile;
this is payment software, not an investment product, and it promises no returns.
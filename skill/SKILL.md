---
name: paylink
description: Use when the user wants to tip or pay an AI agent / Agent ID holder by their name.ai handle on BNB Smart Chain, register their own PayLink profile bio, or read the PayLink tip feed and stats. Requires the binance-agentic-wallet skill (baw CLI) signed in.
---

# PayLink — tip any name.ai on BSC

PayLink contract (BNB Smart Chain, chainId 56): `0x7C5591E85D09a65F774498d5E6E3Bb1b7542177a`
Agent ID registry (official): `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
Source + ABI: https://github.com/perasyudha/paylink (MIT, verified on BscScan).

Non-custodial: `tip` forwards BNB directly to the name's holder in the same transaction. No owner,
no fees, no approvals. Every asset operation MUST be shown to and confirmed by the user — never
bypass, batch, or automate confirmation (hackathon red line and general wallet safety).

## Tip a name.ai handle

1. Normalize the handle: lowercase, strip `.ai` (e.g. `Yudha.ai` → `yudha`).
2. Resolve + sanity-check with a read-only `eth_call` to the registry (public RPC
   `https://bsc-dataseed.binance.org`): `ownerOfHandle(string)` selector `0x<keccak4>` — or use
   `baw wallet resolve-domain --name <handle>.ai --binanceChainId 56 --json`. If it returns the zero
   address or errors, STOP and tell the user the name is not registered. Show the resolved address
   in full.
3. Encode calldata: `tip(string handle, string message)` — message ≤140 bytes, optional ("" allowed).
   Value = the tip amount in wei (e.g. 0.001 BNB = `1000000000000000`).
4. `baw contract-call preview --binanceChainId 56 --from <user AW address> --to 0x7C5591E85D09a65F774498d5E6E3Bb1b7542177a --value <wei> --inputData <hex> --json`
5. Show the user: recipient name + full resolved address, amount (human-readable BNB + USD if known),
   message, gas estimate, and any `risks` from the preview. Ask for explicit confirmation.
6. Only on a clear "yes": `baw contract-call execute --requestId <id> --json`. Report the txHash.
   Self-tips revert ("cannot tip yourself") — relay the error as-is.

## Register / update your own profile bio

`register(string bio)` (≤160 bytes), value 0. Caller must hold an Agent ID. Same preview → confirm →
execute flow. Bio is public on-chain.

## Read feed / stats (no wallet needed)

Read-only `eth_call` against PayLink with the ABI from the repo:
- `profiles(address)` → (received wei, tips count, bio)
- `getFeed()` → (Tip[24] ring buffer, feedCount); newest at `(feedCount-1) % 24`
- `feedCount()` → total tips ever

## Rules

- Never send funds without the user's explicit per-transaction confirmation.
- Never fabricate addresses; only the registry's resolution or the user's own input.
- Relay CLI errors exactly; do not retry a failed preview with mutated parameters.
- PayLink is payment software, not an investment; never promise returns.
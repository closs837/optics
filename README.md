# Optics

An independent lending workspace for Tydro V3 on Ink: a dark financial terminal with a portfolio overview, live reserve markets, address-level analysis, saved stress scenarios, decoded protocol events, alert rules, and exports. Every position and market read includes its source block; all history is read live from the chain.

## Run locally

Requires Node 22.18 or later.

```sh
npm ci
npm run db:local
npm run dev
```

The Sites development plugin signs you in with your site identity through the normal Sign in button. The Lightsail deployment uses email/password registration with operator approval; the hosted Sites version uses ChatGPT identity. The app has no wallet connection or signing flow.

```sh
npm test
npm run typecheck
npm run lint
npm run test:integration  # keep the development server running
npm run build
```

Integration tests run only against loopback hosts. They use a temporary watch and a temporary second-owner fixture and remove both. The default test address is Tydro's public collector contract. Set `TEST_POSITION_ADDRESS` to a different public address if that collector is already on the local account's watchlist.

## Features and boundaries

- Portfolio overview: aggregate supply, debt, net supplied value, lowest individual health factor, asset exposure, stale/missing coverage, watch filtering, and CSV export. Readings may be at different blocks; risk is not netted between wallets.
- Live markets: all registered reserves, pool supply/variable-borrow APR, price, utilization, virtual liquidity, supply/borrow caps, base LTV and liquidation parameters, and paused/frozen flags. Sort, filter, and inspect a reserve. Rates exclude incentives and underlying-token yields.
- Risk studio: independent uniform collateral/debt basket shocks, external debt repayment, target-HF comparisons, collateral sensitivity chart, eight saved scenarios per watch, and reproducible JSON exports. The model preserves the observed HF, holds composition/eMode/parameters fixed, and excludes interest and execution effects.
- Protocol activity: decoded supply, withdrawal, borrow, repayment, liquidation, collateral-setting and eMode events. Paginated scans of up to 2,000 blocks with exact coverage and explorer links; approximately 100 events per page without splitting a block. Excludes aToken transfers and other contracts.
- Verified activity: open an activity block, read its real Ink receipts, retain receipt evidence in the account database, inspect the event index, retry and export. Every result carries its receipt-audit label and provenance. Ordinary market and position data remains live.
- Public reads of account totals and all active reserve positions from one verified Tydro V3 market on Ink (chain 57073).
- Pinned-block reads with live network, address-provider mapping, oracle denomination, and block freshness validation. Both official Ink RPC endpoints are supported. A failed read preserves the previous saved snapshot.
- Up to 12 watches per account, labels, per-watch observations, and complete cascading deletion.
- Up to 10 rules per watch for health factor, USD collateral, or USD debt. Rules use exact 18-decimal integer comparisons. A first matching check or a new crossing records an event; continued matching does not repeat it. No-debt health factor is null and never matches a health-factor rule.
- Account-owned alert inbox with read receipts, rule pause/resume, and opt-in desktop notifications where browser support permits.
- Approximately 60-second checks **while the app is open**. Closing it pauses monitoring; background-tab throttling and sleep can delay checks. This is not an always-on push or guaranteed liquidation-warning service.
- History begins when a watch is saved. Retention is 30 days or 2,000 observations per watch, whichever is smaller; 500 alerts per watch. The UI reads the latest 120 observations and 100 account alerts. Observation history does not backfill earlier balances. The separate activity feed can inspect earlier supported protocol events.
- Price and balance differences are observations, not unverified causal attributions or financial recommendations. Permissioned/institutional/custody deployments are excluded.

## Implementation

- React/Vinext, with a Node server for Lightsail and an optional Sites preview.
- Persistent SQLite on Lightsail or Cloudflare D1, using the same generated SQL migrations and prepared application queries.
- Server-side identity and owner checks on every saved-data endpoint, same-origin checks on mutations, bounded request validation, rate limits, and per-watch refresh leases.
- Viem read-only contract calls; JSON-RPC batching and endpoint failover. Public chain data uses one block per snapshot.
- Native browser Notification permission is requested only after the user selects the control. In-app alerts remain available when desktop notification delivery is unsupported.
- Optional, feature-detected WebMCP tools `view_tydro_position` and `read_watchlist` call the same visible read flows. No supported WebMCP browser was available for live contract validation in this environment.

Schema: `db/schema.ts`. Migrations: `drizzle/`. Product API: `app/api/`. The generated Shadcn components are preserved; lint is scoped to authored application, database, test, and configuration sources.

## Product APIs

All responses use `Cache-Control: no-store`; the market reader shares an in-memory read for up to 30 seconds. The deployment's access policy also applies to API access.

| Route                                        | Behavior                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/position?address=0x…`              | Pinned-block public position snapshot                                         |
| `GET /api/markets`                           | Registered reserve balances, parameters, and rates                            |
| `GET /api/activity?address=0x…&before=BLOCK` | Supported pool events; optional exclusive block cursor                        |
| `GET/POST/DELETE /api/verification`          | Owner's receipt-audit records, live/captured checks, retry and clearing |
| `GET /api/state`                             | Signed-in owner’s watches, rules, scenarios, and recent alerts                |
| `GET /api/state?watchId=ID`                  | Owner’s latest 120 persisted observations                                     |
| `POST /api/refresh`                          | Refresh the owner’s watches with a per-watch lease                            |
| `/api/watches`, `/api/rules`, `/api/alerts`  | Existing authenticated watch/rule/inbox management                            |
| `POST /api/scenarios`                        | Save bounded, validated scenario inputs for an owned watch                    |
| `DELETE /api/scenarios`                      | Delete an owned scenario                                                      |

Mutation bodies are JSON and require a same-origin request. Scenario POST fields: `watchId`, `name` (1–48 chars), `collateralShock` and `debtShock` (−95 to +100 percent), `repayUsd` (0 to 10¹⁵), `targetHealthFactor` (1 to 10). A watched address has at most eight scenarios. CSV export neutralizes user text that could be interpreted as a spreadsheet formula.

## Deployment

The default deployment uses **AWS Lightsail, a static IPv4 address, Namecheap DNS, Caddy HTTPS, local account registration, and persistent SQLite on a separate disk**. Use the [Lightsail deployment guide](infra/lightsail/README.md) and [parameter template](infra/lightsail/terraform.tfvars.example). Run `npm run deploy:plan`, review the saved plan, then `npm run deploy:apply`.

Run `npm run check:production` before deployment. It includes real HTTPS registration/login tests through Caddy, live Ink API checks, database persistence, and Terraform configuration validation. Only `inkfnd.com` registrations are immediately approved; all other accounts remain pending until approved over SSH. Passwords are hashed, sessions persist in SQLite, and pending accounts cannot use workspace APIs. Email ownership is not verified; automatic approval never grants operator privileges. An expired session pauses automatic checks and provides a sign-in link. Your actual domain, cloud provisioning, and backup restoration still need validation in your deployment environment.

`.openai/hosting.json` identifies the private Site and its logical `DB` binding. Sites applies migrations and provisions production database wiring. No application secrets are required for the supported read-only data sources. Local `.wrangler` data and `.env` files are ignored; they must not be published.

## Sources and verification

- [Ink network information](https://docs.inkonchain.com/general/network-information)
- [Aave deployment address book: Ink Whitelabel](https://github.com/aave-dao/aave-address-book/blob/main/src/ts/AaveV3InkWhitelabel.ts)
- [Aave pool event and account interfaces](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/interfaces/IPool.sol)
- [Reserve data-provider interface](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/interfaces/IPoolDataProvider.sol)
- [Tydro documentation](https://docs.tydro.com/)
- [Tydro FAQ](https://tydro.com/faq)

The pool (`0x2816cf15F6d2A220E789aA011D5EE4eB6c47FEbA`), oracle, and data provider were independently checked against the on-chain address provider on both official Ink RPC endpoints during implementation on 2026-09-21. The UI provides block and address explorer links for each observation.

The site is independently branded and is not affiliated with or endorsed by Ink, Tydro, Aave, or Kraken.

## Verification checks

Beyond the unit suite, `npm run test:replay` re-runs the verified-activity path end to end: the same implementation in `lib/verification` and `db/verification.ts` that serves the UI and `/api/verification` is exercised against the recorded Ink block in `lib/verification/fixtures` and the replay workloads in `tests/replay`, with real SQLite databases and step-by-step observed state under `outputs/verification-replay`. Smoke mode covers the ordinary cases:

```sh
npm run test:replay -- smoke
npm run test:replay -- verify --seeds 91,602,4294967295
```

The receipt checks assert that retained evidence, the event index and repeated recovery converge on the same root, membership and finality state as the supplied headers. The recorded capture is Ink chain 57073, block 56,543,618; its provenance is recorded inside the fixture. References: [Ink network information](https://docs.inkonchain.com/general/network-information), [OP Stack execution engine specification](https://specs.optimism.io/protocol/exec-engine.html), [op-geth receipt implementation](https://github.com/ethereum-optimism/op-geth/blob/optimism/core/types/receipt.go).

Apply migration 0002_verified_activity.sql through the normal deployment process; for local development, run npm run db:local.

import Link from 'next/link';
import { ScanLine, ArrowLeft } from 'lucide-react';
import { MARKET, addressLink } from '@/lib/market';
export const metadata = { title: 'Coverage & methodology — Optics' };
export default function About() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <ScanLine className="brand-mark" />
          Optics
        </Link>
        <Link href="/" className="top-meta">
          <ArrowLeft size={16} />
          Back to workspace
        </Link>
      </header>
      <main className="workspace about-page">
        <div className="eyebrow">Coverage & methodology</div>
        <h1>Data, models, and coverage.</h1>
        <p>
          Optics is an independent lending workspace. It reads public Tydro
          contract state on Ink and records observations for addresses you save.
        </p>
        <section id="coverage" className="panel">
          <h2>One supported lending market</h2>
          <p>
            Coverage is the Tydro V3 pool registered as Ink Whitelabel in the
            Aave address book. Institutional, custody, permissioned, and other
            Tydro deployments are outside this monitor’s coverage.
          </p>
          <ul>
            <li>Chain: Ink mainnet, {MARKET.chainId}</li>
            <li>
              Pool:{' '}
              <a
                href={addressLink(MARKET.pool)}
                target="_blank"
                rel="noreferrer"
              >
                <code>{MARKET.pool}</code>
              </a>
            </li>
            <li>
              Address provider:{' '}
              <a
                href={addressLink(MARKET.provider)}
                target="_blank"
                rel="noreferrer"
              >
                <code>{MARKET.provider}</code>
              </a>
            </li>
            <li>
              Deployment registry:{' '}
              <a href={MARKET.addressBook} target="_blank" rel="noreferrer">
                Aave address book
              </a>
            </li>
          </ul>
          <p>
            Every read verifies the network and the pool, oracle, and
            data-provider addresses against the registered address provider. If
            that mapping changes, monitoring stops until coverage is reviewed.
          </p>
        </section>
        <section id="metrics" className="panel">
          <h2>How readings are calculated</h2>
          <p>
            Collateral, debt, available borrowing, liquidation threshold,
            loan-to-value, and health factor come directly from the pool’s
            account-data method. Asset balances come from its data provider; USD
            values use the protocol oracle. Every contract call for a snapshot
            uses the same block number.
          </p>
          <p>
            Collateral value includes assets counted as collateral. Supplied
            balances can include assets with collateral switched off. Available
            borrowing is a protocol-calculated limit, not a recommendation to
            borrow.
          </p>
          <p>
            A health factor below 1 makes a position eligible for liquidation. A
            position with no debt is displayed as “No debt” and does not match a
            health-factor rule. No health-factor reading guarantees safety.
          </p>
          <p>
            The RPC endpoints are <code>{MARKET.rpc[0]}</code> and{' '}
            <code>{MARKET.rpc[1]}</code>, as published in{' '}
            <a
              href="https://docs.inkonchain.com/general/network-information"
              target="_blank"
              rel="noreferrer"
            >
              Ink’s network documentation
            </a>
            . An observation is marked stale after three minutes or a failed
            refresh. Failed reads never overwrite the last successful
            observation.
          </p>
        </section>
        <section id="markets" className="panel">
          <h2>Markets and portfolio exposure</h2>
          <p>
            Reserve supply, stable and variable debt, rates, caps, and base
            collateral parameters are read at one block. Available liquidity is
            the protocol’s virtual underlying balance. Utilization is total debt
            divided by total debt plus virtual liquidity. Supply and borrow APRs
            are annualized protocol rates in ray units, divided by 10²⁷. They
            exclude incentives, compounding, and yields earned inside the
            underlying token itself.
          </p>
          <p>
            Live market reads are cached for up to 30 seconds. Base reserve
            parameters can differ from a position’s efficiency-mode parameters.
            A cap of zero means no cap is configured. Frozen, paused, and
            inactive reserves are labeled separately.
          </p>
          <p>
            Portfolio supplied value includes assets not enabled as collateral.
            Net supplied value subtracts protocol debt; it does not include a
            wallet’s other holdings. Addresses are aggregated from their own
            latest observations, which can be at different blocks. Stale or
            missing readings are counted explicitly. The lowest individual
            health factor is shown; risk is never netted across independent
            wallets.
          </p>
        </section>
        <section id="risk" className="panel">
          <h2>Risk studio model</h2>
          <p>
            The simulator applies uniform changes to collateral and debt
            baskets. With outstanding debt, liquidation capacity starts from the
            observed health factor multiplied by observed debt. This preserves
            the current protocol reading, including efficiency mode, without
            reconstructing it from rounded weighted thresholds.
          </p>
          <p>
            Simulated capacity = current capacity × (1 + collateral shock).
            Simulated debt = max(0, current debt × (1 + debt shock) −
            repayment). Simulated health factor = capacity ÷ remaining debt.
            With no debt, health factor is not finite. Repayment uses external
            funds and is capped at revalued debt, so collateral remains in
            place.
          </p>
          <p>
            Asset composition, efficiency mode, and protocol parameters remain
            fixed. The shocks are independent basket sensitivities, even where
            an asset appears as both collateral and debt; they are not a
            coherent per-token price forecast. The model excludes interest
            accrual, execution costs, slippage, and liquidation execution.
            Additional collateral estimates assume the existing collateral mix.
          </p>
          <p>
            Save up to eight scenarios per watched address. Saved inputs are
            recalculated against the latest observation. JSON exports include
            the block, inputs, model assumption, and results. Comparison targets
            are chosen by you and are not recommended risk levels.
          </p>
        </section>
        <section id="activity" className="panel">
          <h2>Protocol activity</h2>
          <p>
            The activity feed decodes Supply, Withdraw, Borrow, Repay,
            LiquidationCall, collateral-setting, and efficiency-mode events
            emitted by the supported pool. Supply and Borrow are attributed to
            the beneficiary (onBehalfOf); repayment is attributed to the
            borrower whose debt was reduced. Transaction links allow independent
            inspection.
          </p>
          <p>
            Each request scans up to 2,000 blocks in bounded slices. Earlier
            pages continue before the oldest scanned block. Very busy pages stop
            at a block boundary after approximately 100 events, preserving all
            events in that boundary block. Displayed timestamps and block ranges
            show exactly what was scanned.
          </p>
          <p>
            The feed excludes aToken transfers, token approvals, and events from
            other contracts or markets. An empty page means no supported events
            were found in its scanned range. It is not a full wallet transaction
            history.
          </p>
        </section>
        <section className="panel">
          <h2>Checks, alerts, and history</h2>
          <p>
            While the app is open, automatic checks run approximately every 60
            seconds. Background tabs, network delays, and device sleep can delay
            checks. Closing the app pauses monitoring. You can also check all
            saved watches manually.
          </p>
          <p>
            Rules compare exact decimal values. An alert is recorded on the
            first matching check, then only after the condition stops matching
            and matches again. Threshold equality does not match a strict
            “above” or “below” rule. Disabling and re-enabling a rule resets
            this state.
          </p>
          <p>
            Alerts are saved in your account’s inbox. Desktop notifications are
            optional, depend on browser permission, and work while this app is
            open. This product does not provide an always-on or guaranteed
            liquidation warning service.
          </p>
          <p>
            History starts when an address is saved. It retains up to 2,000
            observations or 30 days per watch, whichever is smaller, and 500
            alerts per watch. The interface shows the most recent 120
            observations and 100 alerts. Changes describe observed differences;
            balance changes may include interest accrual and do not by
            themselves identify a transaction or its cause.
          </p>
        </section>
        <section className="panel">
          <h2>Your data and controls</h2>
          <p>
            Public lookups require an address. Sign in to save your own
            watchlist, labels, rules, scenarios, observations, and alert inbox.
            Other signed-in users cannot access those saved records.
            Desktop-notification preference is stored on this device.
          </p>
          <p>
            Removing a watch deletes its observations, saved scenarios, alert
            rules, and alert history. Rate limiting temporarily stores a daily
            hash of the request IP, not the raw IP address. Optics never asks
            for a wallet signature, seed phrase, or private key.
          </p>
          <p>
            Optics is not affiliated with or endorsed by Ink, Tydro, Aave, or
            Kraken. Protocol documentation is available at{' '}
            <a href="https://docs.tydro.com/" target="_blank" rel="noreferrer">
              docs.tydro.com
            </a>
            .
          </p>
        </section>
      </main>
      <footer>
        <span>Optics · Independent monitoring</span>
        <Link href="/">Return to your positions</Link>
      </footer>
    </div>
  );
}

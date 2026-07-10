'use client';
import { useState } from 'react';
import { Download, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { defaultScenario, simulate } from '@/lib/analytics';
import type { SavedScenario, ScenarioInput, Snapshot } from '@/lib/types';
import {
  BlockStamp,
  dollars,
  download,
  healthTone,
  hf,
  number,
  Stat,
} from './shared';
export function RiskLab({
  snapshot: s,
  now,
  stale,
  scenarios,
  canSave,
  busy,
  save,
  remove,
}: {
  snapshot: Snapshot;
  now: number;
  stale: boolean;
  scenarios: SavedScenario[];
  canSave: boolean;
  busy: boolean;
  save: (name: string, input: ScenarioInput) => Promise<boolean>;
  remove: (id: string) => void;
}) {
  const [input, setInput] = useState<ScenarioInput>(defaultScenario),
    [name, setName] = useState('');
  const result = simulate(s, input);
  const curve = Array.from({ length: 40 }, (_, i) => {
    const shock = -95 + i * 5;
    return {
      shock,
      baseline: simulate(s, { ...defaultScenario, collateralShock: shock })
        .healthFactor,
      scenario: simulate(s, { ...input, collateralShock: shock }).healthFactor,
    };
  });
  const update = (key: keyof ScenarioInput, value: number) =>
    setInput((p) => ({ ...p, [key]: value }));
  return (
    <>
      <div className="section-intro">
        <div>
          <div className="eyebrow">Analysis / What if</div>
          <h1>Risk studio</h1>
          <p>
            Stress the current position. Compare outcomes before making a
            decision.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setInput(defaultScenario);
            setName('');
          }}
        >
          <RotateCcw size={14} />
          Reset
        </Button>
      </div>
      <>
        {stale && (
          <p className="inline-warning">
            This model uses the last successful observation. Its data is stale
            or the latest refresh failed.
          </p>
        )}
      </>
      <div className="scenario-layout">
        <section className="scenario-controls">
          <div className="panel-heading">
            <h2>Scenario inputs</h2>
            <span className="tag">Model</span>
          </div>
          <div className="preset-row">
            {[10, 20, 40].map((n) => (
              <button
                key={n}
                className={input.collateralShock === -n ? 'active' : ''}
                onClick={() =>
                  setInput({ ...defaultScenario, collateralShock: -n })
                }
              >
                −{n}% collateral
              </button>
            ))}
          </div>
          <Shock
            label="Collateral basket value"
            id="collateral-shock"
            value={input.collateralShock}
            change={(v) => update('collateralShock', v)}
          />
          <Shock
            label="Debt basket value"
            id="debt-shock"
            value={input.debtShock}
            change={(v) => update('debtShock', v)}
          />
          <div className="scenario-field">
            <Label htmlFor="scenario-repay">
              Repay debt after price shocks
            </Label>
            <div className="unit-input">
              <NumericInput
                id="scenario-repay"
                min={0}
                max={1e15}
                value={input.repayUsd}
                change={(n) => update('repayUsd', n)}
              />
              <span>USD</span>
            </div>
            <small>External funds; supplied collateral stays in place.</small>
          </div>
          <div className="scenario-field">
            <Label htmlFor="target-hf">Target health factor</Label>
            <NumericInput
              id="target-hf"
              min={1}
              max={10}
              value={input.targetHealthFactor}
              change={(n) => update('targetHealthFactor', n)}
            />
            <small>Your comparison target, not a recommended risk level.</small>
          </div>
          <form
            className="save-scenario"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save(name, input)) setName('');
            }}
          >
            <Label htmlFor="scenario-name">Save this scenario</Label>
            <Input
              id="scenario-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Collateral drawdown"
              maxLength={48}
              required
              disabled={!canSave}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!canSave || busy || !name.trim()}
            >
              <Save size={14} />
              Save scenario
            </Button>
            {!canSave && (
              <small>
                Save this address to keep scenarios in your account.
              </small>
            )}
          </form>
        </section>
        <section className="scenario-output">
          <div className="risk-score">
            <div>
              <span className="stat-label">Simulated health factor</span>
              <strong className={healthTone(result.healthFactor)}>
                {hf(result.healthFactor)}
              </strong>
              <span className="small-note">
                Current {hf(s.healthFactor)} <span className="muted">→</span>{' '}
                simulated {hf(result.healthFactor)}
              </span>
            </div>
            <div
              className={
                'risk-verdict ' +
                (result.healthFactor !== null && result.healthFactor < 1
                  ? 'negative'
                  : '')
              }
            >
              <span className="status-dot" />
              {result.healthFactor === null
                ? 'No remaining debt'
                : result.healthFactor < 1
                  ? 'Below liquidation threshold'
                  : 'Above liquidation threshold'}
            </div>
          </div>
          <div className="scenario-stats">
            <Stat label="Collateral" value={dollars(result.collateral)} />
            <Stat label="Remaining debt" value={dollars(result.debt)} />
            <Stat
              label="Liquidation headroom"
              value={dollars(result.headroom)}
            />
          </div>
          <div className="chart-heading">
            <h2>Collateral sensitivity</h2>
            <div className="chart-key">
              <span>
                <i style={{ background: '#6e7584' }} />
                Current debt
              </span>
              <span>
                <i style={{ background: '#aba0e6' }} />
                Scenario debt
              </span>
            </div>
          </div>
          {Number(s.debtUsd) > 0 && result.debt > 0 ? (
            <ChartContainer
              config={{
                baseline: { label: 'Current debt', color: '#6e7584' },
                scenario: { label: 'Scenario debt', color: '#aba0e6' },
              }}
              className="risk-chart"
            >
              <LineChart
                data={curve}
                margin={{ top: 15, right: 25, bottom: 10, left: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#282b34"
                  strokeDasharray="3 5"
                />
                <XAxis
                  dataKey="shock"
                  type="number"
                  domain={[-95, 100]}
                  ticks={[-80, -40, 0, 40, 80]}
                  tickFormatter={(v) => v + '%'}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => number(v, 1)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => String(v) + '% collateral value'}
                      formatter={(value, key) => (
                        <span className="mono">
                          {key === 'scenario' ? 'Scenario' : 'Current debt'}:{' '}
                          {hf(Number(value))}
                        </span>
                      )}
                    />
                  }
                />
                <ReferenceLine y={1} stroke="#db8e89" strokeDasharray="4 3" />
                <ReferenceLine
                  x={input.collateralShock}
                  stroke="#aba0e6"
                  strokeDasharray="2 4"
                />
                <Line
                  type="linear"
                  dataKey="baseline"
                  stroke="#6e7584"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="scenario"
                  stroke="#aba0e6"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <div className="quiet-empty">
              <p>
                No debt remains in this scenario. There is no finite
                health-factor curve.
              </p>
            </div>
          )}
          <div className="chart-axis-note">
            <span>Uniform change in collateral value</span>
            <span className="negative">Dashed horizontal line: HF 1.00</span>
          </div>
          <div className="target-results">
            <div>
              <span>Further collateral drop to HF 1</span>
              <strong>
                {result.collateralDropToLiquidation === null
                  ? '—'
                  : number(result.collateralDropToLiquidation, 2) + '%'}
              </strong>
            </div>
            <div>
              <span>
                Additional repayment to reach HF {input.targetHealthFactor}
              </span>
              <strong>{dollars(result.repaymentToTarget)}</strong>
            </div>
            <div>
              <span>Or additional collateral, same mix</span>
              <strong>
                {result.additionalCollateralToTarget === null
                  ? 'Unavailable'
                  : dollars(result.additionalCollateralToTarget)}
              </strong>
            </div>
          </div>
          <p className="model-note">
            Uniform basket model, anchored to the observed health factor.
            Composition, efficiency mode, and liquidation parameters remain
            fixed. Collateral and debt shocks are independent sensitivities,
            including where the same asset appears in both baskets. Interest,
            slippage, fees, and liquidation execution are excluded. The
            repayment is capped at the revalued debt.
          </p>
        </section>
      </div>
      <div className="section-bar">
        <h2>
          Saved comparisons{' '}
          <span>{scenarios.length.toString().padStart(2, '0')}</span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            download(
              'optics-scenario.json',
              JSON.stringify(
                {
                  address: s.address,
                  block: s.blockNumber,
                  observedAt: new Date(s.observedAt).toISOString(),
                  assumption:
                    'Uniform independent collateral and debt basket shocks; fixed composition and protocol parameters; external repayment funds.',
                  inputs: input,
                  results: result,
                },
                null,
                2,
              ),
              'application/json',
            )
          }
        >
          <Download size={14} />
          Export model
        </Button>
      </div>
      {scenarios.length ? (
        <div className="data-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead className="numeric">Collateral shock</TableHead>
                <TableHead className="numeric">Debt shock</TableHead>
                <TableHead className="numeric">Repayment</TableHead>
                <TableHead className="numeric">Simulated HF</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((saved) => {
                const r = simulate(s, saved);
                return (
                  <TableRow key={saved.id}>
                    <TableCell>
                      <button
                        className="text-link"
                        onClick={() =>
                          setInput({
                            collateralShock: saved.collateralShock,
                            debtShock: saved.debtShock,
                            repayUsd: saved.repayUsd,
                            targetHealthFactor: saved.targetHealthFactor,
                          })
                        }
                      >
                        {saved.name}
                      </button>
                    </TableCell>
                    <TableCell className="numeric">
                      {saved.collateralShock}%
                    </TableCell>
                    <TableCell className="numeric">
                      {saved.debtShock}%
                    </TableCell>
                    <TableCell className="numeric">
                      {dollars(saved.repayUsd)}
                    </TableCell>
                    <TableCell
                      className={'numeric ' + healthTone(r.healthFactor)}
                    >
                      {hf(r.healthFactor)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={'Delete scenario ' + saved.name}
                        disabled={busy}
                        onClick={() => remove(saved.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="table-empty">
          Save a scenario to compare it against future observations.
        </p>
      )}
      <div className="table-foot">
        <span>Saved scenarios are recalculated using this observation.</span>
        <BlockStamp
          block={s.blockNumber}
          time={s.observedAt}
          stale={stale || now - s.observedAt > 180000}
        />
      </div>
    </>
  );
}
function Shock({
  label,
  id,
  value,
  change,
}: {
  label: string;
  id: string;
  value: number;
  change: (n: number) => void;
}) {
  return (
    <div className="shock-control">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <output
          htmlFor={id}
          className={
            'mono ' + (value < 0 ? 'negative' : value > 0 ? 'positive' : '')
          }
        >
          {value > 0 ? '+' : ''}
          {value}%
        </output>
      </div>
      <Slider
        id={id}
        aria-label={label}
        min={-95}
        max={100}
        step={1}
        value={[value]}
        onValueChange={(v) => change(Array.isArray(v) ? v[0] : v)}
      />
      <div className="slider-scale">
        <span>−95%</span>
        <button onClick={() => change(0)}>Reset to 0</button>
        <span>+100%</span>
      </div>
    </div>
  );
}

function NumericInput({
  id,
  min,
  max,
  value,
  change,
}: {
  id: string;
  min: number;
  max: number;
  value: number;
  change: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      step="any"
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max)
          change(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

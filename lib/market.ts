export const MARKET = {
  id: 'tydro-v3',
  name: 'Tydro V3 · Ink',
  chainId: 57073,
  provider: '0x4172E6aAEC070ACB31aaCE343A58c93E4C70f44D',
  pool: '0x2816cf15F6d2A220E789aA011D5EE4eB6c47FEbA',
  oracle: '0x4758213271BFdC72224A7a8742dC865fC97756e1',
  dataProvider: '0x96086C25d13943C80Ff9a19791a40Df6aFC08328',
  explorer: 'https://explorer.inkonchain.com',
  rpc: ['https://rpc-gel.inkonchain.com', 'https://rpc-qnd.inkonchain.com'],
  addressBook:
    'https://github.com/aave-dao/aave-address-book/blob/main/src/ts/AaveV3InkWhitelabel.ts',
} as const;
export const CHECK_INTERVAL_MS = 60_000;
export const STALE_AFTER_MS = 180_000;
export const MAX_WATCHES = 12;
export function addressLink(address: string) {
  return `${MARKET.explorer}/address/${address}`;
}
export function blockLink(block: string) {
  return `${MARKET.explorer}/block/${block}`;
}

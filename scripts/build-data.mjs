// Builds the offline datasets the app ships with:
//   public/data/cities.json  – every city with population >= 15,000 (GeoNames)
//   src/data/countries.json  – per-country metadata (GeoNames + world-countries)
//
// Run with `npm run build:data`. Data from GeoNames is CC BY 4.0.

import { mkdir, writeFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const worldCountries = require('world-countries')

const GEONAMES = 'https://download.geonames.org/export/dump'

async function fetchBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// Minimal zip reader: returns the contents of the named entry.
function unzipEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10)
    const compSize = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const localOffset = zip.readUInt32LE(p + 42)
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen)
    if (entryName === name) {
      const lNameLen = zip.readUInt16LE(localOffset + 26)
      const lExtraLen = zip.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + lNameLen + lExtraLen
      const data = zip.subarray(start, start + compSize)
      return method === 0 ? data : inflateRawSync(data)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${name} not found in zip`)
}

const rows = (text) =>
  text
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'))

console.log('Downloading GeoNames data…')
const [citiesZip, admin1Text, countryText] = await Promise.all([
  fetchBuffer(`${GEONAMES}/cities15000.zip`),
  fetchBuffer(`${GEONAMES}/admin1CodesASCII.txt`).then((b) => b.toString('utf8')),
  fetchBuffer(`${GEONAMES}/countryInfo.txt`).then((b) => b.toString('utf8')),
])

const admin1 = new Map(rows(admin1Text).map(([code, name]) => [code, name]))

// ───── Cost data: World Bank World Development Indicators (CC BY 4.0) ─────
// Country-level only; no open dataset covers costs city by city.

/** Fetches an indicator for every country: Map<iso3, Map<year, value>>. */
async function worldBank(indicator, years) {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&date=${years}&per_page=20000`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${indicator}: HTTP ${res.status}`)
  const [meta, data] = await res.json()
  if (!Array.isArray(data)) throw new Error(`${indicator}: ${JSON.stringify(meta)}`)
  const byCountry = new Map()
  for (const r of data) {
    if (r.value == null || !r.countryiso3code) continue
    if (!byCountry.has(r.countryiso3code)) byCountry.set(r.countryiso3code, new Map())
    byCountry.get(r.countryiso3code).set(Number(r.date), Number(r.value))
  }
  return byCountry
}

console.log('Downloading World Bank cost data…')
const [pppPrivate, exchangeRate, tourismReceipts, tourismArrivals] = await Promise.all([
  worldBank('PA.NUS.PRVT.PP', '2015:2024'), // PPP factor, household consumption (LCU per intl $)
  worldBank('PA.NUS.FCRF', '2015:2024'), // official exchange rate (LCU per US$)
  worldBank('ST.INT.RCPT.CD', '2015:2019'), // international tourism receipts (US$)
  worldBank('ST.INT.ARVL', '2015:2019'), // international tourism arrivals
])

/** Latest year in which every series has a value. */
function latest(iso3, ...series) {
  const years = [...(series[0].get(iso3)?.keys() ?? [])].sort((a, b) => b - a)
  for (const y of years) {
    const values = series.map((s) => s.get(iso3)?.get(y))
    if (values.every((v) => v !== undefined && v > 0)) return { year: y, values }
  }
  return null
}

/**
 * Price level: how expensive everyday things are relative to the US (1.0), from the
 * consumption PPP factor over the exchange rate.
 * Visitor spend: tourism receipts per international arrival, the typical amount an
 * international visitor spends per trip. 2015–2019 only, so COVID years don't skew it.
 */
// The World Bank re-expresses a euro adopter's whole PPP series in euros, but its
// exchange-rate series keeps the old currency for pre-changeover years. Where the
// two disagree, convert the exchange rate to euros at the fixed changeover rate.
const EURO_CHANGEOVER = { BGR: 1.95583, HRV: 7.5345 }

function exchangeRateFor(iso3, year, rate) {
  const fixed = EURO_CHANGEOVER[iso3]
  const euroRate = exchangeRate.get('FRA')?.get(year)
  if (fixed && euroRate && rate > euroRate * 1.5) return rate / fixed
  return rate
}

function costFor(iso3) {
  const price = latest(iso3, pppPrivate, exchangeRate)
  const spend = latest(iso3, tourismReceipts, tourismArrivals)
  let priceLevel = price ? price.values[0] / exchangeRateFor(iso3, price.year, price.values[1]) : null
  let visitorSpend = spend ? spend.values[0] / spend.values[1] : null
  // Outside these ranges the figure reflects a statistical artifact rather than
  // prices: official exchange rates far from the market rate (Zimbabwe ~0, Iran 2.1),
  // or arrivals counted unusually (DR Congo $12/trip, Qatar $7,300/trip).
  if (priceLevel !== null && (priceLevel < 0.1 || priceLevel > 1.8)) priceLevel = null
  if (visitorSpend !== null && (visitorSpend < 100 || visitorSpend > 6000)) visitorSpend = null
  return {
    priceLevel: priceLevel === null ? null : Math.round(priceLevel * 1000) / 1000,
    priceYear: priceLevel === null ? null : price.year,
    visitorSpend: visitorSpend === null ? null : Math.round(visitorSpend),
    spendYear: visitorSpend === null ? null : spend.year,
  }
}

const SOVEREIGN_EXTRAS = new Set(['VA', 'PS']) // UN observer states
const wcByCode = new Map(worldCountries.map((c) => [c.cca2, c]))
const iso2ByIso3 = new Map(worldCountries.map((c) => [c.cca3, c.cca2]))

// Names people search for that aren't in world-countries' alternate spellings.
const EXTRA_ALIASES = {
  GB: ['England', 'Scotland', 'Wales', 'Northern Ireland', 'Britain'],
  US: ['America', 'United States of America'],
  CZ: ['Czech Republic'],
  KR: ['Korea', 'South Korea'],
  KP: ['North Korea'],
  CI: ['Ivory Coast'],
  TR: ['Turkey'],
  MM: ['Burma'],
  CV: ['Cape Verde'],
  SZ: ['Swaziland'],
  MK: ['Macedonia'],
  VA: ['Vatican', 'Holy See'],
}

function aliasesFor(iso2, iso3, geonamesName, wc) {
  const names = new Set([
    iso3,
    geonamesName,
    ...(wc?.name.official ? [wc.name.official] : []),
    ...(wc?.altSpellings ?? []),
    ...(EXTRA_ALIASES[iso2] ?? []),
  ])
  names.delete(iso2) // the code itself is matched separately
  names.delete(wc?.name.common)
  return [...names]
}

const countries = rows(countryText)
  .map((r) => {
    const [iso2, iso3, numeric, , name, capital, area, population, continent] = r
    const wc = wcByCode.get(iso2)
    return {
      code: iso2,
      iso3,
      numeric: numeric.padStart(3, '0'),
      name: wc?.name.common ?? name,
      capital,
      area: Number(area) || 0,
      population: Number(population) || 0,
      continent,
      sovereign: Boolean(wc && (wc.unMember || SOVEREIGN_EXTRAS.has(iso2))),
      flag: wc?.flag ?? '',
      lat: wc?.latlng[0] ?? 0,
      lng: wc?.latlng[1] ?? 0,
      aliases: aliasesFor(iso2, iso3, name, wc),
      // Features for the recommender
      subregion: wc?.subregion || continent,
      languages: Object.values(wc?.languages ?? {}),
      currencies: Object.values(wc?.currencies ?? {}).map((c) => c.name),
      landlocked: wc?.landlocked ?? false,
      borders: (wc?.borders ?? []).map((iso3) => iso2ByIso3.get(iso3)).filter(Boolean),
      ...costFor(iso3),
    }
  })
  .filter((c) => c.code !== 'CS' && c.code !== 'AN') // defunct codes

const knownCountries = new Set(countries.map((c) => c.code))

const citiesText = unzipEntry(citiesZip, 'cities15000.txt').toString('utf8')
const round = (n) => Math.round(Number(n) * 1000) / 1000

// GeoNames feature codes -> city kind: 0 ordinary, 1 regional seat, 2 capital, 3 district of a larger city
const KIND = { PPLA: 1, PPLC: 2, PPLG: 2, PPLX: 3 }

// Compact tuple format:
// [id, name, asciiName, lat, lng, countryCode, region, population, kind, prominence]
// prominence = number of alternate names in GeoNames, a proxy for international fame.
const cities = rows(citiesText)
  .filter((r) => knownCountries.has(r[8]))
  .map((r) => [
    Number(r[0]),
    r[1],
    r[2] === r[1] ? '' : r[2],
    round(r[4]),
    round(r[5]),
    r[8],
    admin1.get(`${r[8]}.${r[10]}`) ?? '',
    Number(r[14]) || 0,
    KIND[r[7]] ?? 0,
    r[3] ? r[3].split(',').length : 0,
  ])
  .sort((a, b) => b[7] - a[7])

await mkdir('public/data', { recursive: true })
await mkdir('src/data', { recursive: true })
await writeFile('public/data/cities.json', JSON.stringify(cities))
await writeFile('src/data/countries.json', JSON.stringify(countries, null, 1))

console.log(`Wrote ${cities.length} cities and ${countries.length} countries`)
console.log(`Sovereign countries: ${countries.filter((c) => c.sovereign).length}`)

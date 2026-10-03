# Lokation

Lokation is a personal travel tracker. Log the cities you've been to, see them on a map, and get stats on how much of the world you've covered by country, continent and population.

## Running it

```sh
npm install
npm run dev       # http://localhost:5173 (saves to .data/users.json instead of the online database)
npm run build     # production build in dist/
npm test          # recommender tests, including a leave-one-out accuracy check
```

## Using it

- **Add a city:** type in the search bar and press Enter, or click anywhere on the map and choose "I've been here". You can narrow a search with a comma, for example `springfield, illinois` or `san jose, costa rica`.
- **Add just a country** (when you don't remember the city): search for it (common names work too, like `England`, `UK`, `USA` or `Holland`), or click inside the country on the map and choose "I've been to …" or "Just …". It counts toward your countries, continents and coverage, and shows on the map with a dashed border. If you later add a city in that country, the city takes its place.
- **The map:** countries you've visited are highlighted and each city is a glowing dot. Hover a country to see how many cities you've visited there, and click a dot to remove it. Zoom with the +/− buttons, a double-click, a pinch, or Ctrl + scroll (a plain scroll moves down the page).
- **Stats:** scroll down to see cities, countries out of 195, continents, the share of the world's land and population you've covered, per-continent progress, and records like the two cities farthest apart and your northernmost, southernmost, easternmost and westernmost points.
- **Rate places** 1–5★ from the countries list or a marker's popup. Ratings are optional and shape the suggestions: 4–5★ pull toward similar places, 3★ is a mild pull, 2★ ("it was okay") is neutral, and 1★ steers away from look-alikes.
- **Where next?** Below the stats are two groups of suggestions, each with the reasons behind it:
  - **Like your trips**: places that share the most with the ones you rated highly, with a match score and what they have in common ("French-speaking, like Paris", "Similar size: 1M vs Paris 2.1M").
  - **Something different**: well-known places unlike anywhere you've logged, with what makes them different ("First trip to South America", "Southern Hemisphere", "8,800 km from the nearest place you've been").

  Each card has a **score breakdown**: a bar chart of exactly how much each feature added to its score.

  Both appear on the map as dashed rings (blue and violet). **Not for me** hides a suggested city or its whole country, and you can undo it.
- **Your countries compared:** charts of each visited country's population, area, price level and typical visitor spend against the world median, plus a table of every feature the recommender uses.
- **Signing in:** type your name to open your map; names aren't case-sensitive. There's no password, so anyone who enters your name can see and change your map. Changes save automatically. A map this browser kept before sign-in existed is uploaded the first time you sign in. **Export** and **Import** still work for backups.

## Deploying (Vercel + a free database)

The app is a static Vite site plus one serverless function, [`api/user.ts`](api/user.ts), which stores each person's map as one JSON document in **Upstash Redis** (free tier), keyed by their lowercased name.

1. **Import the repo on Vercel:** [vercel.com/new](https://vercel.com/new) → pick this GitHub repo → **Deploy**. Vercel detects Vite; no settings needed.
2. **Add the database:** in the project, open **Storage** → **Create Database** → **Upstash for Redis** (free plan) → connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` equivalents) to the project's environment.
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the function picks up the database settings.

Until the database is connected, signing in shows "The database is not configured." Every push to `main` redeploys automatically.

If two people save the same map at the same moment, the later save wins; for a few friends with distinct names that's fine.

## Data

The map draws everything from bundled data, so it needs no API keys and works offline.

| File | Source |
|---|---|
| `public/data/cities.json` | [GeoNames](https://www.geonames.org/) cities with a population of 15,000 or more (CC BY 4.0) |
| `src/data/countries.json` | GeoNames country info, merged with [world-countries](https://github.com/mledoze/countries) |
| Cost (`priceLevel`, `visitorSpend` in countries.json) | [World Bank](https://data.worldbank.org/) (CC BY 4.0): household-consumption PPP divided by the exchange rate (prices relative to the US), and tourism receipts per international arrival, 2015–19. Values outside plausible ranges are dropped. |
| Country shapes | [Natural Earth](https://www.naturalearthdata.com/) via `world-atlas` |

To refresh the city and country data, run `npm run build:data`.

## How suggestions work

[`src/lib/recommend.ts`](src/lib/recommend.ts) is a content-based model that runs entirely in the browser:

1. **Features.** A logged city is described by its own data: population (log scale), prominence (how many names GeoNames knows it by, a proxy for fame), whether it's a capital or regional seat, and its exact location. It also uses its country's continent, subregion, languages, currency, landlocked status, neighbours, price level and typical visitor spend. Cost data is per country only; no open dataset covers costs city by city. A country logged without a city uses only the country-level features; the city-specific ones are left out rather than guessed.
2. **Similarity.** Each candidate city is compared with each logged place, feature group by feature group (weighted; see `FEATURE_WEIGHTS`).
3. **Score.** *Like your trips* uses affinity (the average of the 4 strongest matches, weighted by rating), a little novelty and a small boost for well-known places, and pushes down places resembling a 1★ rating. *Something different* rewards low similarity to every logged place (judged on place and culture only, so being small or obscure doesn't count as different), firsts (new continent, region or country) and how much of a destination the city is.
4. **Diversity.** A final pass penalises picks in the same country (and, for *Something different*, the same continent) or within 150 km of each other.

Parameters were tuned with a leave-one-out test (hide one city from a sample traveller's history and check whether it comes back in the top 10) across five sample travellers. The current mean is about 55%.

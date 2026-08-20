# avenCITY — Living Concept Paper

> **Status: DRAFT v0.3 — for discussion.** Changes from v0.2: hexes carry
> **biomes**; **fully open market** (players set prices themselves — only the
> composition layer is pre-configured); the first **10 base resources** and
> the survival-start spark sequence are specified; heart expiry replaced by
> **7% demurrage**; time rebased to **1 game day = 1 real hour**; the
> **Founding Grant** (50K at spawn) and **level-scaled growing needs** for
> citizens and domes.
> 💬 marks open questions. All numbers live in the tuning table (§9).
> This paper renders on the site at `/concept`, and the economy is executable
> data in [`game/config/`](game/config/): `resources.json` · `biomes.json` ·
> `recipes.json` · `domes.json` · `citizens.json`.

## 0. Design pillars

1. **The map is the whole UI.** Hexagons on a map — that's the game.
2. **One currency: HEARTS** — minted equally for everyone, melting slowly
   (demurrage). Attention is the capital; it cannot be hoarded.
3. **Composition is configured, prices are discovered.** Recipes — what goes
   in, what comes out, what a factory can make — are static JSON. What things
   *cost* emerges from players on an open market.
4. **You instruct, your Aven runs.** Players decide what/why; Aven agent-CEOs
   execute everything operational.
5. **Own the streams, exit the rat race.** Hearts → SPARKminds → dividends →
   freedom.

---

## 1. Time

**One real day = 24 game days.** (1 game day = 1 real hour.)

| Unit | Real time | Notes |
| --- | --- | --- |
| **Game day** | **1 hour** | The heartbeat. 24 ♥ minted per day — 1 per game hour (2.5 real min). |
| Game week | 7 h | Default spark funding window. |
| Game year | 365 days ≈ 15 real days | A season ≈ 4 real days. |

The rhythm this buys: checking in once or twice a real day is enough to
invest your accrued hearts before demurrage eats them — daily spending
pressure without minute-level FOMO.

## 2. The board — hexes & biomes

The city is a hex map. **Every hex is composed of 1 or 2 biomes**, and biomes
carry the natural resources. Five biomes cover all ten base resources:

| Biome | Natural resources |
| --- | --- |
| RIVER | WATER · CLAY |
| FOREST | WOOD · HERBS |
| MOUNTAIN | STONE · ORE |
| MEADOW | GRAIN · FIBER |
| DUNES | SAND · SUN |

- A 2-biome hex (e.g. RIVER + FOREST) offers up to four resources — hex
  value is its biome combination. Location genuinely matters: you cannot
  found a waterworks on a dune.
- Extraction requires a dome on a hex with the matching biome; output rates
  are biome-configured (JSON).

**The land is never for sale.** All hexagons are owned — permanently — by
**the CITY SPARK**, a native spark that predates every player. Real estate
cannot be bought, only *used*: every dome pays a daily **hex usage fee**
(ground rent, scaled by dome level) to the City Spark for the parcel it
stands on. Domes themselves are private — funded by SPARKmind raises, owned
by their holders, collecting their own income (a LIVING dome collects
residential rent from its citizens while paying its own ground rent to the
city). What you can own is what you *build and run*, never the ground
itself — no land speculation, no landlording on unimproved dirt.

**Unlocking a hex takes a village.** A new hexagon opens only when **at
least 10 citizens pool 300,000 ♥** (30,000 each) to the City Spark. Every
spawning player's Founding Grant (§5) earmarks exactly one such share — so
**ten new citizens = one new hexagon**. Population growth IS city growth;
the map expands at the speed the community does.

```
WILD (biomes visible) ──(spark funded + built)──▶ DOME ──(upgrades)──▶ LV.2–5
```

## 3. Dome types (unchanged from v0.2)

| Type | What it is | What it produces |
| --- | --- | --- |
| **LIVING** | Housing with integrated permaculture | GRAIN + HERBS daily (biome-boosted) + houses citizens (rent) |
| **FACTORY** | Extraction or production, exactly **one recipe** | The recipe's output |
| **VENUE** | Stadium, theatre, bathhouse, academy | JOY + neighbourhood bonus 💬 |

## 4. SPARKS & SPARKminds (unchanged from v0.2)

A spark proposes: *which hex, which dome, which recipe.* Investors' hearts
mint **SPARKminds 1:1** (pro-rata dividend shares, forever); the hearts pool
in the **City Treasury**, which pays construction by buying materials from
the city's own factories at market price. Goal missed → full refund.
Founder minimum stake: 24 ♥. Upgrade raises issue new SPARKminds (dilution).

**Dividends stream in real time.** A dome's net income doesn't arrive as a
daily batch — it drips into SPARKmind holders' wallets continuously, and the
stream scales with the spark's level (production multiplies per LV, so the
stream does too). Watching your hearts tick upward *live* is the core
dopamine of ownership — the income-stream panel from the reference board,
made literal.

## 5. HEARTS — the Founding Grant, minting & demurrage

- **The Founding Grant:** every player spawns with **50,000 ♥ in advance** —
  their first investment, day one. It is earmarked:
  - **30,000 ♥ → one founder share of a new hexagon unlock** (locked; pools
    with 9 other citizens' shares to open a hex, §2).
  - **20,000 ♥ → free investment budget** — sparks, domes, upgrades. It melts
    like all held hearts: deploy it or watch demurrage eat it. The first
    session IS an investing session.
- **Minting:** 24 ♥ per citizen per game day, dripped 1 ♥/game-hour.
- **Demurrage: 7% per game day** on *held* balances — hearts melt while idle
  (Gesell's rusting money). Invested hearts (SPARKminds) don't melt — that's
  the whole point: **the only way to store attention is to invest it.**
- Consequence: an idle wallet converges to ~343 ♥ (24 ÷ 0.07) no matter how
  long you hoard — there is a natural ceiling on cash, none on ownership.
- 💬 Q5: is demurrage alone enough spending pressure, or do we also pause
  minting above a wallet cap (e.g. 72 ♥ = 3 days)?
- **Demurrage is the only burn.** Everything else circulates: needs → dome
  owners, investments → treasury → factories, and **hex usage fees → the
  City Spark** (replacing v0.2's burned upkeep). Proposal 💬 Q8: the City
  Spark is owned by *all citizens equally* — its ground-rent income funds
  the daily UBI. Land value returns to everyone; Henry George would smile.

## 6. Resources, recipes & the open market

### 6.1 The first 10 base resources

**WATER · WOOD · STONE · ORE · SAND · CLAY · GRAIN · FIBER · HERBS · SUN** —
each anchored to a biome (§2). These are the whole tier-0 economy at launch.

### 6.2 The recipe layer (pre-configured JSON)

Only composition is fixed: inputs → outputs, rates, and which dome runs it.

```jsonc
// recipes.json — the universal shape
{ "id": "mill_flour",  "dome": "FACTORY", "inputs": { "GRAIN": 2 },                 "output": { "FLOUR": 1 } }
{ "id": "bake_bread",  "dome": "FACTORY", "inputs": { "FLOUR": 1, "WATER": 1, "WOOD": 1 }, "output": { "BREAD": 2 } }
{ "id": "saw_planks",  "dome": "FACTORY", "inputs": { "WOOD": 2 },                  "output": { "PLANK": 1 } }
{ "id": "fire_bricks", "dome": "FACTORY", "inputs": { "CLAY": 2, "WOOD": 1 },       "output": { "BRICK": 1 } }
{ "id": "melt_glass",  "dome": "FACTORY", "inputs": { "SAND": 2, "WOOD": 1 },       "output": { "GLASS": 1 } }
{ "id": "forge_tools", "dome": "FACTORY", "inputs": { "ORE": 1, "WOOD": 1 },        "output": { "TOOL": 1 } }
{ "id": "weave_cloth", "dome": "FACTORY", "inputs": { "FIBER": 2 },                 "output": { "CLOTH": 1 } }
{ "id": "extract",     "dome": "FACTORY", "inputs": {},  "biome": "required",       "output": "per biome table" }
```

### 6.3 The open market (people decide, fully open)

**No configured prices anywhere — the market is the players.** Sellers (via
their Avens) list output at whatever ask they choose; buyers take the offers
they accept. No base prices, no clamps, no formula: price discovery is pure
supply, demand and nerve.

- The UI shows last-trade price + 7-day sparkline per resource — enough to
  smell scarcity and opportunity.
- Standing Aven directives do the work: "sell BREAD at 8+, undercut the
  cheapest ask by 1", "buy WATER up to 3". The market is agents trading on
  their founders' instructions.
- High prices ARE the founding signal: GLASS trading rich means the city
  needs a glassworks — and someone will spark one. Shortage self-corrects
  through founding, not through a pricing engine.

### 6.4 The survival start (the first sparks)

The opening arc: a small commons, ~7 wild hexes revealed, and needs that
must be met from zero. The natural founding sequence — each one a real
spark, funded by the first citizens' hearts:

| # | Spark | Hex needs | Produces | Why first |
| --- | --- | --- | --- | --- |
| 1 | **The Well** | RIVER | WATER | Citizens drink daily |
| 2 | **First Hearth** (LIVING) | MEADOW | GRAIN + HERBS, houses 6 | Food source + homes + rent |
| 3 | **Forestry** | FOREST | WOOD | Fuel + construction |
| 4 | **The Mill** | any | FLOUR = 2 GRAIN | First composition step |
| 5 | **The Bakery** | any | BREAD = FLOUR+WATER+WOOD | Closes the FOOD loop |
| 6 | **Sawmill / Kiln / Glassworks** | FOREST / RIVER / DUNES | PLANK · BRICK · GLASS | Unlocks building more domes |

Dome construction costs are material recipes too (e.g. LV.1 dome =
8 PLANK + 6 BRICK + 4 GLASS) — so the construction chain (#6) is what turns
a survival camp into a growing city. **The tutorial IS the economy
bootstrapping itself.**

### 6.5 Upgrade verticals

Every dome levels LV.1 → LV.5 along three independent tracks (configured in
`upgrades.json`; paid from the dome treasury or a fresh SPARKmind raise —
each raise dilutes, each is a new "would you still invest?"):

| Vertical | Effect per level | The business lever |
| --- | --- | --- |
| **SPEED** | +1 batch per game day | throughput |
| **EFFICIENCY** | −10% recipe inputs | cheaper production |
| **MARGIN** | +10% revenue per unit (quality/brand premium) | profit per unit |

Level also multiplies the dividend stream (§4) — upgrades are literally
investments in the income stream's flow rate.

## 7. Citizens & the rat race — needs that grow

**There are zero wages in this world.** Post-AGI: nobody sells labor,
there is nothing to be employed *as*. Income is exactly two things — your
minted 24 ♥/day (the attention UBI) and **dividend streams from SPARKminds
you hold**.

**Needs scale with level, and levels grow over time.** Every citizen has a
lifestyle level (LV.1–5, rising with tenure — one level per game year); every
level's needs are a configured per-day table (`citizens.json`):

| | LV.1 | LV.3 | LV.5 |
| --- | --- | --- | --- |
| WATER | 1 | 2 | 4 |
| FOOD | 1 | 3 | 6 |
| HOME slots | 1 | 2 | 3 |
| JOY | — | 2 | 4 |
| CLOTH | — | 1 | 3 |

**Domes have the same physics** (`domes.json`): a LV.1 factory sips
2 WATER + 1 POWER a day, a LV.5 gulps 24 WATER + 14 POWER + tools + cloth.
Scale ambition, scale appetite — bigger streams need bigger supply chains,
which is exactly what makes room for the next founders.

**FREEDOM** is therefore not a badge you win once: dividend streams ≥ cost
of living *at your current level*, held 7 straight days — and life keeps
getting bigger underneath you. The rat race is lifestyle inflation,
mechanized; escaping it for good means growing streams faster than your
life grows. City score: **Freedom Rate**.

## 8. Avens (unchanged)

You instruct, your Aven runs — founding, producing, market orders, upgrade
queues — reported daily. MVP: directive presets styled as chat; v2:
free-text agents.

---

## 9. Tuning table (single source of truth)

| Parameter | v0.3 value | Notes |
| --- | --- | --- |
| Game day | **1 real hour** | year ≈ 15 real days |
| Heart income | 24 ♥/day (1/game-hour) | universal, equal |
| **Demurrage** | **7% per game day** on held hearts | idle ceiling ≈ 343 ♥ |
| Wallet mint-cap | 💬 Q5 (proposal: none, demurrage only) | |
| Cost of living | grows with lifestyle level (citizens.json) | LV.1 modest → LV.5 hungry |
| Wages | **none — zero labor market** | income = UBI + dividends only |
| Dividends | stream in real time, × level multiplier | the live income stream |
| Upgrade verticals | SPEED · EFFICIENCY · MARGIN, LV.1–5 each | 60 ♥ × current LV per step |
| Founding Grant | 50,000 ♥ at spawn (30K hex share + 20K free) | first investment, day one |
| Hex unlock | 300,000 ♥ — min 10 founders × 30K | ten citizens = one hexagon |
| Spark raise (typical LV.1) | ~6,000 ♥ in 7 days | grant-scale, not drip-scale 💬 |
| SPARKminds | 1 ♥ = 1 SPARKmind | dilution via new raises |
| Founder min stake | 24 ♥ | skin in the game |
| Dome build (LV.1) | 8 PLANK + 6 BRICK + 4 GLASS | bought at market by treasury |
| Hex usage fee | 6 ♥/day × dome level → CITY SPARK | ground rent, circulates |
| Market damping | exponent 0.5, clamp 0.5×–3× base | daily repricing |
| LIVING dome | houses 6 · 8 GRAIN + 2 HERBS/day | permaculture baked in |
| FREEDOM | dividends ≥ living, 7 days | crest + score |

## 10. 💬 Open questions

1. **Rat-race dial.** ~50% of daily hearts free to invest — right for launch?
2. **Founder economics.** Flat pro-rata (founder earns only what they stake)
   or a founder bonus (e.g. 10–20% carry before the split)? Decides whether
   people play to *found* or to *back*.
3. **VENUE mechanics.** Adjacency bonus, a JOY need, or both?
4. **Treasury governance.** Auto-pay any funded spark vs. city votes.
5. **Demurrage vs. mint-cap.** Is 7%/day melt enough pressure, or also pause
   minting above a wallet cap? (Two knobs doing one job smells like one too
   many.)
6. **Biome balance.** 5 biomes × 2 resources is clean — but should some hexes
   be resource-poor on purpose (pure real-estate plays for LIVING/VENUE)?
7. **Offline.** At 1 h/day, a working person misses ~8 game days overnight
   (~192 ♥ minted, melting at 7%). Acceptable as-is, or does the Aven need a
   standing "auto-invest my hearts into X" directive? (My take: the standing
   directive IS the elegant fix — and very on-thesis.)
8. **Who owns the City Spark?** It collects every dome's ground rent. My
   proposal: all citizens hold it equally and its income funds the daily
   UBI — land value returns to everyone (Georgist single-tax, gamified).
   Alternative: it feeds the treasury and the UBI stays pure minting.

---

*Living document — v0.3. Argue in §10; promote settled answers into the spec.*

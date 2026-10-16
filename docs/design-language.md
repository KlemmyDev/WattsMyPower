# Design language

How every page in the dashboard is put together, so the app reads as one product. Solar, Home and Battery are the
reference pages; build new pages and rework old ones to match them.

The aim: **each card answers one question at a glance, and lets you drill in for more.** The number you came for is the
biggest thing on the card. Detail is one hover, tap or link away, never in the way.

## The page

```
PageHeader       title, and a subtitle that says what's happening now ("Charging from solar")
Hero card        today and now, full width (HeroCard kit)
[strip]          optional: a full-width row of live tiles (Home's Rooms now, All batteries)
Two columns      7fr | 5fr, items-start, gap-5; one column below 3xl
  left           the deeper story: the last days, how it's holding up, what's ahead
  right          actions and quick facts: controls, what happened, readings
```

- `PageHeader`'s `sub` is live when there's something to say (Home: "Washer is running now", Battery: "Running your
  home"), else one plain line about the page. Never a sentence that repeats the title.
- Columns: `grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1`. Each column is
  `flex min-w-0 flex-col gap-5`. On one column, use `max-3xl:contents` and `max-3xl:order-N` to put the most useful
  card (controls, say) first.
- Balance the columns by moving cards around, never by making anything sticky.

## The sky hero (Solar)

Solar has no page header. Its title, "Solar", and a line on how the day's going sit in the top left of its top card,
over the sky, with the weather, the live clock and the account in the top right (the page corner steps aside for them;
on a phone the clock and account stay in the top bar). The sky is drawn in the "Atmosphere" look: no drawn clouds, the
weather felt as light and colour. Its base colours follow the real sunrise and sunset. Five soft colour fields drift
slowly over it, one of them warm and riding with the light. The sun is a luminous orb with a wide bloom that warms as
it sinks, and the moon a crisp small orb (in its real phase) with a halo. Cloud greys the colours and brings wide fog
bands that veil the orb, rain cools them with fine streaks of falling light and a slow sheen, a storm darkens them and
flashes, and clear nights get stars and a faint aurora. The title reads on a wash of the sky's own top colour, worked
out each time to be only as strong as the words need (4.5:1 for the line, 3:1 for the title). The sky fades into the
card's solid ground. Right under the sky comes the day's chart, then the figures in one compact band (what's been made, with the day's pace in a slim bar under it, what's being made, and four that round the day out), so the sky keeps most of the card: 480 px of it (330 on a phone), and the whole card still fits one screen. The chart is the scrubber: dragging it (or the arrow keys) moves the sky and the figures to that moment, and sitting between them it keeps both in view while you drag, on a phone too.
"Play the day" (midnight to midnight in 20 seconds) and "Back to now" (which glides back) sit on the chart's top left,
where the night before sunrise leaves room. Maths in `features/solar/utils/atmosphere.ts` and `sky.ts`, styles at the
end of `app.css`.

Along the bottom of the sky sits your roof (`SolarRoof`, geometry in `utils/roof.ts`): one Colorbond slope seen from
eye level, its ridge low across the sky like a horizon, two rows of framed mono panels on it, a strip of bare roof
around them so it reads as the top of a house. Only the slope and its ridge show, never the far pitch. It keeps its
own palette in either theme and is lit by the sky: darker towards night, cooler in rain, warm at the ends of the day,
cloud shadows drifting over, wet glass in rain, the moon caught in the glass at night. How hard the panels are working
(a share of the array) is told by the orange lines along each row's top rail: more of them running, longer, brighter
and quicker as power rises, with a band of light crossing the glass. They stop when the panels do. Home and Battery
are meant to follow with close-ups of their own (the house's wall, the garage or side of the house).

It's built to stay smooth on a phone, Safari above all. Everything is a gradient: no blur filters, masks, blend modes
or backdrop blur, which Safari draws slowly and, in layers that move, clips into hard lines at their edges. The
colours only change every five minutes of sky (so a few times a second while the day plays), the sun and moon move by
transform alone, and everything that moves for good (drift, fog, rain) moves by transform or opacity. Rain is two
tiled layers, not a layer per drop, and the grain is a small noise tile drawn once. The whole sky stops while it's
scrolled away, and holds still with motion turned down.

## Lite effects

`common/display/utils/effects.ts` sets `data-effects="lite"` on `<html>` for a device that can't keep up: one that
says it's saving data or has very little memory or very few cores, or one whose frames, timed for two seconds once the
page has settled, mostly come slower than about 45 a second (remembered for a week). Lite drops what's costly to keep
drawing: backdrop blur on `.glass` (it goes near-solid), the page light's drift and grain, and in the sky the colour
fields' and fog's drift, the rain's sheen and nearer streaks, and plays the day at 30 frames a second.
Anything new that blurs what's behind it or animates without end needs a lite rule. Setting `wmp-effects` in local
storage to `lite` or `full` forces either, for trying them.

## The hero card

`web/src/features/common/ui/components/Hero.tsx`. Every Live page leads with one, and Insights pages (History, Plan,
Bills) use the same card for their top figures. The parts, in this order:

| Part                     | What goes in it                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HeroCard tint`          | Washed from the top in the page's colour (the nav colour, or the state: amber while discharging, moon blue at night).                                                                                    |
| `HeroLead`               | The one figure the page is about, today: "Made today 18.4 kWh", "Used today", "Level 74%", "Bought today". Under it, where it's heading and a `Delta` chip against what's usual or expected.             |
| `HeroLive`               | What's happening right now, with a `LiveDot`: "Generating now 3.2 kW", "Using now", "Discharging now". Under it, where from/to and a chip.                                                               |
| `HeroStats` + `HeroStat` | Exactly up to four figures that round it out. Label, value, one short sub line. No sentences.                                                                                                            |
| `HeroBar`                | Where the day stands along one bar: `HeroFill` (solid = so far, dashed = still to come, faint = a likely range), `HeroTick` for what it's measured against, `HeroKey` legend entries matching each mark. |
| Chart                    | The page's day chart (`TimeLine`), with context layers in its `under` slot on the same time scale (sky, rates, a lane per room, hourly in/out). Hover reads out the time across chart and layers.        |

The hero has two widget forms: `chart={false}` ("X at a glance") and `chart` ("X today").
On a dashboard, `HeroCard` names its page and links there (from the widget's group, via `WidgetFrame`), and it lays
itself out by its own width (a container), so phone stacking inside a hero uses `@max-xl:` and two-across stats
`@max-2xl:`, not viewport breakpoints.

## Cards below the hero

- `Card` from `common/ui/components/Card`. Header is `TitleBlock` (title + one muted line) on the left and, when the
  card has a headline number, a corner figure on the right (`text-[28px] font-light`, small label above).
- One question per card: "Where it went", "If the grid went down", "Last 30 days". Title says the question in plain
  words, sub says the answer's frame ("Today's solar so far").
- **Drill-down, in this order of preference:**
  1. **The card answers as you point** (Solar leads; move other pages over as they're touched). Pointing at, tapping or
     focusing a bar, day or part puts that item in the card's own header or corner figure in place of the card's
     summary (`usePick` from `common/ui/components/Pick`, `aria-live="polite"`), the rest fade to about 35%, and moving away puts the summary back.
     No floating tooltip over the card. Bars are real `<button>`s with an `aria-label`, so it works by keyboard and
     touch. Older cards still use `ChartTooltip`; tooltips on strips near a card's bottom open above
     (`className="top-auto bottom-full mb-2"`), as glass cards are stacking contexts.
     A header that swaps what it reads out must keep its height (both versions in one grid cell, or `PickHead`), or the
     chart under it moves out from under the pointer, the card puts its summary back, and it flickers.
  2. A whole-card or whole-tile link to the item's own page (Home's room tiles: a stretched `Link`; buttons inside stay
     clickable above it).
  3. A `Collapse` for rarely needed detail inside the card.
     Don't add tabs, accordions of accordions, or modals for reading data.
- **Depth on the page, in plain words.** When a page has more to say, fold it into its cards rather than pages a level
  down: a sentence that sums it up where it belongs (Solar's verdict on how the panels did under Last 30 days, how
  close the forecast gets under Days ahead), a card for the hardware ("Your panels": inverters and strings), and a
  quiet link to download the readings. Nothing confusing, no catch-all "details" page.
- Last N days: a heat strip of cells (`SolarDays`, `BatteryDays`): figures in a `dl` to the right of the title, cells
  coloured with `heatColor(color, share)`, a Less–More key under it.
- Splits: `Breakdown` (a bar of parts with a legend that lights the part on hover).
- Lists of items: a row per item with a coloured dot or icon tile, the name, a faint second line, the figure right
  aligned.
- Tables only for real tables (Outlook days, month by month). Header `text-xs text-ink-muted`, rows `border-t
border-line-subtle`, numbers right aligned and `tabular-nums`.
- Empty and not-connected states: `EmptyState`, or a single `Quiet` line in a card; never an error dump. Hide a card
  that has nothing to say rather than show dashes everywhere.
- Loading: `Skeleton` at the card's usual height (`rounded-3xl`).

## Type and numbers

- Figures are light (`font-light`) and `tabular-nums`, units smaller and faint (`Figure`): 64px lead, 28px live and
  corner, 20px stats, 17px figures in a strip header.
- Labels are sentence case, 12–13px, `text-ink-muted` / `text-ink-faint`. No uppercase mono eyebrows in new work.
- Format with `common/formatting/utils/number` (`kW`, `kWh`, `money`, `pct`, `centsShort`, `signedPct`) and
  `common/formatting/utils/date` (`hhmm`, `shortDay`, `duration`). Never hand-roll units.

## Colour

Energy colours carry meaning everywhere and come from `COLOR` (`common/theme/utils/colors`), never hex:
solar `COLOR.solar`, battery `COLOR.battery` (amber `batteryTone()` while discharging), home `COLOR.teal`, grid import
`COLOR.import`, export `COLOR.export`, good/warn/bad for verdicts. `alpha(color, a)` for washes and tints. A page's tint
is its nav colour (`NAV` in `common/layout/utils`).

`Delta` chips: up is green, down is amber; `invert` where less is better (use, cost).

## Motion

Subtle and quick: bars ease their width (`duration-700 ease-out-soft`), live dots breathe, hover fades others to
40–60%. Respect `motion-reduce`. No bouncing, no long entrances.

## Copy

Follow the copy voice: warm and brief, "you" only (never "we" or "I"), numbers first ("12.4 kWh used · 68% from solar"),
Australian spelling, errors say the cause then the fix, no colon-led lists, no "insights", "at a glance" in body copy,
"seamless" or "unlock". Cut any line that repeats its title.

## Widgets

Each page's cards are also dashboard widgets (`features/<f>/widgets/index.tsx`, discovered by glob). When a card
changes shape, update its widget's `sizes`/`phone` and `sub`. Hero widgets use the sizes Solar's do:
at a glance `[6,3]–[12,4]`, default `[12,3]`; today (with chart) `[6,8]–[12,10]`, default `[12,8]`.

## Before you ship a page

- Check it in the browser at desktop and 375px wide: no sideways scroll, the lead figure and bar first on a phone.
- Light and dark themes.
- `npm run typecheck && npm run lint && npm run format:check && npm run build` in `web/`.

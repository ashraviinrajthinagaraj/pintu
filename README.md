# Pintu

A private navigation web app for a small group: a 3D map with your own vehicle on it,
place search, routes, stops along the way, fuel and charge planning, solat times, a
lane-by-lane road view and spoken
turn-by-turn directions in Bahasa Melayu and English. No accounts and no install file;
open the link and add it to the home screen.

It's plain HTML, CSS and JavaScript with no build step, so GitHub Pages can serve this
folder as it is.

## What it relies on

| Job | Service | Notes |
| --- | --- | --- |
| Map display | [MapLibre GL JS](https://maplibre.org/), loaded from a CDN | Version set in `js/config.js` |
| Map tiles | [OpenFreeMap](https://openfreemap.org/) | No key. No guarantee of uptime |
| Place search | [Photon](https://photon.komoot.io/) public server | Fair use. Heavy use is throttled |
| Routing, lane arrows and lane counts | [Stadia Maps](https://stadiamaps.com/), then the [FOSSGIS Valhalla](https://valhalla.openstreetmap.de/) public server | See below |
| Rain forecast | [Open-Meteo](https://open-meteo.com/) | Free for non-commercial use, with credit |
| Official warnings | [MET Malaysia via data.gov.my](https://developer.data.gov.my/realtime-api/weather) | 4 requests a minute |
| Stops along the route | The map's own tiles first, then the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) and Photon | See below. Results are cached for 15 minutes |
| Solat times | [Waktu Solat API](https://api.waktusolat.app/), from JAKIM e-Solat | Not run by JAKIM. If it's down, Pintu shows no times |

### Routing

Pintu tries Stadia Maps first and falls back to FOSSGIS. Stadia refuses until this
site's address is added to a free account, so FOSSGIS does the work until then.

FOSSGIS is a volunteer server. Its maintainers say it isn't meant for production
services, so treat it as a way to try Pintu, and move to Stadia for regular use:

1. Create a free account at [stadiamaps.com](https://stadiamaps.com/). Its free tier
   covers non-commercial use and needs no card.
2. In the dashboard, open **Manage Properties** and add your domain under
   **Authentication Configuration**. For this site, the subdomain is
   `ashraviinrajthinagaraj` and the domain is `github.io`.

Pintu needs no change: Stadia starts answering and is used from then on.

### Stops

Public Overpass servers are often overloaded, so Pintu doesn't wait on them. It reads places
straight out of the map's vector tiles (`js/tiles.js`), nearest first, showing them as they
arrive. If the map shows, this works.

- The tiles only say a place of worship is one, not which kind, so a surau or mosque is
  recognised by its name. An R&R is also recognised by its name.
- Charging stations and R&Rs may be missing from the tiles, so those also ask Overpass and,
  failing that, Photon. For anything else, those two are asked only if the tiles found nothing
  or couldn't be read.
- A whole search ends within about 22 seconds whatever the network does, with what it found,
  or an offer to try again.

## Choosing where to start

The route screen has a start and a destination, either of which can be changed, or swapped.
A start can be searched for or chosen on the map. Away from a chosen start, the main button
previews the route as a simulated drive, and "drive to the start first" makes it the first stop
of a trip from where you are. Within 300 m of it, the trip starts as usual.

## Simulated drives

A simulated drive has a pause button, speeds from 1× to 30×, and a jump to the next turn or any
turn on a list. The trip line can be dragged or tapped to go anywhere, forward or back. None of
this counts as leaving the route. From 10× it's silent apart from arriving, and the lane view
is off. Ending the drive returns to the route screen with the plan unchanged.

## Voices

Settings has how much Pintu talks (full directions, or turns only) and who's talking. Each
character (`js/characters.js`) has its own lines and its own pitch and pace, in Malay and English.
They're all original. Characters from films are protected, so there are none here, but the
Trailer Voice and the Secret Agent are written in that spirit.

The instruction is never lost: it's said in full, jokes come after it where the next instruction
cuts them off, and at the moment of a turn a character says a word or two at most.

## Speed limit

Comes from the routing service with the lane counts, wherever OpenStreetMap has it. Where it
doesn't, nothing is shown rather than a guess. Over by more than 5 km/h for a few seconds, the
speed turns red and Pintu says so once.

## Rain and floods

- **Rain:** the Open-Meteo forecast at each point along the route, at the time you'd get there.
- **Official warnings:** MET Malaysia's, through data.gov.my, kept if they name a state the route
  passes through. Continuous rain warnings are the ones that come with a flood risk.
- **Rivers and closed roads:** one tap to JPS Public Infobanjir and JKR Bencana. Neither offers
  data a page can read, and the old data.gov.my flood endpoint was reported to have stopped
  updating in 2024, so Pintu doesn't show live river levels itself.

These are forecasts and area warnings, not road conditions, so Pintu never says a road is safe. A
failed check says it failed.

## HUD mode

A black screen with the next turn, the distance and your speed, flipped top to bottom. Lay the phone
flat on the dashboard and it reads correctly in the windscreen. It works best at night, on full
brightness. Tap the screen to turn the mirror off or leave.

## Sharing a location

Search takes Google Maps, Waze, Apple Maps and OpenStreetMap links, whole messages with a link in
them, and coordinates. On Android, once installed, Pintu can also be chosen from the share menu.
Opening `?to=3.15,101.71&name=Rumah` goes straight to a place.

Short links such as `maps.app.goo.gl` only say where they lead when followed, and a web page isn't
allowed to do that, so they go through the small server below.

## Walking to the door

The arrival screen offers walking directions to the destination, and Walk is a mode of its own. On
foot the instructions come closer to each turn, and GPS is allowed to wander more before it counts
as leaving the route.

### Malls

Pintu can't guide you inside a building. GPS is unreliable indoors, and a web page can't use the
Wi-Fi or Bluetooth signals that indoor positioning needs. So for a mall listed in `js/malls.js`, it
opens the mall's own interactive map and shop list, and with the server running it can search the
shop list for a lot number.

## The small server

`server/worker.js` runs on Cloudflare Workers (the free plan is plenty). It resolves short map links,
passes on MET warnings if the browser can't get them directly, and reads a mall's shop list. It only
answers this site, and only ever contacts the sites named in the file.

It's live at `https://pintu.ashraviinrajthinagaraj.workers.dev`, set as `server` in `js/config.js`. To
change it, push to `main`: `.github/workflows/server.yml` deploys it using a repository secret called
`CLOUDFLARE_API_TOKEN` and the settings in `wrangler.toml`, whose `name` must match the Worker's name.
Secrets set in the Cloudflare dashboard stay as they are.

### Human voices

Switched off for now with `humanVoices: false` in `js/config.js`: Google's free allowance ran out within a
single drive. Everything below still works if it's switched back on.

Characters speak through the server's `/speak`, using one of two services:

- [Gemini](https://ai.google.dev/gemini-api/docs/speech-generation): the key is a Worker secret called
  `GEMINI_API_KEY`, made at [AI Studio](https://aistudio.google.com/apikey). No card is needed. Each
  character gets a voice designed with their accent the first time they speak. People report the free
  tier allows about 100 lines a day per model, resetting at midnight Pacific time, and Google may use
  what's sent to improve its products. Its terms require users to be 18 or over.
- [Azure Speech](https://azure.microsoft.com/products/ai-services/ai-speech): the secret is
  `AZURE_SPEECH_KEY`, from a Speech resource on the Free F0 tier in Southeast Asia (or set
  `AZURE_SPEECH_REGION`). It allows 500,000 characters a month but needs a card to sign up.

With both, Gemini goes first and Azure takes over when its allowance runs out.

Without a key, or with no signal, Pintu uses the phone's own voice. A direction never waits long for a
recording (`WAIT_TURN_MS` in `js/voice.js`), and the next ones are fetched early and kept on the phone.

Each character's voices are `ACTORS` (Gemini) and `SPEAKERS` (Azure) in `server/worker.js`. Lines in
`js/cast/` carry delivery marks like `[tease]`, with `…` for a pause. A whole line is one recording, so
it flows naturally, with each part of it directed separately.
Change `SPEECH_VERSION` in both `server/worker.js` and `js/voice.js` if a voice changes, so old
recordings aren't reused.

## The lane view

When the road has lanes mapped, Pintu draws them on the map in 3D: road surface, dividers,
painted arrows, a stop line, and a blue carpet leading into the lane you want.

- Lane arrows at a junction come with the route (Valhalla's `turn_lanes`). These decide the
  recommended lane, and are the only source for spoken lane advice.
- Lane counts come from a separate request for the road ahead (`trace_attributes`). With a
  count but no arrows, a turn uses the matching side: right turns from the right, left
  from the left. That's an estimate for a keep-left country, not mapped data.
- A phone's GPS isn't accurate enough to tell lanes apart. **The car on the map shows the
  lane to be in, not the lane you're in**, and the app says so the first time it appears.

The vehicles are general body shapes built in code (`js/car-mesh.js`), not models of any
real car, so there's nothing to download or license.

## Car figures

The models in the "my car" panel are starting points, not measurements of anyone's car.

- Petrol use: [WapCar](https://wapcar.my/news/bezza-more-fuelefficient-than-axia-top-5-most-efficient-cars-under-rm-100k-35618)
  for the Axia, City, Vios and Almera. The Myvi is the middle of the real-world estimates on
  [Mudah](https://www.mudah.my/malaysia/cars-for-sale/perodua/myvi/fuel-consumption).
- Electric range: WLTP figures from [paultan.org](https://paultan.org/2026/06/11/2026-proton-emas-7-premium-plus-launched-with-68-39-kwh-battery-115-kw-dc-450-km-wltp-rm119k-otr/)
  and [Motorist](https://www.motorist.my/article/6007/proton-e-mas-5-vs-byd-atto-3-2026-which-ev-should-you-buy-in-malaysia).
  Energy use is battery size divided by that range.

## Limits

- No live traffic, so times are estimates.
- Guidance can stop when the phone locks or another app is on screen, because browsers
  pause web pages. Pintu picks the trip back up when you return.
- Map, road names, search, stops and lane data are only as good as OpenStreetMap's.
- Fuel and range figures are estimates from what you enter.
- Voice depends on the voices installed on each phone.

## Tests

```
node --test tests/*.test.js   # navigation logic, routing and search
node tests/e2e/run.js         # the whole app in a browser, needs Playwright
MAPLIBRE_DIR=/path node tests/e2e/real-map.js   # the same on the real map library
```

`run.js` uses stand-ins for the map library and services. `real-map.js` uses the real
library and real style files from a local folder, with stand-in map data and services.
Neither talks to the real servers.

Fonts are [Barlow](https://github.com/jpt/barlow), under the licence in `fonts/OFL.txt`.

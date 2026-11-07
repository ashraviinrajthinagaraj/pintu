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

## Speed cameras

AES and AwAS cameras come from OpenStreetMap (`highway=speed_camera`), asked for once along the
whole route when a trip starts (`js/cameras.js`). A camera counts if it's mapped within 18 m of the
route. The warning shows from 300 to 800 m ahead, depending on speed, and is said once. Only mapped
cameras are known, so no warning never means no camera.

## Traffic

Live traffic comes from [TomTom](https://developer.tomtom.com) through the server's `/traffic`
(`js/traffic.js`). When a trip starts, and every 3 minutes while driving, the rest of the route is
sent as up to 1,500 points; TomTom follows it with today's traffic and answers with each slow stretch
on it and the minutes it adds. Pintu then:

- shows the next one within 10 km on the driving screen and the HUD (red for a jam or a closed road,
  orange for roadworks), counting down from inside it;
- says it once, about 2.5 km before;
- adds the delay still ahead to the arrival time.

Holdups under a minute aren't mentioned. A simulated drive asks once, at the start. It can be switched
off in Settings. The free allowance is about 20,000 route checks a month (an hour's drive uses about 20).
TomTom's coverage is best on highways and main city roads; it has accidents and roadworks, but not
driver reports like Waze.

## Tolls

Each route option shows roughly how far it runs on toll roads, from the toll mark on each of
Valhalla's manoeuvres. Prices aren't shown: there's no reliable free source for Malaysia's rates,
which on PLUS depend on where you enter and leave.

## Home and work

Saved on the phone, set from the main screen or settings. With a position, each shows the journey
time and arrival clock, asked again after 5 minutes or a 500 m move.

## Parking

Car parks within 500 m of the destination come from the map's own tiles (`js/parking.js`).
Choosing one ends the drive there, and the walk to the door picks up from it.

## Leaving on time

Pick an arrival time in the plan and Pintu works out when to leave (`js/leaveby.js`), from the
route's time without live traffic.

## Junction views

Before a highway exit, ramp or fork (manoeuvre types 17 to 24), a picture shows the branch to take,
its exit number and signs, and how close it is: from 1.5 km on highways and 500 m elsewhere
(`js/junction.js`).

## Where's my car

When a real drive ends, Pintu remembers where (with an optional note, like a level or pillar),
shows it on the main screen and the map, and offers a walking route back. Tapping your own position
saves it by hand. Starting a drive within 300 m of it, or walking to it, forgets it. Kept for a week.

## Places on the map, and nearby

Tapping a named place on the map opens a card with what it is and how far, and a way to go there
(`_placeTap` in `js/map.js`, words from `js/kinds.js`). The chips at the top find places to visit,
food, petrol, EV charging and hotels near you, or near the middle of the map without a position:
from the map's tiles within 2.5 km, and from Overpass further out when there are fewer than eight
(`js/nearby.js`).

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
brightness. Tap the screen to turn the mirror off, pick a colour (white, green, light blue or yellow)
or leave.

It also shows:

- **Lanes** before a turn or exit, with the lane to be in lit and underlined.
- **A toll plaza ahead**, within 2 km, so there's time to get the Touch 'n Go card ready. Plazas
  come from OpenStreetMap, so only mapped ones are known, and they're only looked for on routes
  with tolls.
- **A break reminder** after two hours at the wheel. Driving time carries on into the next trip
  unless there's been a stop of 15 minutes or more.
- **Traffic ahead**, the same as on the driving screen: what it is, how far, and the minutes it adds.

Held upright, there's only room for one of these: a toll plaza first, then traffic, then the break.

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

### Traffic key

The TomTom key is a Worker secret called `TOMTOM_API_KEY`: sign up free at
[my.tomtom.com](https://my.tomtom.com) (no card), and copy "My first API key" from API & SDK Keys.
Opening `https://pintu.ashraviinrajthinagaraj.workers.dev/traffic?check=1` in a browser says whether
it works. Without a key, Pintu simply shows no traffic.

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

# Pintu

A private navigation web app for a small group: map, place search, routes and spoken
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
| Routing | [Stadia Maps](https://stadiamaps.com/), then the [FOSSGIS Valhalla](https://valhalla.openstreetmap.de/) public server | See below |

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

## Limits

- No live traffic, so times are estimates.
- Guidance can stop when the phone locks or another app is on screen, because browsers
  pause web pages. Pintu picks the trip back up when you return.
- Map, road names and search coverage are only as good as OpenStreetMap's.
- Voice depends on the voices installed on each phone.

## Tests

```
node --test tests/*.test.js   # navigation logic, routing and search
node tests/e2e/run.js         # the whole app in a browser, needs Playwright
```

The browser tests use stand-ins for the map library and services, so they check Pintu's
behaviour, not how the real map looks or how the real servers respond.

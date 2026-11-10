# Monthly toll fare check

Pintu prices a toll plaza only on highways that charge a car (Class 1) one fixed fare at every
plaza, in both directions. Those fares are in `js/toll-fares.js` (the `FARES` list) and in the
table under "Tolls" in `README.md`. This check keeps them current. It runs once a month.

## What to do

1. Read `FARES` in `js/toll-fares.js`. For each highway, note its `rm`, `since` and `source`.
2. For each highway, search the web for a change to its Class 1 (private car) toll rate after its
   `since` date. Search in English and Malay, for example `LDP toll rate 2026`, `kadar tol LDP`,
   `KESAS toll hike`, `DASH toll rate`, `kadar tol BESRAYA`, and the operator's name.
3. Trust only these sources: the Malaysian Highway Authority (llm.gov.my), the Ministry of Works
   (kkr.gov.my), the highway operator's own site, Bernama, The Star, New Straits Times, Malay
   Mail, paultan.org, Utusan and Berita Harian. Never use forums, social media or blogs.
4. Change a fare only when a trusted source states the new Class 1 rate and the date it takes
   effect, and that date has already passed. Then, for that highway:
   - set `rm` to the new rate, `since` to the date it took effect (YYYY-MM-DD), and `source` to
     the article's address;
   - update its row in the README table the same way;
   - if a highway now charges different fares at different plazas or by direction, remove it
     from `FARES` and the table instead, and say why in the summary;
   - if its toll was abolished, remove it the same way.
5. A change announced for a future date is not made yet. Report it in the summary with its date.
6. Don't add new highways. If a trusted source shows another highway now has one fixed car fare
   at all its plazas, mention it in the summary with the link.
7. If anything changed: run `npm test` (all must pass), then commit with a message like
   `Update LDP toll fare to RM2.30 from 2027-01-01` and push to main
   (`git pull --rebase origin main`, then `git push origin HEAD:main`). Edit nothing else.
8. If nothing changed, don't commit.

## Summary

Finish with a short summary in plain language: each highway's fare as checked, what changed and
from when, the links used, anything announced for later, and anything that couldn't be checked.

# Bus Tracker (static web app: Firebase + Google Maps)

## Files
- `index.html`   – landing page (Student / Driver)
- `driver.html` + `driver.js`   – login, GPS sharing, geofence auto-end
- `student.html` + `student.js` – live map, ETA, stale-signal detection
- `shared.js`  – Firebase init, haversine, Maps loader
- `config.js`  – YOUR keys go here
- `database.rules.json`, `seed-data.json` – Realtime Database setup

## Setup
1. **Firebase**: create a project → Build → *Realtime Database* (create) →
   *Authentication* → enable **Email/Password** and **Anonymous**.
2. Add a Web app, copy its config into `config.js`.
3. **Google Maps**: enable *Maps JavaScript API*, create a key, paste into `config.js`,
   and restrict it to your domain.
4. Realtime Database → *Rules*: paste `database.rules.json` → Publish.
5. Authentication → Users → *Add user* (driver email + password). Copy that user's **UID**.
6. Realtime Database → *Data* → Import JSON → `seed-data.json`
   (replace `PASTE_DRIVER_UID_HERE` with the UID first; fix destination lat/lng).
7. Run over **HTTPS** (GPS requires it; `localhost` also works):
   - Local: `npx serve .` (or `python3 -m http.server 8000`) → http://localhost:8000
   - Deploy: `npm i -g firebase-tools && firebase login && firebase init hosting && firebase deploy`

## How it works
Driver phone → `watchPosition` → writes `/live/{busId}` every 3 s →
students subscribe with `onValue` → marker moves instantly.
Geofence: 3 consecutive fixes within `radius` metres of `destination` ends the trip
(`status: "ended"`). If the driver's phone loses connection, `onDisconnect` marks the bus `offline`.

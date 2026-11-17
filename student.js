import { auth, db, haversine, fmtDistance, loadMaps } from "./shared.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = id => document.getElementById(id);
const STALE_AFTER_MS = 30000;

let maps, map, busMarker, destMarker, geofence, unsubscribe, tick;
let bus = null, last = null;

init().catch(e => ($("msg").textContent = e.message));

async function init() {
  [maps] = await Promise.all([loadMaps(), signInAnonymously(auth).catch(() => {})]);
  map = new maps.Map($("map"), {
    center: { lat: 20.5937, lng: 78.9629 }, zoom: 5,
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false
  });

  const buses = (await get(ref(db, "buses"))).val() || {};
  const sel = $("busSelect");
  sel.innerHTML = '<option value="">Select a bus</option>';
  for (const [id, b] of Object.entries(buses)) {
    const o = document.createElement("option");
    o.value = id; o.textContent = b.name; sel.appendChild(o);
  }
  sel.onchange = () => follow(sel.value, buses[sel.value]);

  const saved = localStorage.getItem("busId");
  if (saved && buses[saved]) { sel.value = saved; follow(saved, buses[saved]); }
}

function follow(id, b) {
  unsubscribe?.(); clearInterval(tick);
  busMarker?.setMap(null); destMarker?.setMap(null); geofence?.setMap(null);
  last = null; bus = b;
  if (!id || !b) return setStatus("Select a bus", "");
  localStorage.setItem("busId", id);

  destMarker = new maps.Marker({ map, position: b.destination, title: b.destination.name,
    label: { text: "★", color: "#fff" } });
  geofence = new maps.Circle({ map, center: b.destination, radius: b.radius || 100,
    strokeColor: "#0d6b54", fillColor: "#0d6b54", fillOpacity: .12, strokeWeight: 1 });
  map.setCenter(b.destination); map.setZoom(14);
  setStatus("Waiting for the driver…", "");

  unsubscribe = onValue(ref(db, `live/${id}`), snap => {
    last = snap.val();
    render();
  }, err => ($("msg").textContent = "Cannot read live data: " + err.message));

  tick = setInterval(render, 1000); // keeps "x seconds ago" and stale check fresh
}

function render() {
  if (!bus) return;
  if (!last) return setStatus("Not running yet", "");

  if (last.status === "ended") return setStatus("Trip ended — bus has arrived", "");
  if (last.status === "offline") return setStatus("Driver went offline", "bad");

  const age = Date.now() - (last.ts || 0);
  const pos = { lat: last.lat, lng: last.lng };

  if (!busMarker) {
    busMarker = new maps.Marker({ map, position: pos, title: bus.name,
      icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, rotation: last.heading || 0,
              fillColor: "#f0b400", fillOpacity: 1, strokeColor: "#16252b", strokeWeight: 2 } });
    const b = new maps.LatLngBounds(); b.extend(pos); b.extend(bus.destination);
    map.fitBounds(b, 60);
  } else {
    busMarker.setPosition(pos);
    const icon = busMarker.getIcon(); icon.rotation = last.heading || 0; busMarker.setIcon(icon);
  }

  const dist = haversine(pos, bus.destination);
  const ms = last.speed > 2 ? last.speed : 5.5;          // fall back to ~20 km/h
  const mins = Math.max(1, Math.round(dist / ms / 60));
  $("distance").textContent = fmtDistance(dist);
  $("eta").textContent = `~${mins} min`;
  $("updated").textContent = `Updated ${Math.max(0, Math.round(age / 1000))} s ago`;

  age > STALE_AFTER_MS ? setStatus("Signal lost — last known position", "bad")
                       : setStatus("Live", "live");
}

function setStatus(text, cls) {
  const s = $("status");
  s.textContent = text; s.className = "chip " + cls;
  if (!last || last.status !== "active") { $("eta").textContent = "—"; $("distance").textContent = "—"; }
}

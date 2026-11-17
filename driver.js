import { auth, db, haversine, fmtDistance } from "./shared.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { ref, get, set, update, onDisconnect, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = id => document.getElementById(id);
const SEND_EVERY_MS = 3000;     // how often to push a location
const ARRIVE_FIXES = 3;         // consecutive in-radius fixes before auto-ending

let uid, bus, busId, watchId = null, wakeLock = null;
let lastSent = 0, insideCount = 0;

/* ---------- auth ---------- */
$("loginBtn").onclick = async () => {
  $("loginMsg").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (e) {
    $("loginMsg").textContent = "Sign-in failed. Check your email and password.";
  }
};
$("logoutBtn").onclick = async () => { await endTrip("signed-out"); await signOut(auth); };

onAuthStateChanged(auth, async user => {
  $("login").classList.toggle("hidden", !!user);
  $("panel").classList.toggle("hidden", !user);
  if (!user) return;
  uid = user.uid;
  await loadBuses();
});

async function loadBuses() {
  const assigned = (await get(ref(db, `drivers/${uid}/buses`))).val() || {};
  const ids = Object.keys(assigned).filter(k => assigned[k]);
  const sel = $("busSelect");
  sel.innerHTML = "";
  if (!ids.length) {
    $("tripMsg").textContent = "No bus is assigned to your account. Ask your admin.";
    $("startBtn").disabled = true;
    return;
  }
  for (const id of ids) {
    const b = (await get(ref(db, `buses/${id}`))).val();
    const o = document.createElement("option");
    o.value = id; o.textContent = b ? b.name : id;
    sel.appendChild(o);
  }
}

/* ---------- trip ---------- */
$("startBtn").onclick = async () => {
  busId = $("busSelect").value;
  bus = (await get(ref(db, `buses/${busId}`))).val();
  if (!bus) { $("tripMsg").textContent = "Bus details not found."; return; }
  if (!("geolocation" in navigator)) { $("tripMsg").textContent = "This device has no GPS."; return; }

  insideCount = 0; lastSent = 0;
  $("tripMsg").textContent = "";
  setUi(true);

  // If the driver's phone drops offline, mark the bus offline automatically.
  onDisconnect(ref(db, `live/${busId}/status`)).set("offline");

  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}

  watchId = navigator.geolocation.watchPosition(onFix, onGpsError, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 15000
  });
};

$("stopBtn").onclick = () => endTrip("manual");

async function onFix(pos) {
  const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  const dist = haversine(here, bus.destination);
  const kmh = pos.coords.speed != null ? pos.coords.speed * 3.6 : 0;

  $("distance").textContent = fmtDistance(dist);
  $("speed").textContent = `${Math.round(kmh)} km/h`;

  const now = Date.now();
  if (now - lastSent >= SEND_EVERY_MS) {
    lastSent = now;
    await set(ref(db, `live/${busId}`), {
      lat: here.lat, lng: here.lng,
      speed: pos.coords.speed ?? 0,
      heading: pos.coords.heading ?? 0,
      status: "active",
      ts: serverTimestamp()
    }).catch(e => ($("tripMsg").textContent = "Could not send location: " + e.message));
  }

  // Geofence: auto-end after several consecutive fixes inside the radius.
  insideCount = dist <= (bus.radius || 100) ? insideCount + 1 : 0;
  if (insideCount >= ARRIVE_FIXES) {
    await endTrip("arrived");
    $("tripMsg").textContent = `Trip ended automatically. You reached ${bus.destination.name}.`;
  }
}

function onGpsError(err) {
  $("tripMsg").textContent = err.code === 1
    ? "Location permission denied. Allow location for this site and try again."
    : "Waiting for a GPS signal…";
}

async function endTrip(reason) {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  try { await wakeLock?.release(); } catch {}
  if (busId) {
    await onDisconnect(ref(db, `live/${busId}/status`)).cancel().catch(() => {});
    await update(ref(db, `live/${busId}`), { status: "ended", reason, ts: serverTimestamp() }).catch(() => {});
  }
  setUi(false);
}

function setUi(active) {
  $("startBtn").classList.toggle("hidden", active);
  $("stopBtn").classList.toggle("hidden", !active);
  $("busSelect").disabled = active;
  const s = $("status");
  s.textContent = active ? "Sharing location" : "Not started";
  s.className = "chip" + (active ? " live" : "");
  if (!active) { $("distance").textContent = "—"; $("speed").textContent = "—"; }
}

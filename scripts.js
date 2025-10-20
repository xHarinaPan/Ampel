// ===============================
// 🔹 Configuración Firebase (REST)
// ===============================
const RTDB_BASE = "https://amepl-c993c-default-rtdb.firebaseio.com";
const DB_PATH = "semaforos";
const DB_URL = `${RTDB_BASE}/${DB_PATH}`;

// ===============================
// 🔹 Variables Globales
// ===============================
let map, userMarker, userCircle;
let semaphoreMarkers = {}, semaphoreIntervals = {};
let semaphores = [];
const COLOR_SEQUENCE = ["GREEN", "YELLOW", "RED"];
const COLOR_MAP = { GREEN: "color-green", YELLOW: "color-yellow", RED: "color-red" };
const USER_LOCATION_KEY = "userLocation";
const SEMAPHORES_KEY = "semaphores_local";

// ===============================
// 🔹 Funciones de Firebase (REST API)
// ===============================
async function fetchSemaphoresFirebase() {
  try {
    const res = await fetch(`${DB_URL}.json`);
    if (!res.ok) throw new Error("Error Firebase: " + res.status);
    const data = await res.json();
    if (!data) return [];
    return Object.entries(data).map(([id, val]) => ({ id, ...val }));
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function addSemaphoreFirebase(sem) {
  const res = await fetch(`${DB_URL}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sem)
  });
  const data = await res.json();
  sem.id = data.name;
  return sem;
}

async function updateSemaphoreFirebase(id, data) {
  await fetch(`${DB_URL}/${id}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

async function removeSemaphoreFirebase(id) {
  await fetch(`${DB_URL}/${id}.json`, { method: "DELETE" });
}

async function clearAllSemaphoresFirebase() {
  await fetch(`${DB_URL}.json`, { method: "DELETE" });
}

// ===============================
// 🔹 Local Storage
// ===============================
function saveSemaphoresLocal(arr) {
  localStorage.setItem(SEMAPHORES_KEY, JSON.stringify(arr));
}
function loadSemaphoresLocal() {
  return JSON.parse(localStorage.getItem(SEMAPHORES_KEY) || "[]");
}

// ===============================
// 🔹 MAPA Y GEOLOCALIZACIÓN
// ===============================
function initMap() {
  map = L.map("map").setView([40.4168, -3.7038], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  loadInitialLocation();
  loadSemaphores();
}

function loadInitialLocation() {
  const stored = localStorage.getItem(USER_LOCATION_KEY);
  if (stored) {
    const { lat, lng } = JSON.parse(stored);
    map.setView([lat, lng], 16);
    startUserTracking();
  } else {
    getUserLocation(true);
  }
}

function getUserLocation(save) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (save) {
          localStorage.setItem(USER_LOCATION_KEY, JSON.stringify({ lat, lng }));
          map.setView([lat, lng], 16);
          startUserTracking();
        }
      },
      err => console.error(err),
      { enableHighAccuracy: true, timeout: 5000, maxAge: 0 }
    );
  }
}

let currentWatchId = null;
function startUserTracking() {
  if (currentWatchId) navigator.geolocation.clearWatch(currentWatchId);
  currentWatchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
    const latlng = [lat, lng];
    if (!userMarker) {
      userMarker = L.marker(latlng).addTo(map).bindPopup("Tu posición");
      userCircle = L.circle(latlng, { radius: acc, color: "blue", fillOpacity: 0.2 }).addTo(map);
    } else {
      userMarker.setLatLng(latlng);
      userCircle.setLatLng(latlng).setRadius(acc);
    }
  });
}

// ===============================
// 🔹 CRUD SEMÁFOROS
// ===============================
async function loadSemaphores() {
  semaphores = loadSemaphoresLocal();
  renderAllSemaphores();

  const remote = await fetchSemaphoresFirebase();
  if (remote.length > 0) {
    semaphores = remote;
    saveSemaphoresLocal(semaphores);
    renderAllSemaphores();
  }
}

async function addSemaphore() {
  if (!map) return alert("El mapa aún no ha cargado.");

  const name = document.getElementById("sem-name").value.trim();
  const startColor = document.getElementById("sem-start-color").value;
  const timeGreen = parseInt(document.getElementById("sem-time-green").value, 10);
  const timeYellow = parseInt(document.getElementById("sem-time-yellow").value, 10);
  const timeRed = parseInt(document.getElementById("sem-time-red").value, 10);

  if (!name) return alert("Ingrese un nombre válido.");

  const center = map.getCenter();
  let newS = {
    name,
    lat: center.lat,
    lng: center.lng,
    times: { GREEN: timeGreen, YELLOW: timeYellow, RED: timeRed },
    currentColor: startColor,
    currentTime:
      startColor === "GREEN" ? timeGreen : startColor === "YELLOW" ? timeYellow : timeRed
  };

  newS = await addSemaphoreFirebase(newS);
  semaphores.push(newS);
  saveSemaphoresLocal(semaphores);
  renderAllSemaphores();
}

async function removeSemaphore(id) {
  if (!confirm("¿Eliminar este semáforo?")) return;
  await removeSemaphoreFirebase(id);
  semaphores = semaphores.filter(s => s.id !== id);
  saveSemaphoresLocal(semaphores);
  renderAllSemaphores();
}

async function clearAllSemaphores() {
  if (!confirm("¿Eliminar todos los semáforos?")) return;
  await clearAllSemaphoresFirebase();
  semaphores = [];
  saveSemaphoresLocal(semaphores);
  renderAllSemaphores();
}

// ===============================
// 🔹 INTERFAZ (MAPA + LISTA)
// ===============================
function renderAllSemaphores() {
  Object.values(semaphoreMarkers).forEach(m => m.remove());
  Object.values(semaphoreIntervals).forEach(clearInterval);
  semaphoreMarkers = {};
  semaphoreIntervals = {};

  const list = document.getElementById("semaphore-list");
  list.innerHTML = "";

  semaphores.forEach(s => {
    createSemaphoreMarker(s);
    addSemaphoreToSidebar(s);
    startTrafficLightCycle(s);
  });
}

function createSemaphoreMarker(sem) {
  const iconHtml = `<div id="sem-icon-${sem.id}" class="semaphore-icon ${COLOR_MAP[sem.currentColor]}"></div>`;
  const marker = L.marker([sem.lat, sem.lng], {
    icon: L.divIcon({ className: "custom-div-icon", html: iconHtml, iconSize: [14, 14] }),
    draggable: true
  })
    .addTo(map)
    .bindPopup(`<b>${sem.name}</b><br>Color: ${sem.currentColor}<br>Tiempo: ${sem.currentTime}s`);

  marker.on("dragend", e => {
    const pos = e.target.getLatLng();
    sem.lat = pos.lat;
    sem.lng = pos.lng;
    updateSemaphoreFirebase(sem.id, { lat: pos.lat, lng: pos.lng });
    saveSemaphoresLocal(semaphores);
  });

  semaphoreMarkers[sem.id] = marker;
}

function addSemaphoreToSidebar(sem) {
  const list = document.getElementById("semaphore-list");
  const li = document.createElement("li");
  li.className = "semaphore-item";
  li.innerHTML = `
    <div class="semaphore-header" onclick="toggleTimerConfig('${sem.id}')">
      <span>${sem.name}</span>
      <div class="color-status-group">
        <span id="list-time-${sem.id}">${sem.currentTime}s</span>
        <div id="list-color-${sem.id}" class="semaphore-color-indicator ${COLOR_MAP[sem.currentColor]}"></div>
      </div>
    </div>
    <div class="timer-config" id="timer-config-${sem.id}">
      <label>Verde:</label><input type="number" value="${sem.times.GREEN}" min="1" onchange="updateSemaphoreTime('${sem.id}','GREEN',this.value)">
      <label>Amarillo:</label><input type="number" value="${sem.times.YELLOW}" min="1" onchange="updateSemaphoreTime('${sem.id}','YELLOW',this.value)">
      <label>Rojo:</label><input type="number" value="${sem.times.RED}" min="1" onchange="updateSemaphoreTime('${sem.id}','RED',this.value)">
    </div>
    <div class="action-buttons"><button onclick="removeSemaphore('${sem.id}')">🗑️ Eliminar</button></div>
  `;
  list.appendChild(li);
}

function toggleTimerConfig(id) {
  const cfg = document.getElementById(`timer-config-${id}`);
  if (cfg) cfg.classList.toggle("open");
}

// ===============================
// 🔹 ACTUALIZACIONES
// ===============================
async function updateSemaphoreTime(id, color, value) {
  const sem = semaphores.find(s => s.id === id);
  if (!sem) return;
  const time = parseInt(value, 10);
  sem.times[color] = time;
  if (sem.currentColor === color) sem.currentTime = time;
  await updateSemaphoreFirebase(id, sem);
  saveSemaphoresLocal(semaphores);
  startTrafficLightCycle(sem);
}

// ===============================
// 🔹 CICLO SEMÁFORO
// ===============================
function startTrafficLightCycle(sem) {
  if (semaphoreIntervals[sem.id]) clearInterval(semaphoreIntervals[sem.id]);
  function step() {
    if (sem.currentTime > 1) sem.currentTime--;
    else {
      const next = COLOR_SEQUENCE[(COLOR_SEQUENCE.indexOf(sem.currentColor) + 1) % COLOR_SEQUENCE.length];
      sem.currentColor = next;
      sem.currentTime = sem.times[next];
    }
    updateSemaphoreUI(sem);
  }
  step();
  semaphoreIntervals[sem.id] = setInterval(step, 1000);
}

function updateSemaphoreUI(sem) {
  const colorClass = COLOR_MAP[sem.currentColor];
  const icon = document.getElementById(`sem-icon-${sem.id}`);
  if (icon) icon.className = `semaphore-icon ${colorClass}`;
  const listColor = document.getElementById(`list-color-${sem.id}`);
  if (listColor) listColor.className = `semaphore-color-indicator ${colorClass}`;
  const listTime = document.getElementById(`list-time-${sem.id}`);
  if (listTime) listTime.textContent = `${sem.currentTime}s`;
}

// ===============================
// 🔹 MENÚ DESPLEGABLE
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");
  toggleBtn.addEventListener("click", () => sidebar.classList.toggle("visible"));
  initMap();
});

// Exponer funciones globales
window.addSemaphore = addSemaphore;
window.removeSemaphore = removeSemaphore;
window.clearAllSemaphores = clearAllSemaphores;
window.updateSemaphoreTime = updateSemaphoreTime;
window.toggleTimerConfig = toggleTimerConfig;

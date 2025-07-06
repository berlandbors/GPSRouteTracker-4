// === Глобальные переменные ===
let map;
let segments = [];
let currentSegment = [];
let routeLines = [];
let liveMarker = null;
let startMarker = null;
let finishMarker = null;
let tracking = false;
let watchId = null;
let startTime = null;
let timerInterval = null;
let smoothingBuffer = [];

let elevationChart = null;
let temperatureChart = null;
let speedChart = null;
let windChart = null;
let chartsInitialized = false;

// === On Load ===
window.onload = () => {
  map = L.map('map').setView([31.7683, 35.2137], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  checkGPSAccess();
  loadSavedRoute();
};

// === Проверка GPS ===
function checkGPSAccess() {
  if (!navigator.geolocation) {
    alert("Геолокация не поддерживается.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    () => console.log("✅ Геолокация доступна"),
    err => alert("⚠ Включите GPS: " + err.message),
    { enableHighAccuracy: true }
  );
}

// === Сглаживание координат ===
function smoothCoords(lat, lon) {
  smoothingBuffer.push({ lat, lon });
  if (smoothingBuffer.length > 3) smoothingBuffer.shift();
  const avgLat = smoothingBuffer.reduce((sum, p) => sum + p.lat, 0) / smoothingBuffer.length;
  const avgLon = smoothingBuffer.reduce((sum, p) => sum + p.lon, 0) / smoothingBuffer.length;
  return { lat: avgLat, lon: avgLon };
}

// === Старт/Стоп ===
function toggleTracking() {
  tracking = !tracking;
  document.getElementById("startBtn").textContent = tracking ? "⏸ Стоп" : "▶️ Старт";
  if (tracking) {
    startTime = new Date();
    startTimer();
    startTracking();
  } else {
    stopTracking();
    stopTimer();
    markFinish();
  }
}

// === Трекинг ===
function startTracking() {
  currentSegment = [];
  segments.push(currentSegment);
  const status = createStatusElement("⏳ Ожидание GPS...");

  watchId = navigator.geolocation.watchPosition(async pos => {
    const { latitude, longitude, accuracy, altitude, speed } = pos.coords;
    if (accuracy > 15) {
      status.textContent = `⚠️ Точность ${accuracy.toFixed(1)} м — ожидание...`;
      return;
    }
    status.remove();

    const coords = smoothCoords(latitude, longitude);
    const point = {
      lat: coords.lat,
      lon: coords.lon,
      alt: altitude ?? null,
      time: new Date().toISOString(),
      speed: speed != null ? Math.round(speed * 60) : null, // м/мин
      motion: speed == null ? "unknown" : (speed < 2 ? "walk" : "vehicle"),
      weather: await fetchWeather(coords.lat, coords.lon)
    };

    if (currentSegment.length === 0) {
      map.setView([coords.lat, coords.lon], 16);
      markStart(coords);
    }

    if (shouldAddPoint(coords)) {
      currentSegment.push(point);
      updateMap();
      drawAllCharts(); // динамическое обновление графиков
    }

    updateLiveMarker(coords, point);
    map.panTo([coords.lat, coords.lon]);
    updateMotionDisplay(point.motion);
    document.getElementById("currentAlt").textContent = point.alt !== null ? `Высота: ${Math.round(point.alt)} м` : "Высота: —";
  }, err => {
    status.remove();
    alert("Ошибка GPS: " + err.message);
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 5000
  });
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// === Обновление UI ===
function updateLiveMarker(coords, point) {
  const latlng = [coords.lat, coords.lon];
  const w = point.weather;
  const popupText = `
    📍 Вы здесь<br>
    Высота: ${point.alt !== null ? Math.round(point.alt) + ' м' : '—'}<br>
    Скорость: ${point.speed ?? '—'} м/мин<br>
    Темп: ${point.motion === "walk" ? "🚶" : "🚗"}<br>
    Температура: ${w?.temp ?? "—"}°C<br>
    Ветер: ${w?.wind ?? "—"} км/ч ${w?.dir ?? ""}
  `;
  if (!liveMarker) {
    liveMarker = L.circleMarker(latlng, {
      radius: 8,
      color: "red",
      fillColor: "#f03",
      fillOpacity: 0.8
    }).addTo(map).bindPopup(popupText).openPopup();
  } else {
    liveMarker.setLatLng(latlng).setPopupContent(popupText);
  }
}

function updateMotionDisplay(motion) {
  const icon = motion === "walk" ? "🚶" : motion === "vehicle" ? "🚗" : "❓";
  document.getElementById("motionType").textContent = `Режим: ${icon}`;
}

function startTimer() {
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function updateTimer() {
  const now = new Date();
  const elapsed = startTime ? new Date(now - startTime) : new Date(0);
  const h = String(elapsed.getUTCHours()).padStart(2, '0');
  const m = String(elapsed.getUTCMinutes()).padStart(2, '0');
  const s = String(elapsed.getUTCSeconds()).padStart(2, '0');
  document.getElementById("timer").textContent = `Время движения: ${h}:${m}:${s}`;
}

function shouldAddPoint(coords) {
  if (currentSegment.length === 0) return true;
  const last = currentSegment[currentSegment.length - 1];
  return haversine(last, coords) >= 0.003;
}

function updateMap() {
  routeLines.forEach(line => map.removeLayer(line));
  routeLines = [];

  segments.forEach((segment, i) => {
    const latlngs = segment.map(p => [p.lat, p.lon]);
    const color = `hsl(${i * 60 % 360}, 80%, 50%)`;
    const poly = L.polyline(latlngs, { color }).addTo(map);
    routeLines.push(poly);
  });

  const totalPoints = segments.reduce((sum, s) => sum + s.length, 0);
  document.getElementById("pointsCount").textContent = `Точек: ${totalPoints}`;
  document.getElementById("distance").textContent = `Дистанция: ${totalDistance().toFixed(2)} км`;
}

function markStart(coords) {
  if (startMarker) map.removeLayer(startMarker);
  startMarker = L.marker([coords.lat, coords.lon], {
    icon: L.divIcon({ className: 'start-icon', html: "🟢", iconSize: [20, 20] })
  }).addTo(map).bindPopup("🚩 Старт");
}

function markFinish() {
  const last = segments.flat().at(-1);
  if (!last) return;
  if (finishMarker) map.removeLayer(finishMarker);
  finishMarker = L.marker([last.lat, last.lon], {
    icon: L.divIcon({ className: 'finish-icon', html: "🔴", iconSize: [20, 20] })
  }).addTo(map).bindPopup("🏁 Финиш");
}

// === Расчёт расстояния ===
function haversine(p1, p2) {
  const R = 6371;
  const dLat = toRad(p2.lat - p1.lat);
  const dLon = toRad(p2.lon - p1.lon);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const toRad = deg => deg * Math.PI / 180;

function totalDistance() {
  let dist = 0;
  segments.forEach(seg => {
    for (let i = 0; i < seg.length - 1; i++) {
      dist += haversine(seg[i], seg[i + 1]);
    }
  });
  return dist;
}

// === Графики ===
function drawAllCharts() {
  const all = segments.flat();
  const labels = all.map((_, i) => `#${i + 1}`);

  const altitudes = all.map(p => p.alt ?? null);
  const temps = all.map(p => p.weather?.temp ?? null);
  const speeds = all.map(p => p.speed ?? null);
  const winds = all.map(p => p.weather?.wind ?? null);

  const drawChart = (id, label, data, color) => {
    const ctx = document.getElementById(id);
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          pointRadius: 1,
          fill: false,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }},
        scales: {
          x: { title: { display: true, text: "Точки" } },
          y: { title: { display: true, text: label } }
        }
      }
    });
    return chart;
  };

  if (elevationChart) elevationChart.destroy();
  if (temperatureChart) temperatureChart.destroy();
  if (speedChart) speedChart.destroy();
  if (windChart) windChart.destroy();

  elevationChart = drawChart("elevationChart", "Высота (м)", altitudes, "green");
  temperatureChart = drawChart("temperatureChart", "Температура (°C)", temps, "orange");
  speedChart = drawChart("speedChart", "Скорость (м/мин)", speeds, "blue");
  windChart = drawChart("windChart", "Скорость ветра (км/ч)", winds, "purple");
}

// === Погода ===
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const w = data.current;
    return {
      temp: Math.round(w.temperature_2m),
      wind: Math.round(w.wind_speed_10m),
      dir: degToDir(w.wind_direction_10m)
    };
  } catch {
    return null;
  }
}

function degToDir(deg) {
  const dirs = ["С", "С-В", "В", "Ю-В", "Ю", "Ю-З", "З", "С-З"];
  return dirs[Math.round(deg / 45) % 8];
}

// === Хранилище ===
function saveRoute() {
  const data = {
    name: `Маршрут от ${new Date().toLocaleString()}`,
    segments,
    totalTime: startTime ? new Date() - startTime : null
  };
  localStorage.setItem("lastRoute", JSON.stringify(data));
  alert("Маршрут сохранён!");
}

function loadSavedRoute() {
  const data = localStorage.getItem("lastRoute");
  if (!data) return;
  try {
    const parsed = JSON.parse(data);
    segments = parsed.segments || [];
    startTime = parsed.totalTime ? new Date(Date.now() - parsed.totalTime) : null;
    updateMap();
    markStart(segments[0][0]);
    markFinish();
    drawAllCharts();
  } catch {
    alert("Ошибка загрузки маршрута.");
  }
}

function exportRoute() {
  const data = {
    name: `Маршрут от ${new Date().toLocaleString()}`,
    segments,
    totalTime: startTime ? new Date() - startTime : null
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "route.json";
  a.click();
}

function importRoute() {
  const file = document.getElementById("importFile").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      segments = data.segments || [];
      startTime = data.totalTime ? new Date(Date.now() - data.totalTime) : null;
      updateMap();
      markStart(segments[0][0]);
      markFinish();
      drawAllCharts();
    } catch {
      alert("Ошибка чтения JSON.");
    }
  };
  reader.readAsText(file);
}

// === Очистка ===
function clearRoute() {
  stopTracking();
  stopTimer();
  segments = [];
  routeLines.forEach(line => map.removeLayer(line));
  if (liveMarker) map.removeLayer(liveMarker);
  if (startMarker) map.removeLayer(startMarker);
  if (finishMarker) map.removeLayer(finishMarker);
  routeLines = [];
  liveMarker = null;
  startMarker = null;
  finishMarker = null;

  document.getElementById("distance").textContent = "Дистанция: —";
  document.getElementById("pointsCount").textContent = "Точек: 0";
  document.getElementById("timer").textContent = "Время движения: 00:00:00";

  if (elevationChart) elevationChart.destroy();
  if (temperatureChart) temperatureChart.destroy();
  if (speedChart) speedChart.destroy();
  if (windChart) windChart.destroy();
}

// === Вспомогательное ===
function createStatusElement(text) {
  const div = document.createElement("div");
  div.id = "gps-status";
  div.textContent = text;
  document.body.appendChild(div);
  return div;
}
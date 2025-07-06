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

let elevationChart, temperatureChart, speedChart;
let chartInitialized = false;

window.onload = () => {
  map = L.map('map').setView([31.7683, 35.2137], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
  checkGPSAccess();
  loadSavedRoute();
};

function checkGPSAccess() {
  if (!navigator.geolocation) return alert("Геолокация не поддерживается.");
  navigator.geolocation.getCurrentPosition(
    () => console.log("✅ Геолокация доступна"),
    err => alert("⚠ Включите GPS: " + err.message),
    { enableHighAccuracy: true }
  );
}

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

function smoothCoords(lat, lon) {
  smoothingBuffer.push({ lat, lon });
  if (smoothingBuffer.length > 3) smoothingBuffer.shift();
  const avgLat = smoothingBuffer.reduce((sum, p) => sum + p.lat, 0) / smoothingBuffer.length;
  const avgLon = smoothingBuffer.reduce((sum, p) => sum + p.lon, 0) / smoothingBuffer.length;
  return { lat: avgLat, lon: avgLon };
}

function startTracking() {
  currentSegment = [];
  segments.push(currentSegment);
  const status = createStatusElement("⏳ Ожидание GPS...");

  watchId = navigator.geolocation.watchPosition(async pos => {
    const { latitude, longitude, accuracy, altitude, speed } = pos.coords;
    if (accuracy > 20) {
      status.textContent = `⚠️ Плохая точность (${accuracy.toFixed(1)}м)...`;
      return;
    }
    status.remove();

    const coords = smoothCoords(latitude, longitude);
    const now = new Date();
    const motion = speed == null ? "unknown" : (speed < 2 ? "walk" : "vehicle");

    const weather = await fetchWeather(coords.lat, coords.lon);

    const point = {
      lat: coords.lat,
      lon: coords.lon,
      alt: altitude ?? null,
      time: now.toISOString(),
      speed: speed ? +(speed * 60).toFixed(1) : null, // м/мин
      motion,
      weather
    };

    if (currentSegment.length === 0) {
      map.setView([coords.lat, coords.lon], 16);
      markStart(coords);
    }

    if (shouldAddPoint(coords)) {
      currentSegment.push(point);
      updateMap();
      drawCharts(); // обновление графиков
    }

    updateLiveMarker(coords, point);
    updateMotionDisplay(motion);
    updateWeatherInfo(weather);
    document.getElementById("currentAlt").textContent = point.alt ? `Высота: ${Math.round(point.alt)} м` : "Высота: —";
    map.panTo([coords.lat, coords.lon]);
  }, err => {
    status.remove();
    alert("Ошибка GPS: " + err.message);
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
}

function fetchWeather(lat, lon) {
  return fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
    .then(res => res.json())
    .then(data => {
      const w = data.current_weather;
      return {
        temp: w.temperature,
        wind: w.windspeed,
        dir: degToCompass(w.winddirection)
      };
    }).catch(() => null);
}

function degToCompass(deg) {
  const dirs = ['С', 'С-В', 'В', 'Ю-В', 'Ю', 'Ю-З', 'З', 'С-З'];
  return dirs[Math.round(deg / 45) % 8];
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function startTimer() {
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function updateTimer() {
  if (!startTime) return;
  const elapsed = new Date(new Date() - startTime);
  const h = String(elapsed.getUTCHours()).padStart(2, '0');
  const m = String(elapsed.getUTCMinutes()).padStart(2, '0');
  const s = String(elapsed.getUTCSeconds()).padStart(2, '0');
  document.getElementById("timer").textContent = `Время движения: ${h}:${m}:${s}`;
}

function updateLiveMarker(coords, point) {
  const popup = `📍 Вы здесь<br>Высота: ${point.alt ? Math.round(point.alt) + ' м' : '—'}<br>Скорость: ${point.speed ?? '—'} м/мин`;
  if (!liveMarker) {
    liveMarker = L.circleMarker([coords.lat, coords.lon], {
      radius: 8, color: "red", fillColor: "#f03", fillOpacity: 0.8
    }).addTo(map).bindPopup(popup).openPopup();
  } else {
    liveMarker.setLatLng([coords.lat, coords.lon]).setPopupContent(popup);
  }
}

function updateMotionDisplay(motion) {
  const icon = motion === "walk" ? "🚶" : motion === "vehicle" ? "🚗" : "❓";
  document.getElementById("motionType").textContent = `Режим: ${icon}`;
}

function updateWeatherInfo(w) {
  if (!w) return;
  document.getElementById("weatherInfo").textContent =
    `Погода: ${w.temp}°C, ветер ${w.wind} км/ч (${w.dir})`;
}

function shouldAddPoint(coords) {
  if (currentSegment.length === 0) return true;
  const last = currentSegment[currentSegment.length - 1];
  return haversine(last, coords) >= 0.003;
}

function haversine(p1, p2) {
  const R = 6371;
  const dLat = toRad(p2.lat - p1.lat);
  const dLon = toRad(p2.lon - p1.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return deg * Math.PI / 180;
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

function updateMap() {
  routeLines.forEach(line => map.removeLayer(line));
  routeLines = [];

  segments.forEach((seg, i) => {
    const latlngs = seg.map(p => [p.lat, p.lon]);
    const color = `hsl(${i * 60}, 70%, 50%)`;
    routeLines.push(L.polyline(latlngs, { color }).addTo(map));
  });

  const points = segments.reduce((sum, s) => sum + s.length, 0);
  document.getElementById("pointsCount").textContent = `Точек: ${points}`;
  document.getElementById("distance").textContent = `Дистанция: ${totalDistance().toFixed(2)} км`;
}

function totalDistance() {
  let dist = 0;
  segments.forEach(seg => {
    for (let i = 0; i < seg.length - 1; i++) {
      dist += haversine(seg[i], seg[i + 1]);
    }
  });
  return dist;
}

function clearRoute() {
  stopTracking(); stopTimer();
  segments = []; currentSegment = []; smoothingBuffer = [];

  [liveMarker, startMarker, finishMarker, ...routeLines].forEach(marker => marker && map.removeLayer(marker));
  liveMarker = startMarker = finishMarker = null;
  routeLines = [];

  document.getElementById("distance").textContent = "Дистанция: —";
  document.getElementById("pointsCount").textContent = "Точек: 0";
  document.getElementById("timer").textContent = "Время движения: 00:00:00";
  document.getElementById("weatherInfo").textContent = "Погода: —";

  [elevationChart, temperatureChart, speedChart].forEach(chart => chart?.destroy());
}

function saveRoute() {
  localStorage.setItem("lastRoute", JSON.stringify({
    name: `Маршрут от ${new Date().toLocaleString()}`,
    segments,
    totalTime: new Date() - startTime
  }));
  alert("Маршрут сохранён!");
}

function loadSavedRoute() {
  const data = localStorage.getItem("lastRoute");
  if (!data) return;
  const parsed = JSON.parse(data);
  segments = parsed.segments ?? [];
  updateMap();
  drawCharts();
  if (segments.length) {
    markStart(segments[0][0]);
    markFinish();
  }
}

function exportRoute() {
  if (!segments.length) return alert("Маршрут пуст.");
  const blob = new Blob([JSON.stringify({
    name: `Маршрут от ${new Date().toLocaleString()}`,
    segments,
    totalTime: new Date() - startTime
  }, null, 2)], { type: "application/json" });
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
      segments = data.segments ?? [];
      updateMap();
      drawCharts();
      if (segments.length) {
        markStart(segments[0][0]);
        markFinish();
      }
      if (data.totalTime) {
        const elapsed = new Date(data.totalTime);
        const h = String(elapsed.getUTCHours()).padStart(2, '0');
        const m = String(elapsed.getUTCMinutes()).padStart(2, '0');
        const s = String(elapsed.getUTCSeconds()).padStart(2, '0');
        document.getElementById("timer").textContent = `Время движения: ${h}:${m}:${s}`;
      }
    } catch {
      alert("Ошибка чтения файла.");
    }
  };
  reader.readAsText(file);
}

function createStatusElement(text) {
  const div = document.createElement("div");
  div.id = "gps-status";
  div.textContent = text;
  document.body.appendChild(div);
  return div;
}

function drawCharts() {
  const points = segments.flat();

  const labels = points.map((_, i) => `Точка ${i + 1}`);
  const alts = points.map(p => p.alt ?? null);
  const temps = points.map(p => p.weather?.temp ?? null);
  const speeds = points.map(p => p.speed ?? null);

  const makeChart = (id, label, data, color) => {
    const ctx = document.getElementById(id).getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{ label, data, borderColor: color, tension: 0.3, pointRadius: 2 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Точки' } },
          y: { title: { display: true, text: label } }
        }
      }
    });
    return chart;
  };

  elevationChart?.destroy();
  temperatureChart?.destroy();
  speedChart?.destroy();

  elevationChart = makeChart('elevationChart', 'Высота (м)', alts, 'green');
  temperatureChart = makeChart('temperatureChart', 'Температура (°C)', temps, 'orange');
  speedChart = makeChart('speedChart', 'Скорость (м/мин)', speeds, 'blue');
}
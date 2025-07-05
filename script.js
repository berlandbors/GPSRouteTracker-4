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

function startTracking() {
  currentSegment = [];
  segments.push(currentSegment);
  const status = createStatusElement("⏳ Ожидание GPS...");

  watchId = navigator.geolocation.watchPosition(async pos => {
    const { latitude, longitude, accuracy, altitude, speed } = pos.coords;
    if (accuracy > 15) {
      status.textContent = `⚠️ Точность плохая (${accuracy.toFixed(1)} м), ждём...`;
      return;
    }
    status.remove();
    const coords = smoothCoords(latitude, longitude);
    const now = new Date();
    const motion = speed == null ? "unknown" : (speed < 2 ? "walk" : "vehicle");

    const weather = await getWeather(coords.lat, coords.lon);

    const point = {
      lat: coords.lat,
      lon: coords.lon,
      alt: altitude ?? null,
      time: now.toISOString(),
      speed: speed ?? null,
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
    }
    updateLiveMarker(coords, point);
    map.panTo([coords.lat, coords.lon]);
    updateMotionDisplay(motion);
    updateWeatherDisplay(point);
  }, err => {
    status.remove();
    alert("Ошибка GPS: " + err.message);
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 5000
  });
}

function getWeather(lat, lon) {
  return fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
    .then(res => res.json())
    .then(data => {
      const w = data.current_weather;
      const windDir = degreesToCardinal(w.winddirection);
      return {
        temp: w.temperature,
        windSpeed: w.windspeed,
        windDir
      };
    })
    .catch(() => null);
}

function degreesToCardinal(deg) {
  const dirs = ['С', 'С-В', 'В', 'Ю-В', 'Ю', 'Ю-З', 'З', 'С-З'];
  return dirs[Math.round(deg / 45) % 8];
}

function smoothCoords(lat, lon) {
  smoothingBuffer.push({ lat, lon });
  if (smoothingBuffer.length > 3) smoothingBuffer.shift();
  const avgLat = smoothingBuffer.reduce((sum, p) => sum + p.lat, 0) / smoothingBuffer.length;
  const avgLon = smoothingBuffer.reduce((sum, p) => sum + p.lon, 0) / smoothingBuffer.length;
  return { lat: avgLat, lon: avgLon };
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
  const now = new Date();
  const elapsed = new Date(now - startTime);
  const hours = String(elapsed.getUTCHours()).padStart(2, '0');
  const mins = String(elapsed.getUTCMinutes()).padStart(2, '0');
  const secs = String(elapsed.getUTCSeconds()).padStart(2, '0');
  document.getElementById("timer").textContent = `Время движения: ${hours}:${mins}:${secs}`;
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

function updateLiveMarker(coords, point) {
  const label = `
    📍 Вы здесь<br>
    Высота: ${point.alt ? Math.round(point.alt) + ' м' : '—'}<br>
    Скорость: ${point.speed ? (point.speed * 60).toFixed(1) + ' м/мин' : '—'}<br>
    Ветер: ${point.weather?.windDir ?? '—'}, ${point.weather?.windSpeed ?? '—'} м/с<br>
    Темп: ${point.weather?.temp ?? '—'}°C
  `;
  if (!liveMarker) {
    liveMarker = L.circleMarker([coords.lat, coords.lon], {
      radius: 8,
      color: "red",
      fillColor: "#f03",
      fillOpacity: 0.8
    }).addTo(map).bindPopup(label).openPopup();
  } else {
    liveMarker.setLatLng([coords.lat, coords.lon]).setPopupContent(label);
  }
}

function updateMotionDisplay(motion) {
  const icon = motion === "walk" ? "🚶" : motion === "vehicle" ? "🚗" : "❓";
  document.getElementById("motionType").textContent = `Режим: ${icon}`;
}

function updateWeatherDisplay(point) {
  const weather = point.weather;
  if (!weather) return;
  document.getElementById("currentAlt").textContent = point.alt !== null ? `Высота: ${Math.round(point.alt)} м` : "Высота: —";
  document.getElementById("weatherInfo").textContent =
    `Темп: ${weather.temp}°C, Ветер: ${weather.windDir} ${weather.windSpeed} м/с`;
}

function markStart(coords) {
  if (startMarker) map.removeLayer(startMarker);
  startMarker = L.marker([coords.lat, coords.lon], {
    title: "Старт",
    icon: L.divIcon({ className: 'start-icon', html: "🟢", iconSize: [20, 20] })
  }).addTo(map).bindPopup("🚩 Старт");
}
function markFinish() {
  if (segments.length === 0) return;
  const lastSeg = segments[segments.length - 1];
  if (lastSeg.length === 0) return;
  const last = lastSeg[lastSeg.length - 1];
  if (finishMarker) map.removeLayer(finishMarker);
  finishMarker = L.marker([last.lat, last.lon], {
    title: "Финиш",
    icon: L.divIcon({ className: 'finish-icon', html: "🔴", iconSize: [20, 20] })
  }).addTo(map).bindPopup("🏁 Финиш");
}

function haversine(p1, p2) {
  const R = 6371;
  const dLat = toRad(p2.lat - p1.lat);
  const dLon = toRad(p2.lon - p1.lon);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function toRad(deg) {
  return deg * Math.PI / 180;
}
function totalDistance() {
  let dist = 0;
  segments.forEach(segment => {
    for (let i = 0; i < segment.length - 1; i++) {
      dist += haversine(segment[i], segment[i + 1]);
    }
  });
  return dist;
}

function fetchElevations() {
  const allPoints = segments.flat();
  const locations = allPoints.map(p => ({ latitude: p.lat, longitude: p.lon }));

  fetch("https://api.open-elevation.com/api/v1/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations })
  })
    .then(res => res.json())
    .then(data => {
      data.results.forEach((e, i) => {
        segments.flat()[i].alt = e.elevation;
      });
      alert(`Высота обновлена для ${data.results.length} точек.`);
      drawElevationChart();
    })
    .catch(err => {
      console.error(err);
      alert("Ошибка получения высот.");
    });
}

function drawElevationChart() {
  const allPoints = segments.flat().filter(p => p.alt !== null);
  if (allPoints.length === 0) {
    alert("Нет данных о высоте.");
    return;
  }

  const labels = allPoints.map((_, i) => `Точка ${i + 1}`);
  const altitudes = allPoints.map(p => Math.round(p.alt));

  const data = {
    labels,
    datasets: [{
      label: 'Высота (м)',
      data: altitudes,
      fill: false,
      borderColor: 'green',
      tension: 0.3,
      pointRadius: 2,
    }]
  };

  if (elevationChart) elevationChart.destroy();
  elevationChart = new Chart(document.getElementById('elevationChart'), {
    type: 'line',
    data,
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Точки' } },
        y: { title: { display: true, text: 'Высота (м)' } }
      }
    }
  });
}

function drawTemperatureChart() {
  const allPoints = segments.flat().filter(p => p.weather?.temp !== undefined);
  if (allPoints.length === 0) return alert("Нет данных о температуре.");

  const labels = allPoints.map((_, i) => `Точка ${i + 1}`);
  const temps = allPoints.map(p => p.weather.temp);

  if (temperatureChart) temperatureChart.destroy();
  temperatureChart = new Chart(document.getElementById('temperatureChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Температура (°C)',
        data: temps,
        borderColor: 'red',
        tension: 0.4,
        pointRadius: 2,
        fill: false
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Точки' } },
        y: { title: { display: true, text: 'Температура (°C)' } }
      }
    }
  });
}

function saveRoute() {
  const data = {
    name: `Маршрут от ${new Date().toLocaleString()}`,
    distance: totalDistance(),
    segments
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
    updateMap();
    if (segments.length > 0) {
      const first = segments[0][0];
      const last = segments[segments.length - 1].slice(-1)[0];
      markStart(first);
      markFinish(last);
    }
  } catch (e) {
    console.warn("Ошибка загрузки маршрута.");
  }
}

function exportRoute() {
  if (segments.length === 0) return alert("Маршрут пуст.");
  const data = {
    name: `Маршрут от ${new Date().toLocaleString()}`,
    distance: totalDistance(),
    segments
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
      updateMap();
      if (segments.length > 0) {
        const first = segments[0][0];
        const last = segments[segments.length - 1].slice(-1)[0];
        markStart(first);
        markFinish(last);
      }
    } catch (err) {
      alert("Ошибка чтения JSON.");
    }
  };
  reader.readAsText(file);
}

function clearRoute() {
  stopTracking();
  stopTimer();
  segments = [];
  routeLines.forEach(line => map.removeLayer(line));
  routeLines = [];
  if (liveMarker) map.removeLayer(liveMarker);
  if (startMarker) map.removeLayer(startMarker);
  if (finishMarker) map.removeLayer(finishMarker);
  liveMarker = null;
  startMarker = null;
  finishMarker = null;
  document.getElementById("distance").textContent = "Дистанция: —";
  document.getElementById("pointsCount").textContent = "Точек: 0";
  document.getElementById("timer").textContent = "Время движения: 00:00:00";
  document.getElementById("currentAlt").textContent = "Высота: —";
  document.getElementById("weatherInfo").textContent = "Погода: —";
  if (elevationChart) elevationChart.destroy();
  if (temperatureChart) temperatureChart.destroy();
}
function createStatusElement(text) {
  const div = document.createElement("div");
  div.id = "gps-status";
  div.textContent = text;
  document.body.appendChild(div);
  return div;
}
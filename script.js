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
let elevationChart = null;
let temperatureChart = null;
let speedChart = null;
let chartInitialized = false;
let currentWeather = null;

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
    if (accuracy > 25) {
      status.textContent = `⚠️ Плохая точность: ${accuracy.toFixed(1)} м`;
      return;
    }

    status.remove();

    const now = new Date();
    const coords = { lat: latitude, lon: longitude };
    const motion = speed == null ? "unknown" : (speed < 2 ? "walk" : "vehicle");

    if (!currentWeather) {
      currentWeather = await fetchWeather(latitude, longitude);
      updateWeatherDisplay(currentWeather);
    }

    const point = {
      ...coords,
      alt: altitude ?? null,
      speed: speed ?? null,
      speedMpm: speed != null ? Math.round(speed * 60) : null,
      time: now.toISOString(),
      motion,
      weather: currentWeather
    };

    if (currentSegment.length === 0) {
      map.setView([latitude, longitude], 16);
      markStart(coords);
    }

    if (shouldAddPoint(coords)) {
      currentSegment.push(point);
      updateMap();
      updateSpeedChart();
    }

    updateLiveMarker(coords, point);
    updateMotionDisplay(motion);
    document.getElementById("currentAlt").textContent = point.alt !== null ? `Высота: ${Math.round(point.alt)} м` : "Высота: —";

  }, err => {
    status.remove();
    alert("Ошибка GPS: " + err.message);
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function updateLiveMarker(coords, point) {
  const latlng = [coords.lat, coords.lon];
  let popup = `📍 Вы здесь<br>`;
  if (point.alt != null) popup += `Высота: ${Math.round(point.alt)} м<br>`;
  if (point.speed != null) popup += `Скорость: ${Math.round(point.speed * 60)} м/мин<br>`;
  if (point.weather) {
    popup += `🌡 ${point.weather.temp}°C<br>`;
    popup += `🌬 ${point.weather.windDir}, ${point.weather.windSpeed} м/c`;
  }

  if (!liveMarker) {
    liveMarker = L.circleMarker(latlng, {
      radius: 8,
      color: "red",
      fillColor: "#f03",
      fillOpacity: 0.8
    }).addTo(map).bindPopup(popup).openPopup();
  } else {
    liveMarker.setLatLng(latlng).setPopupContent(popup);
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
  const elapsed = new Date(now - startTime);
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
    const color = `hsl(${i * 45 % 360}, 80%, 50%)`;
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
  if (segments.length === 0) return;
  const lastSeg = segments[segments.length - 1];
  if (lastSeg.length === 0) return;
  const last = lastSeg[lastSeg.length - 1];
  if (finishMarker) map.removeLayer(finishMarker);
  finishMarker = L.marker([last.lat, last.lon], {
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

function exportRoute() {
  const data = {
    name: `Маршрут от ${new Date().toLocaleString()}`,
    distance: totalDistance(),
    duration: getTotalDuration(),
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
      drawSpeedChart();
      drawElevationChart();
      drawTemperatureChart();

      if (segments.length && segments[0].length) {
        markStart(segments[0][0]);
        const lastSeg = segments[segments.length - 1];
        markFinish(lastSeg[lastSeg.length - 1]);
      }

      document.getElementById("timer").textContent = "Время движения: " + (data.duration || "—");

    } catch (err) {
      alert("Ошибка при чтении маршрута.");
    }
  };
  reader.readAsText(file);
}

function getTotalDuration() {
  if (!startTime) return null;
  const elapsed = new Date(new Date() - startTime);
  const h = String(elapsed.getUTCHours()).padStart(2, '0');
  const m = String(elapsed.getUTCMinutes()).padStart(2, '0');
  const s = String(elapsed.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function updateSpeedChart() {
  const points = segments.flat().filter(p => p.speed != null);
  if (!points.length) return;

  const labels = points.map((_, i) => `#${i + 1}`);
  const speeds = points.map(p => p.speedMpm);

  if (speedChart) speedChart.destroy();

  speedChart = new Chart(document.getElementById("speedChart"), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Скорость (м/мин)',
        data: speeds,
        borderColor: 'orange',
        fill: false,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Точки' } },
        y: { title: { display: true, text: 'м/мин' } }
      }
    }
  });
}

function drawElevationChart() {
  // аналогично updateSpeedChart — если нужно, пришлю тоже
}

function drawTemperatureChart() {
  // аналогично updateSpeedChart — если нужно, пришлю тоже
}

async function fetchWeather(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    const data = await res.json();
    const w = data.current_weather;
    return {
      temp: w.temperature,
      windSpeed: w.windspeed,
      windDir: degToCompass(w.winddirection)
    };
  } catch {
    return null;
  }
}

function degToCompass(deg) {
  const dirs = ['С', 'С-СВ', 'СВ', 'В-СВ', 'В', 'В-ЮВ', 'ЮВ', 'Ю-ЮВ', 'Ю', 'Ю-ЮЗ', 'ЮЗ', 'З-ЮЗ', 'З', 'З-СЗ', 'СЗ', 'С-СЗ'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function updateWeatherDisplay(w) {
  if (!w) return;
  document.getElementById("weatherInfo").textContent = `🌡 ${w.temp}°C, 🌬 ${w.windDir}, ${w.windSpeed} м/с`;
}

function clearRoute() {
  stopTracking();
  stopTimer();
  segments = [];
  currentSegment = [];
  routeLines.forEach(l => map.removeLayer(l));
  routeLines = [];

  if (liveMarker) map.removeLayer(liveMarker);
  if (startMarker) map.removeLayer(startMarker);
  if (finishMarker) map.removeLayer(finishMarker);

  document.getElementById("pointsCount").textContent = "Точек: 0";
  document.getElementById("distance").textContent = "Дистанция: —";
  document.getElementById("timer").textContent = "Время движения: 00:00:00";
  document.getElementById("weatherInfo").textContent = "Погода: —";
  document.getElementById("currentAlt").textContent = "Высота: —";

  if (speedChart) speedChart.destroy();
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
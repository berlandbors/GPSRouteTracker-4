let map;
let segments = [];
let currentSegment = [];
let routeLines = [];
let weatherMarkers = [];
let liveMarker = null;
let startMarker = null;
let finishMarker = null;
let tracking = false;
let watchId = null;
let startTime = null;
let timerInterval = null;
let smoothingBuffer = [];
let elevationChart = null;
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

function smoothCoords(lat, lon) {
  smoothingBuffer.push({ lat, lon });
  if (smoothingBuffer.length > 3) smoothingBuffer.shift();
  const avgLat = smoothingBuffer.reduce((sum, p) => sum + p.lat, 0) / smoothingBuffer.length;
  const avgLon = smoothingBuffer.reduce((sum, p) => sum + p.lon, 0) / smoothingBuffer.length;
  return { lat: avgLat, lon: avgLon };
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
    const weather = await getPointWeather(coords.lat, coords.lon);

    const point = {
      lat: coords.lat,
      lon: coords.lon,
      alt: altitude ?? null,
      time: now.toTimeString().split(' ')[0],
      speed: speed ?? null,
      motion,
      temperature: weather?.temperature ?? null,
      weatherCode: weather?.weathercode ?? null
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
    document.getElementById("currentAlt").textContent =
      point.alt !== null ? `Высота: ${Math.round(point.alt)} м` : "Высота: —";
  }, err => {
    status.remove();
    alert("Ошибка GPS: " + err.message);
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30000
  });
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

async function getPointWeather(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    const data = await res.json();
    return data.current_weather;
  } catch (e) {
    console.warn("Погода не получена:", e);
    return null;
  }
}

function updateLiveMarker(coords, point) {
  const latlng = [coords.lat, coords.lon];
  const popupText = `
    📍 Вы здесь<br>
    ⏱ ${point.time}<br>
    🏔 ${point.alt !== null ? Math.round(point.alt) + ' м' : '—'}<br>
    📏 ${point.speed !== null ? (point.speed * 3.6).toFixed(1) + ' км/ч' : '—'}<br>
    🌡️ ${point.temperature !== null ? point.temperature + '°C' : '—'}<br>
    🌤 ${weatherIconFromCode(point.weatherCode)}
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
  weatherMarkers.forEach(m => map.removeLayer(m));
  weatherMarkers = [];

  segments.forEach((segment, i) => {
    const latlngs = segment.map(p => [p.lat, p.lon]);
    const color = `hsl(${i * 60 % 360}, 80%, 50%)`;
    const poly = L.polyline(latlngs, { color }).addTo(map);
    routeLines.push(poly);
  });

  const totalPoints = segments.reduce((sum, s) => sum + s.length, 0);
  document.getElementById("pointsCount").textContent = `Точек: ${totalPoints}`;
  document.getElementById("distance").textContent = `Дистанция: ${totalDistance().toFixed(2)} км`;

  addWeatherIcons();
}

function addWeatherIcons() {
  segments.forEach(segment => {
    segment.forEach(p => {
      if (p.weatherCode !== null && Math.random() < 0.1) {
        const icon = weatherIconFromCode(p.weatherCode);
        const marker = L.marker([p.lat, p.lon], {
          icon: L.divIcon({ className: 'weather-icon', html: icon, iconSize: [20, 20] })
        });
        marker.addTo(map);
        weatherMarkers.push(marker);
      }
    });
  });
}

function weatherIconFromCode(code) {
  if (code === null) return "❓";
  if (code < 3) return "☀️";
  if (code < 45) return "⛅";
  if (code < 61) return "🌧";
  if (code < 80) return "❄️";
  return "🌫";
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

function saveRoute() {
  const now = new Date();
  const duration = startTime ? {
    formatted: `${String(new Date(now - startTime).getUTCHours()).padStart(2, '0')}:${String(new Date(now - startTime).getUTCMinutes()).padStart(2, '0')}:${String(new Date(now - startTime).getUTCSeconds()).padStart(2, '0')}`
  } : null;

  const data = {
    name: `Маршрут от ${now.toLocaleString()}`,
    distance: totalDistance(),
    duration,
    segments
  };

  localStorage.setItem("lastRoute", JSON.stringify(data));
  alert("✅ Маршрут сохранён!");
}

function loadSavedRoute() {
  const data = localStorage.getItem("lastRoute");
  if (!data) return;

  try {
    const parsed = JSON.parse(data);
    segments = parsed.segments || [];
    updateMap();
    if (segments.length > 0 && segments[0].length > 0) {
      markStart(segments[0][0]);
      const lastSeg = segments[segments.length - 1];
      if (lastSeg.length > 0) markFinish(lastSeg[lastSeg.length - 1]);
    }
    if (parsed.duration?.formatted) {
      document.getElementById("timer").textContent = `Время движения: ${parsed.duration.formatted}`;
    }
  } catch (e) {
    console.warn("❌ Ошибка загрузки маршрута:", e);
  }
}

function exportRoute() {
  if (segments.length === 0) return alert("⚠️ Маршрут пуст.");

  const now = new Date();
  const data = {
    name: `Маршрут от ${now.toLocaleString()}`,
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
      if (segments.length > 0 && segments[0].length > 0) {
        markStart(segments[0][0]);
        const lastSeg = segments[segments.length - 1];
        if (lastSeg.length > 0) markFinish(lastSeg[lastSeg.length - 1]);
      }
    } catch (err) {
      alert("❌ Ошибка чтения JSON.");
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

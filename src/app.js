const RUNS_KEY = "strava_runs";
const ASSUMED_AGE = 30;
const HR_MAX = 220 - ASSUMED_AGE;
const HR_ZONE_COLORS = ["#3498DB", "#2ECC71", "#F39C12", "#E74C3C", "#9B59B6"];

let activities = [];
let processedRuns = [];
let accessToken = null;
let selectedDays = 30;
let selectedVolumePeriod = "week";
let heartRateZones = createFallbackHeartRateZones();
let charts = {};
let globe = null;
let currentSort = {
  key: "date",
  direction: "desc",
};

window.processedRuns = processedRuns;

const page = document.body.dataset.page;

if (page === "login") {
  initLoginPage();
}

if (page === "dashboard") {
  initDashboardPage();
}

async function initLoginPage() {
  const status = document.querySelector("#login-status");

  try {
    const session = await fetchJson("/api/me");

    if (session.authenticated) {
      window.location.href = "/dashboard.html";
      return;
    }

    status.textContent = "Liga a tua conta para comecar.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function initDashboardPage() {
  bindDashboardEvents();
  setDashboardStatus("A verificar sessao...");

  try {
    const session = await fetchJson("/api/me");

    if (!session.authenticated) {
      window.location.href = "/";
      return;
    }

    accessToken = session.accessToken;
    await loadHeartRateZones();
    await loadActivities();
  } catch (error) {
    setDashboardStatus(error.message);
  }
}

function bindDashboardEvents() {
  document.querySelector("#logout-button")?.addEventListener("click", () => {
    localStorage.removeItem(RUNS_KEY);
    window.location.href = "/api/logout";
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => showMainTab(button.dataset.tab));
  });

  document.querySelectorAll(".range-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDays = Number(button.dataset.days);
      document
        .querySelectorAll(".range-button")
        .forEach((item) => item.classList.toggle("is-active", item === button));
      renderDashboard();
    });
  });

  document.querySelectorAll(".volume-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedVolumePeriod = button.dataset.volume;
      document
        .querySelectorAll(".volume-button")
        .forEach((item) => item.classList.toggle("is-active", item === button));
      renderTrainingVolume(filterRunsByDays(processedRuns, selectedDays));
    });
  });

  document.querySelector("#history-filters")?.addEventListener("input", renderHistory);

  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      currentSort = {
        key,
        direction:
          currentSort.key === key && currentSort.direction === "asc"
            ? "desc"
            : "asc",
      };
      renderHistory();
    });
  });
}

async function loadHeartRateZones() {
  try {
    const zones = await fetchJson("/api/zones");
    heartRateZones = normalizeHeartRateZones(zones);
  } catch (error) {
    console.warn("A usar zonas de FC padrão:", error.message);
    heartRateZones = createFallbackHeartRateZones();
  }
}

async function loadActivities() {
  setDashboardStatus("A carregar corridas do Strava...");

  if (!accessToken) {
    throw new Error("Access token Strava em falta na sessao.");
  }

  const stravaActivities = await fetchJson("/api/activities");

  activities = stravaActivities.filter((activity) => activity.type === "Run");
  localStorage.setItem(RUNS_KEY, JSON.stringify(activities));
  updateProcessedRunsFromStorage();
  console.log("processedRuns", processedRuns);
  setDashboardStatus(`${processedRuns.length} corridas carregadas.`);
  renderDashboard();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Pedido falhou.");
  }

  return data;
}

function renderDashboard() {
  const filteredRuns = filterRunsByDays(processedRuns, selectedDays);
  updateKpis(filteredRuns);
  renderAnalysis(filteredRuns);
  renderHistory();
}

function showMainTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const isActive = panel.id === `${tabName}-panel`;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function renderAnalysis(runs) {
  renderRunHrZonesChart(runs);
  renderTrainingVolume(processedRuns);
  renderHrZoneTimeChart(processedRuns);
  renderTrainingGlobe(processedRuns);
  renderPersonalRecords(runs);
  renderLongRuns(runs);
}

function updateKpis(runs) {
  const totalDistance = sumDistance(runs);
  const averagePace = averagePaceForRuns(runs);
  const hrRuns = runs.filter((run) => run.avg_hr !== null);
  const averageHr =
    hrRuns.length === 0
      ? null
      : hrRuns.reduce((sum, run) => sum + Number(run.avg_hr), 0) / hrRuns.length;

  setText("#kpi-total-activities", runs.length);
  setText("#kpi-total-distance", totalDistance.toFixed(1));
  setText("#kpi-average-pace-speed", averagePace ? secondsToPace(averagePace) : "-");
  setText("#kpi-average-hr", averageHr ? Math.round(averageHr) : "-");
}

function renderRunHrZonesChart(runs) {
  const hrRuns = runs.filter((run) => run.avg_hr !== null);
  const zoneCounts = createZoneTotals(0);

  hrRuns.forEach((run) => {
    const zone = getHrZone(run.avg_hr);
    zoneCounts[zone.label] += 1;
  });

  const total = hrRuns.length || 1;
  charts.runHrZones = createChart("runHrZonesChart", charts.runHrZones, {
    type: "doughnut",
    data: {
      labels: Object.keys(zoneCounts),
      datasets: [
        {
          data: Object.values(zoneCounts).map((count) =>
            Number(((count / total) * 100).toFixed(1)),
          ),
          backgroundColor: getZoneColors(),
          borderColor: "#1E1E1E",
        },
      ],
    },
    options: chartOptions(),
  });
}

function renderHrZoneTimeChart(runs) {
  const zoneMinutes = createZoneTotals(0);

  runs
    .filter((run) => run.avg_hr !== null)
    .forEach((run) => {
      const zone = getHrZone(run.avg_hr);
      zoneMinutes[zone.label] += Number(run.duration_min || 0);
    });

  charts.hrZoneTime = createChart("runHrZoneTimeChart", charts.hrZoneTime, {
    type: "bar",
    data: {
      labels: Object.keys(zoneMinutes),
      datasets: [
        {
          label: "Minutos",
          data: Object.values(zoneMinutes).map((minutes) => Number(minutes.toFixed(0))),
          backgroundColor: getZoneColors(),
          borderColor: getZoneColors(),
        },
      ],
    },
    options: chartOptions({
      beginAtZero: true,
      indexAxis: "y",
    }),
  });
}

function renderTrainingVolume(runs) {
  const grouped = groupRunsByVolumePeriod(runs, selectedVolumePeriod);
  const visibleGroups =
    selectedVolumePeriod === "week" ? grouped.slice(-12) : grouped;
  const labelByPeriod = {
    week: "Km por semana",
    month: "Km por mês",
    year: "Km por ano",
  };

  charts.runWeeklyVolume = createChart(
    "runWeeklyVolumeChart",
    charts.runWeeklyVolume,
    {
      type: "bar",
      data: {
        labels: visibleGroups.map((item) =>
          formatVolumeAxisLabel(item.label, selectedVolumePeriod),
        ),
        datasets: [
          {
            label: labelByPeriod[selectedVolumePeriod],
            data: visibleGroups.map((item) => item.value),
            backgroundColor: "#FC4C02",
            borderColor: "#FC4C02",
          },
        ],
      },
      options: chartOptions({
        beginAtZero: true,
        xTickFontSize: 11,
        xTickRotation: 45,
        xMaxTicksLimit: 12,
      }),
    },
  );
}

function renderTrainingGlobe(runs) {
  const container = document.querySelector("#training-globe");

  if (!container) {
    return;
  }

  container.style.minHeight = "420px";

  if (!window.THREE) {
    container.textContent = "Globo indisponível. Verifica a ligação aos scripts 3D.";
    return;
  }

  if (!globe) {
    globe = createTrainingGlobe(container);
  }

  updateTrainingGlobePoints(globe, getGlobePoints(runs));
  resizeTrainingGlobe(globe, container);
}

function getGlobePoints(runs) {
  return runs
    .filter(
      (run) =>
        Array.isArray(run.start_latlng) &&
        run.start_latlng.length === 2 &&
        run.start_latlng.every((value) => typeof value === "number"),
    )
    .map((run) => ({
      lat: run.start_latlng[0],
      lng: run.start_latlng[1],
      date: run.date,
      distance: run.distance_km,
      pace: run.pace,
    }));
}

function createTrainingGlobe(container) {
  container.textContent = "";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const earthGroup = new THREE.Group();
  const pointsGroup = new THREE.Group();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x121212, 1);
  container.appendChild(renderer.domElement);

  camera.position.set(0, 0, 3.2);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({
      color: 0x1f5f85,
      emissive: 0x06131c,
      roughness: 0.72,
      metalness: 0.08,
    }),
  );

  const wireframe = new THREE.Mesh(
    new THREE.SphereGeometry(1.006, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0x4aa3c7,
      transparent: true,
      opacity: 0.13,
      wireframe: true,
    }),
  );

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.95);
  directionalLight.position.set(3, 2, 4);

  earthGroup.add(earth);
  earthGroup.add(wireframe);
  earthGroup.add(pointsGroup);
  scene.add(ambientLight);
  scene.add(directionalLight);
  scene.add(earthGroup);

  const nextGlobe = {
    camera,
    earthGroup,
    pointsGroup,
    renderer,
    scene,
  };

  window.addEventListener("resize", () => resizeTrainingGlobe(nextGlobe, container));
  resizeTrainingGlobe(nextGlobe, container);

  function animate() {
    nextGlobe.animationFrame = requestAnimationFrame(animate);
    scene.rotation.y += 0.0025;
    renderer.render(scene, camera);
  }

  animate();

  return nextGlobe;
}

function updateTrainingGlobePoints(currentGlobe, points) {
  currentGlobe.pointsGroup.clear();

  points.forEach((point) => {
    const marker = createTrainingPoint(point);
    currentGlobe.pointsGroup.add(marker);
  });
}

function createTrainingPoint(point) {
  const marker = new THREE.Group();
  const position = latLngToVector3(point.lat, point.lng, 1.035);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfc4c02 }),
  );
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xfc4c02,
      transparent: true,
      opacity: 0.22,
    }),
  );

  marker.position.copy(position);
  marker.add(glow);
  marker.add(dot);
  marker.userData = point;

  return marker;
}

function latLngToVector3(lat, lng, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function resizeTrainingGlobe(currentGlobe, container) {
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 420;

  currentGlobe.camera.aspect = width / height;
  currentGlobe.camera.updateProjectionMatrix();
  currentGlobe.renderer.setSize(width, height, false);
}

function renderPersonalRecords(runs) {
  const container = document.querySelector("#personal-records");
  const targets = [5, 10, 21, 42];

  if (!container) {
    return;
  }

  container.innerHTML = targets
    .map((target) => {
      const best = findBestTargetRun(runs, target);
      return `
        <div class="record-row">
          <span>${target} km</span>
          <strong>${best ? escapeHtml(best.pace) : "-"}</strong>
          <span>${best ? escapeHtml(best.date) : "-"}</span>
        </div>
      `;
    })
    .join("");
}

function renderLongRuns(runs) {
  const tbody = document.querySelector("#long-runs-body");

  if (!tbody) {
    return;
  }

  const longRuns = sortByDate(
    runs.filter((run) => Number(run.distance_km) > 15),
  ).reverse();
  tbody.innerHTML = "";

  if (longRuns.length === 0) {
    tbody.innerHTML =
      '<tr><td class="empty-row" colspan="4">Sem corridas acima de 15 km.</td></tr>';
    return;
  }

  longRuns.forEach((run) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(run.date)}</td>
      <td>${escapeHtml(run.distance_km)} km</td>
      <td>${escapeHtml(run.pace)}</td>
      <td>${run.avg_hr ?? "-"}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderHistory() {
  const tbody = document.querySelector("#history-table-body");

  if (!tbody) {
    return;
  }

  const runs = sortRuns(filterHistoryRuns(processedRuns));
  tbody.innerHTML = "";

  if (runs.length === 0) {
    tbody.innerHTML =
      '<tr><td class="empty-row" colspan="5">Sem corridas para os filtros selecionados.</td></tr>';
    return;
  }

  runs.forEach((run) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(run.date)}</td>
      <td>${escapeHtml(run.distance_km)}</td>
      <td>${escapeHtml(run.pace)}</td>
      <td>${run.avg_hr ?? "-"}</td>
      <td>${escapeHtml(run.duration_min)} min</td>
    `;
    tbody.appendChild(row);
  });
}

function filterHistoryRuns(runs) {
  const startDate = getInputValue("#filter-start-date");
  const endDate = getInputValue("#filter-end-date");
  const minDistance = parseNumberInput("#filter-min-distance");
  const maxDistance = parseNumberInput("#filter-max-distance");
  const minPace = paceInputToSeconds("#filter-min-pace");
  const maxPace = paceInputToSeconds("#filter-max-pace");

  return runs.filter((run) => {
    const distance = Number(run.distance_km);
    const paceSeconds = paceToSeconds(run.pace);

    return (
      (!startDate || run.date >= startDate) &&
      (!endDate || run.date <= endDate) &&
      (minDistance === null || distance >= minDistance) &&
      (maxDistance === null || distance <= maxDistance) &&
      (minPace === null || paceSeconds >= minPace) &&
      (maxPace === null || paceSeconds <= maxPace)
    );
  });
}

function sortRuns(runs) {
  return [...runs].sort((first, second) => {
    const firstValue = sortValue(first, currentSort.key);
    const secondValue = sortValue(second, currentSort.key);
    const direction = currentSort.direction === "asc" ? 1 : -1;

    if (firstValue > secondValue) {
      return direction;
    }

    if (firstValue < secondValue) {
      return -direction;
    }

    return 0;
  });
}

function sortValue(run, key) {
  if (key === "pace") {
    return paceToSeconds(run.pace);
  }

  if (key === "date") {
    return run.date;
  }

  return Number(run[key] ?? -1);
}

function createChart(canvasId, currentChart, config) {
  if (!window.Chart) {
    return null;
  }

  const canvas = document.querySelector(`#${canvasId}`);

  if (!canvas) {
    return null;
  }

  if (currentChart) {
    currentChart.destroy();
  }

  return new Chart(canvas, config);
}

function chartOptions({
  beginAtZero = false,
  indexAxis = "x",
  xMaxTicksLimit,
  xTickFontSize,
  xTickRotation,
} = {}) {
  return {
    indexAxis,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#ffffff",
          boxWidth: 12,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: indexAxis === "y" ? beginAtZero : undefined,
        ticks: {
          color: "#a7a7a7",
          font: {
            size: xTickFontSize,
          },
          maxRotation: xTickRotation,
          minRotation: xTickRotation,
          maxTicksLimit: xMaxTicksLimit,
        },
        grid: {
          display: false,
        },
      },
      y: {
        beginAtZero: indexAxis === "x" ? beginAtZero : undefined,
        ticks: {
          color: "#a7a7a7",
        },
        grid: {
          display: false,
        },
      },
    },
  };
}

function filterRunsByDays(runs, days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days + 1);

  return runs.filter((run) => new Date(`${run.date}T00:00:00`) >= cutoff);
}

function loadStoredRuns() {
  const savedRuns = localStorage.getItem(RUNS_KEY);
  return savedRuns ? JSON.parse(savedRuns) : [];
}

function updateProcessedRunsFromStorage() {
  processedRuns = processRuns(loadStoredRuns());
  window.processedRuns = processedRuns;
}

function processRuns(runs) {
  return runs.map((run) => ({
    type: run.type,
    date: (run.start_date_local || run.start_date || "").slice(0, 10),
    distance_km: (Number(run.distance || 0) / 1000).toFixed(2),
    pace: formatPace(run.elapsed_time, run.distance),
    avg_hr: run.average_heartrate ?? null,
    max_hr: run.max_heartrate ?? null,
    duration_min: (Number(run.moving_time || 0) / 60).toFixed(0),
    start_latlng: run.start_latlng ?? null,
  }));
}

function normalizeHeartRateZones(zonesResponse) {
  const heartRate = zonesResponse?.heart_rate;
  const zones = heartRate?.zones;

  if (heartRate?.custom_zones === false || !Array.isArray(zones) || zones.length === 0) {
    return createFallbackHeartRateZones();
  }

  const normalized = zones
    .map((zone, index) => ({
      index: index + 1,
      min: Number(zone.min ?? 0),
      max:
        zone.max === null || zone.max === undefined || Number(zone.max) < 0
          ? null
          : Number(zone.max),
    }))
    .filter((zone) => Number.isFinite(zone.min));

  return normalized.length > 0
    ? normalized.map((zone) => ({
        ...zone,
        label: formatZoneLabel(zone),
      }))
    : createFallbackHeartRateZones();
}

function createFallbackHeartRateZones() {
  const zones = [
    { index: 1, min: 0, max: 115, fallbackLabel: "Zona 1 (<115 bpm)" },
    { index: 2, min: 115, max: 152, fallbackLabel: "Zona 2 (115-152 bpm)" },
    { index: 3, min: 152, max: 171, fallbackLabel: "Zona 3 (152-171 bpm)" },
    { index: 4, min: 171, max: null, fallbackLabel: "Zona 4 (>171 bpm)" },
  ];

  return zones.map((zone) => ({
    ...zone,
    label: zone.fallbackLabel,
  }));
}

function formatZoneLabel(zone) {
  if (zone.max === null) {
    return `Zona ${zone.index} (>${zone.min} bpm)`;
  }

  return `Zona ${zone.index} (${zone.min}-${zone.max} bpm)`;
}

function createZoneTotals(initialValue) {
  return heartRateZones.reduce((totals, zone) => {
    totals[zone.label] = initialValue;
    return totals;
  }, {});
}

function getZoneColors() {
  return heartRateZones.map(
    (_zone, index) => HR_ZONE_COLORS[index % HR_ZONE_COLORS.length],
  );
}

function getHrZone(avgHr) {
  const heartRate = Number(avgHr);

  return (
    heartRateZones.find(
      (zone) =>
        heartRate >= zone.min && (zone.max === null || heartRate < zone.max),
    ) || heartRateZones[heartRateZones.length - 1]
  );
}

function findBestTargetRun(runs, targetKm) {
  const tolerance = targetKm <= 10 ? 1 : targetKm <= 21 ? 2 : 4;

  return runs
    .filter((run) => Math.abs(Number(run.distance_km) - targetKm) <= tolerance)
    .filter((run) => paceToSeconds(run.pace) > 0)
    .sort((first, second) => paceToSeconds(first.pace) - paceToSeconds(second.pace))[0];
}

function groupRunsByVolumePeriod(runs, period) {
  const keyGetter = {
    week: getIsoWeekKey,
    month: (date) => date.slice(0, 7),
    year: (date) => date.slice(0, 4),
  }[period];
  const totals = runs.reduce((groups, run) => {
    const label = keyGetter(run.date);
    groups.set(label, (groups.get(label) || 0) + Number(run.distance_km));
    return groups;
  }, new Map());

  return Array.from(totals.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([label, value]) => ({
      label,
      value: Number(value.toFixed(2)),
    }));
}

function formatVolumeAxisLabel(label, period) {
  if (period === "week") {
    return label.split("-").pop();
  }

  return label;
}

function getIsoWeekKey(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + 4 - day);
  const year = date.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function sortByDate(runs) {
  return [...runs].sort((first, second) => first.date.localeCompare(second.date));
}

function averagePaceForRuns(runs) {
  const validRuns = runs.filter((run) => paceToSeconds(run.pace) > 0);

  if (validRuns.length === 0) {
    return null;
  }

  return (
    validRuns.reduce((sum, run) => sum + paceToSeconds(run.pace), 0) /
    validRuns.length
  );
}

function sumDistance(runs) {
  return runs.reduce((sum, run) => sum + Number(run.distance_km || 0), 0);
}

function formatPace(elapsedTime, distance) {
  const meters = Number(distance || 0);

  if (meters <= 0) {
    return "0:00";
  }

  const paceSeconds = Math.round((Number(elapsedTime || 0) / meters) * 1000);
  return secondsToPace(paceSeconds);
}

function paceInputToSeconds(selector) {
  const value = getInputValue(selector);
  return value ? paceToSeconds(value) : null;
}

function paceToSeconds(pace) {
  const [minutes = 0, seconds = 0] = String(pace).split(":").map(Number);
  return minutes * 60 + seconds;
}

function secondsToPace(value) {
  const totalSeconds = Math.round(Number(value || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getInputValue(selector) {
  return document.querySelector(selector)?.value.trim() || "";
}

function parseNumberInput(selector) {
  const value = getInputValue(selector);
  return value === "" ? null : Number(value);
}

function setDashboardStatus(message) {
  setText("#dashboard-status", message);
}

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

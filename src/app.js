const ACTIVITIES_KEY = "strava_activities";
const RUNS_KEY = "strava_runs";
const STRAVA_ACTIVITIES_URL =
  "https://www.strava.com/api/v3/athlete/activities?per_page=200";
const ASSUMED_AGE = 30;
const HR_MAX = 220 - ASSUMED_AGE;

let activities = [];
let processedActivities = [];
let processedRuns = [];
let accessToken = null;
let selectedDays = 30;
let selectedSport = "Run";
let charts = {};
let currentSort = {
  key: "date",
  direction: "desc",
};

window.processedActivities = processedActivities;
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
    await loadActivities();
  } catch (error) {
    setDashboardStatus(error.message);
  }
}

function bindDashboardEvents() {
  document.querySelector("#logout-button")?.addEventListener("click", () => {
    localStorage.removeItem(ACTIVITIES_KEY);
    localStorage.removeItem(RUNS_KEY);
    window.location.href = "/api/logout";
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => showMainTab(button.dataset.tab));
  });

  document.querySelectorAll(".sport-tab").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSport = button.dataset.sport;
      document
        .querySelectorAll(".sport-tab")
        .forEach((item) => item.classList.toggle("is-active", item === button));
      renderDashboard();
    });
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

async function loadActivities() {
  setDashboardStatus("A carregar atividades do Strava...");

  if (!accessToken) {
    throw new Error("Access token Strava em falta na sessao.");
  }

  const stravaActivities = await fetchJson(STRAVA_ACTIVITIES_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  activities = stravaActivities.filter((activity) =>
    ["Run", "Ride"].includes(activity.type),
  );
  localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(activities));
  localStorage.setItem(
    RUNS_KEY,
    JSON.stringify(activities.filter((activity) => activity.type === "Run")),
  );
  updateProcessedActivitiesFromStorage();
  console.log("processedActivities", processedActivities);
  console.log("processedRuns", processedRuns);
  setDashboardStatus(`${processedActivities.length} atividades carregadas.`);
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
  const filtered = filterActivitiesByDays(getSelectedActivities(), selectedDays);
  updateKpis(filtered);
  renderAnalysis(filtered);
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

function renderAnalysis(activitiesForSport) {
  const isRun = selectedSport === "Run";

  setText(
    "#analysis-subtitle",
    isRun
      ? "Pace, zonas de FC, volume e melhores marcas."
      : "Velocidade, elevacao, distribuicao, FC e potencia.",
  );
  document.querySelector("#running-analytics").hidden = !isRun;
  document.querySelector("#cycling-analytics").hidden = isRun;

  if (isRun) {
    renderRunningAnalysis(activitiesForSport);
  } else {
    renderCyclingAnalysis(activitiesForSport);
  }
}

function updateKpis(items) {
  const totalDistance = sumDistance(items);
  const hrItems = items.filter((item) => item.avg_hr !== null);
  const averageHr =
    hrItems.length === 0
      ? null
      : hrItems.reduce((sum, item) => sum + Number(item.avg_hr), 0) /
        hrItems.length;

  setText("#kpi-total-label", selectedSport === "Run" ? "Total de corridas" : "Total de voltas");
  setText("#kpi-total-activities", items.length);
  setText("#kpi-total-distance", totalDistance.toFixed(1));
  setText("#kpi-average-hr", averageHr ? Math.round(averageHr) : "-");

  if (selectedSport === "Run") {
    const averagePace = averagePaceForRuns(items);
    setText("#kpi-pace-speed-label", "Pace médio");
    setText("#kpi-average-pace-speed", averagePace ? secondsToPace(averagePace) : "-");
  } else {
    const averageSpeed = averageSpeedForRides(items);
    setText("#kpi-pace-speed-label", "Velocidade média");
    setText(
      "#kpi-average-pace-speed",
      averageSpeed ? `${averageSpeed.toFixed(1)} km/h` : "-",
    );
  }
}

function renderRunningAnalysis(runs) {
  renderRunPaceChart(runs);
  renderRunHrZonesChart(runs);
  renderRunWeeklyVolumeChart(runs);
  renderPersonalRecords(runs);
  renderLongRuns(runs);
}

function renderCyclingAnalysis(rides) {
  renderRideSpeedChart(rides);
  renderRideElevationChart(rides);
  renderRideDistanceDistributionChart(rides);
  renderRideHrDistanceChart(rides);
  renderRidePowerChart(rides);
}

function renderRunPaceChart(runs) {
  const chartRuns = sortByDate(runs).filter((run) => paceToSeconds(run.pace) > 0);
  charts.runPace = createChart("runPaceChart", charts.runPace, {
    type: "line",
    data: {
      labels: chartRuns.map((run) => run.date),
      datasets: [
        {
          label: "Pace (min/km)",
          data: chartRuns.map((run) => paceToDecimalMinutes(run.pace)),
          borderColor: "#FC4C02",
          backgroundColor: "#FC4C02",
          tension: 0.3,
        },
      ],
    },
    options: chartOptions({ reverseY: true }),
  });
}

function renderRunHrZonesChart(runs) {
  const hrRuns = runs.filter((run) => run.avg_hr !== null);
  const zones = {
    "Fácil": 0,
    "Aeróbico": 0,
    "Limiar": 0,
    "VO2max": 0,
  };

  hrRuns.forEach((run) => {
    const ratio = Number(run.avg_hr) / HR_MAX;

    if (ratio < 0.65) {
      zones["Fácil"] += 1;
    } else if (ratio <= 0.75) {
      zones["Aeróbico"] += 1;
    } else if (ratio <= 0.85) {
      zones["Limiar"] += 1;
    } else {
      zones["VO2max"] += 1;
    }
  });
  const total = hrRuns.length || 1;

  charts.runHrZones = createChart("runHrZonesChart", charts.runHrZones, {
    type: "doughnut",
    data: {
      labels: Object.keys(zones),
      datasets: [
        {
          data: Object.values(zones).map((count) =>
            Number(((count / total) * 100).toFixed(1)),
          ),
          backgroundColor: ["#2ECC71", "#F1C40F", "#F39C12", "#E74C3C"],
          borderColor: "#1E1E1E",
        },
      ],
    },
    options: chartOptions(),
  });
}

function renderRunWeeklyVolumeChart(runs) {
  const weekly = groupByWeek(runs, (run) => Number(run.distance_km));
  charts.runWeeklyVolume = createChart(
    "runWeeklyVolumeChart",
    charts.runWeeklyVolume,
    {
      type: "bar",
      data: {
        labels: weekly.map((item) => item.week),
        datasets: [
          {
            label: "Km por semana",
            data: weekly.map((item) => item.value),
            backgroundColor: "#FC4C02",
            borderColor: "#FC4C02",
          },
        ],
      },
      options: chartOptions({ beginAtZero: true }),
    },
  );
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

  const longRuns = sortByDate(runs.filter((run) => Number(run.distance_km) > 15)).reverse();
  tbody.innerHTML = "";

  if (longRuns.length === 0) {
    tbody.innerHTML = '<tr><td class="empty-row" colspan="4">Sem corridas acima de 15 km.</td></tr>';
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

function renderRideSpeedChart(rides) {
  const chartRides = sortByDate(rides).filter((ride) => ride.average_speed !== null);
  charts.rideSpeed = createChart("rideSpeedChart", charts.rideSpeed, {
    type: "line",
    data: {
      labels: chartRides.map((ride) => ride.date),
      datasets: [
        {
          label: "Velocidade média (km/h)",
          data: chartRides.map((ride) => Number((ride.average_speed * 3.6).toFixed(1))),
          borderColor: "#3498DB",
          backgroundColor: "#3498DB",
          tension: 0.3,
        },
      ],
    },
    options: chartOptions(),
  });
}

function renderRideElevationChart(rides) {
  const weekly = groupByWeek(rides, (ride) => Number(ride.elevation_gain || 0));
  charts.rideElevation = createChart("rideElevationChart", charts.rideElevation, {
    type: "bar",
    data: {
      labels: weekly.map((item) => item.week),
      datasets: [
        {
          label: "Elevação semanal (m)",
          data: weekly.map((item) => item.value),
          backgroundColor: "#2ECC71",
          borderColor: "#2ECC71",
        },
      ],
    },
    options: chartOptions({ beginAtZero: true }),
  });
}

function renderRideDistanceDistributionChart(rides) {
  const buckets = {
    "<20km": 0,
    "20-50km": 0,
    "50-100km": 0,
    ">100km": 0,
  };

  rides.forEach((ride) => {
    const distance = Number(ride.distance_km);

    if (distance < 20) {
      buckets["<20km"] += 1;
    } else if (distance <= 50) {
      buckets["20-50km"] += 1;
    } else if (distance <= 100) {
      buckets["50-100km"] += 1;
    } else {
      buckets[">100km"] += 1;
    }
  });

  charts.rideDistribution = createChart(
    "rideDistanceDistributionChart",
    charts.rideDistribution,
    {
      type: "bar",
      data: {
        labels: Object.keys(buckets),
        datasets: [
          {
            label: "Voltas",
            data: Object.values(buckets),
            backgroundColor: "#3498DB",
            borderColor: "#3498DB",
          },
        ],
      },
      options: chartOptions({ beginAtZero: true }),
    },
  );
}

function renderRideHrDistanceChart(rides) {
  const points = rides
    .filter((ride) => ride.avg_hr !== null)
    .map((ride) => ({
      x: Number(ride.distance_km),
      y: Number(ride.avg_hr),
    }));

  charts.rideHrDistance = createChart("rideHrDistanceChart", charts.rideHrDistance, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "FC média vs distância",
          data: points,
          backgroundColor: "#E74C3C",
          borderColor: "#E74C3C",
        },
      ],
    },
    options: chartOptions({ beginAtZero: false }),
  });
}

function renderRidePowerChart(rides) {
  const powerRides = sortByDate(rides).filter((ride) => ride.average_watts !== null);
  const message = document.querySelector("#power-empty-message");
  const canvas = document.querySelector("#ridePowerChart");

  if (message) {
    message.hidden = powerRides.length > 0;
  }

  if (canvas) {
    canvas.hidden = powerRides.length === 0;
  }

  if (powerRides.length === 0) {
    destroyChart("ridePower");
    return;
  }

  charts.ridePower = createChart("ridePowerChart", charts.ridePower, {
    type: "line",
    data: {
      labels: powerRides.map((ride) => ride.date),
      datasets: [
        {
          label: "Potência média (W)",
          data: powerRides.map((ride) => ride.average_watts),
          borderColor: "#F1C40F",
          backgroundColor: "#F1C40F",
          tension: 0.3,
        },
      ],
    },
    options: chartOptions(),
  });
}

function renderHistory() {
  const tbody = document.querySelector("#history-table-body");

  if (!tbody) {
    return;
  }

  const items = sortActivities(filterHistoryActivities(getSelectedActivities()));
  tbody.innerHTML = "";

  if (items.length === 0) {
    tbody.innerHTML =
      '<tr><td class="empty-row" colspan="5">Sem atividades para os filtros selecionados.</td></tr>';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.date)}</td>
      <td>${escapeHtml(item.distance_km)}</td>
      <td>${escapeHtml(selectedSport === "Run" ? item.pace : `${item.speed_kmh} km/h`)}</td>
      <td>${item.avg_hr ?? "-"}</td>
      <td>${escapeHtml(item.duration_min)} min</td>
    `;
    tbody.appendChild(row);
  });
}

function filterHistoryActivities(items) {
  const startDate = getInputValue("#filter-start-date");
  const endDate = getInputValue("#filter-end-date");
  const minDistance = parseNumberInput("#filter-min-distance");
  const maxDistance = parseNumberInput("#filter-max-distance");
  const minPace = paceInputToSeconds("#filter-min-pace");
  const maxPace = paceInputToSeconds("#filter-max-pace");

  return items.filter((item) => {
    const distance = Number(item.distance_km);
    const paceSeconds = paceToSeconds(item.pace);

    return (
      (!startDate || item.date >= startDate) &&
      (!endDate || item.date <= endDate) &&
      (minDistance === null || distance >= minDistance) &&
      (maxDistance === null || distance <= maxDistance) &&
      (minPace === null || paceSeconds >= minPace) &&
      (maxPace === null || paceSeconds <= maxPace)
    );
  });
}

function sortActivities(items) {
  return [...items].sort((first, second) => {
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

function sortValue(item, key) {
  if (key === "pace") {
    return paceToSeconds(item.pace);
  }

  if (key === "date") {
    return item.date;
  }

  return Number(item[key] ?? -1);
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

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

function chartOptions({ reverseY = false, beginAtZero = false } = {}) {
  return {
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
        ticks: {
          color: "#a7a7a7",
        },
        grid: {
          display: false,
        },
      },
      y: {
        reverse: reverseY,
        beginAtZero,
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

function getSelectedActivities() {
  return processedActivities.filter((activity) => activity.type === selectedSport);
}

function filterActivitiesByDays(items, days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days + 1);

  return items.filter((item) => new Date(`${item.date}T00:00:00`) >= cutoff);
}

function loadStoredActivities() {
  const saved = localStorage.getItem(ACTIVITIES_KEY);

  if (saved) {
    return JSON.parse(saved);
  }

  const savedRuns = localStorage.getItem(RUNS_KEY);
  return savedRuns ? JSON.parse(savedRuns) : [];
}

function updateProcessedActivitiesFromStorage() {
  processedActivities = processActivities(loadStoredActivities());
  processedRuns = processedActivities.filter((activity) => activity.type === "Run");
  window.processedActivities = processedActivities;
  window.processedRuns = processedRuns;
}

function processActivities(items) {
  return items.map((item) => {
    const distanceKm = Number(item.distance || 0) / 1000;
    const averageSpeed = item.average_speed ?? null;

    return {
      type: item.type,
      date: (item.start_date_local || item.start_date || "").slice(0, 10),
      distance_km: distanceKm.toFixed(2),
      pace: formatPace(item.elapsed_time, item.distance),
      avg_hr: item.average_heartrate ?? null,
      max_hr: item.max_heartrate ?? null,
      duration_min: (Number(item.moving_time || 0) / 60).toFixed(0),
      average_speed: averageSpeed,
      speed_kmh: averageSpeed === null ? null : Number((averageSpeed * 3.6).toFixed(1)),
      elevation_gain: item.total_elevation_gain ?? 0,
      average_watts: item.average_watts ?? null,
    };
  });
}

function findBestTargetRun(runs, targetKm) {
  const tolerance = targetKm <= 10 ? 1 : targetKm <= 21 ? 2 : 4;

  return runs
    .filter((run) => Math.abs(Number(run.distance_km) - targetKm) <= tolerance)
    .filter((run) => paceToSeconds(run.pace) > 0)
    .sort((first, second) => paceToSeconds(first.pace) - paceToSeconds(second.pace))[0];
}

function groupByWeek(items, valueGetter) {
  const totals = items.reduce((weeks, item) => {
    const week = getIsoWeekKey(item.date);
    weeks.set(week, (weeks.get(week) || 0) + valueGetter(item));
    return weeks;
  }, new Map());

  return Array.from(totals.entries())
    .sort(([firstWeek], [secondWeek]) => firstWeek.localeCompare(secondWeek))
    .map(([week, value]) => ({
      week,
      value: Number(value.toFixed(2)),
    }));
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

function sortByDate(items) {
  return [...items].sort((first, second) => first.date.localeCompare(second.date));
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

function averageSpeedForRides(rides) {
  const validRides = rides.filter((ride) => ride.speed_kmh !== null);

  if (validRides.length === 0) {
    return null;
  }

  return (
    validRides.reduce((sum, ride) => sum + Number(ride.speed_kmh), 0) /
    validRides.length
  );
}

function sumDistance(items) {
  return items.reduce((sum, item) => sum + Number(item.distance_km || 0), 0);
}

function formatPace(elapsedTime, distance) {
  const meters = Number(distance || 0);

  if (meters <= 0) {
    return "0:00";
  }

  const paceSeconds = Math.round((Number(elapsedTime || 0) / meters) * 1000);
  return secondsToPace(paceSeconds);
}

function paceToDecimalMinutes(pace) {
  const [minutes = 0, seconds = 0] = String(pace).split(":").map(Number);
  return Number((minutes + seconds / 60).toFixed(2));
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

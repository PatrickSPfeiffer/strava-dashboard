const RUNS_KEY = "strava_runs";
const STRAVA_ACTIVITIES_URL =
  "https://www.strava.com/api/v3/athlete/activities?per_page=200";

let activities = [];
let processedRuns = [];
let accessToken = null;
let selectedDays = 30;
let distanceChart = null;
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
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });

  document.querySelectorAll(".range-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDays = Number(button.dataset.days);
      document
        .querySelectorAll(".range-button")
        .forEach((item) => item.classList.toggle("is-active", item === button));
      renderAnalysis();
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
  setDashboardStatus("A carregar corridas do Strava...");

  if (!accessToken) {
    throw new Error("Access token Strava em falta na sessao.");
  }

  const stravaActivities = await fetchJson(STRAVA_ACTIVITIES_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

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
  showTab("analysis");
  renderAnalysis();
  renderHistory();
}

function showTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const isActive = panel.id === `${tabName}-panel`;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function renderAnalysis() {
  const runs = filterRunsByDays(processedRuns, selectedDays);
  updateKpis(runs);
  renderDistanceChart(runs);
}

function updateKpis(runs) {
  const totalDistance = sumDistance(runs);
  const averagePace = averagePaceForRuns(runs);
  const hrRuns = runs.filter((run) => run.avg_hr !== null);
  const averageHr =
    hrRuns.length === 0
      ? null
      : hrRuns.reduce((sum, run) => sum + Number(run.avg_hr), 0) / hrRuns.length;

  setText("#kpi-total-runs", runs.length);
  setText("#kpi-total-distance", totalDistance.toFixed(1));
  setText("#kpi-average-pace", averagePace ? secondsToPace(averagePace) : "-");
  setText("#kpi-average-hr", averageHr ? Math.round(averageHr) : "-");
}

function renderDistanceChart(runs) {
  if (!window.Chart) {
    return;
  }

  const canvas = document.querySelector("#distanceChart");

  if (!canvas) {
    return;
  }

  const dailyTotals = groupRunsByDay(runs);

  if (distanceChart) {
    distanceChart.destroy();
  }

  distanceChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: dailyTotals.map((item) => item.date),
      datasets: [
        {
          label: "Distância (km)",
          data: dailyTotals.map((item) => item.distanceKm),
          backgroundColor: "#FC4C02",
          borderColor: "#FC4C02",
        },
      ],
    },
    options: {
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
          beginAtZero: true,
          ticks: {
            color: "#a7a7a7",
          },
          grid: {
            display: false,
          },
        },
      },
    },
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

function filterRunsByDays(runs, days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days + 1);

  return runs.filter((run) => new Date(`${run.date}T00:00:00`) >= cutoff);
}

function groupRunsByDay(runs) {
  const totals = runs.reduce((days, run) => {
    days.set(run.date, (days.get(run.date) || 0) + Number(run.distance_km));
    return days;
  }, new Map());

  return Array.from(totals.entries())
    .sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate))
    .map(([date, distanceKm]) => ({
      date,
      distanceKm: Number(distanceKm.toFixed(2)),
    }));
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
    date: (run.start_date_local || "").slice(0, 10),
    distance_km: (Number(run.distance || 0) / 1000).toFixed(2),
    pace: formatPace(run.elapsed_time, run.distance),
    avg_hr: run.average_heartrate ?? null,
    max_hr: run.max_heartrate ?? null,
    duration_min: (Number(run.moving_time || 0) / 60).toFixed(0),
  }));
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

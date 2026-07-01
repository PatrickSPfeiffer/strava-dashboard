const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const PUBLIC_DIR = __dirname;

const sessions = new Map();
const oauthStates = new Set();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/login") {
      return handleLogin(response);
    }

    if (url.pathname === "/api/callback") {
      return handleCallback(url, response);
    }

    if (url.pathname === "/api/me") {
      return handleMe(request, response);
    }

    if (url.pathname === "/api/activities") {
      return handleActivities(request, response);
    }

    if (url.pathname === "/api/zones" && request.method === "GET") {
      return handleZones(request, response);
    }

    if (url.pathname === "/api/logout") {
      return handleLogout(request, response);
    }

    return serveStatic(url, response);
  } catch (error) {
    return sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`App pronta em http://localhost:${PORT}`);
});

function handleLogin(response) {
  ensureConfig();

  const state = crypto.randomUUID();
  oauthStates.add(state);

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.STRAVA_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all");
  url.searchParams.set("state", state);

  console.log("redirect_uri:", process.env.STRAVA_REDIRECT_URI);

  response.writeHead(302, { Location: url.toString() });
  response.end();
}

async function handleCallback(url, response) {
  ensureConfig();

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    response.writeHead(302, { Location: `/?error=${encodeURIComponent(error)}` });
    response.end();
    return;
  }

  if (!code || !state || !oauthStates.has(state)) {
    return sendJson(response, 400, { error: "Callback OAuth invalido." });
  }

  oauthStates.delete(state);

  const token = await exchangeToken({
    code,
    grant_type: "authorization_code",
  });
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, token);

  response.writeHead(302, {
    Location: "/dashboard.html",
    "Set-Cookie": `strava_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
  });
  response.end();
}

async function handleMe(request, response) {
  const session = getSession(request);

  if (!session) {
    return sendJson(response, 200, { authenticated: false });
  }

  const validSession = await refreshSessionIfNeeded(session);

  return sendJson(response, 200, {
    authenticated: true,
    athlete: validSession.athlete,
    accessToken: validSession.access_token,
  });
}

async function handleActivities(request, response) {
  const session = getSession(request);

  if (!session) {
    return sendJson(response, 401, { error: "Sessao Strava em falta." });
  }

  const validSession = await refreshSessionIfNeeded(session);
  const activities = await fetchAllStravaActivities(validSession.access_token);

  return sendJson(response, 200, activities);
}

async function fetchAllStravaActivities(accessToken) {
  const perPage = 200;
  let page = 1;
  let activities = [];

  while (true) {
    const url = new URL("https://www.strava.com/api/v3/athlete/activities");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const apiResponse = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await apiResponse.json();

    if (!apiResponse.ok) {
      throw new Error(data.message || "Nao foi possivel carregar atividades.");
    }

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    activities = activities.concat(data);
    page += 1;
  }

  return activities;
}

async function handleZones(request, response) {
  const session = getSession(request);

  if (!session) {
    return sendJson(response, 401, { error: "Sessao Strava em falta." });
  }

  const validSession = await refreshSessionIfNeeded(session);
  const apiResponse = await fetch("https://www.strava.com/api/v3/athlete/zones", {
    headers: {
      Authorization: `Bearer ${validSession.access_token}`,
    },
  });
  const data = await apiResponse.json();

  if (!apiResponse.ok) {
    return sendJson(response, apiResponse.status, {
      error: data.message || "Nao foi possivel carregar zonas de FC.",
    });
  }

  return sendJson(response, 200, data);
}

async function handleLogout(request, response) {
  const sessionId = getCookie(request, "strava_session");
  const session = sessionId ? sessions.get(sessionId) : null;

  if (session?.access_token) {
    await deauthorizeStrava(session.access_token);
  }

  if (sessionId) {
    sessions.delete(sessionId);
  }

  response.writeHead(302, {
    Location: "/",
    "Set-Cookie": [
      "strava_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "connect.sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    ],
  });
  response.end();
}

async function deauthorizeStrava(accessToken) {
  const url = new URL("https://www.strava.com/oauth/deauthorize");
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url, {
      method: "POST",
    });

    if (!response.ok) {
      console.warn("Strava deauthorize failed:", response.status);
    }
  } catch (error) {
    console.warn("Strava deauthorize failed:", error.message);
  }
}

async function refreshSessionIfNeeded(session) {
  const expiresAt = Number(session.expires_at || 0) * 1000;

  if (expiresAt - Date.now() > 60_000) {
    return session;
  }

  const refreshed = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: session.refresh_token,
  });
  Object.assign(session, refreshed);
  return session;
}

async function exchangeToken(params) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    ...params,
  });

  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Falha na autenticacao Strava.");
  }

  return data;
}

function serveStatic(url, response) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(response, 403, { error: "Acesso negado." });
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      return sendJson(response, 404, { error: "Ficheiro nao encontrado." });
    }

    response.writeHead(200, {
      "Content-Type": getContentType(filePath),
    });
    response.end(contents);
  });
}

function getSession(request) {
  const sessionId = getCookie(request, "strava_session");
  return sessionId ? sessions.get(sessionId) : null;
}

function getCookie(request, name) {
  const cookies = request.headers.cookie || "";
  const cookie = cookies
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function ensureConfig() {
  if (!CLIENT_ID || !CLIENT_SECRET || !process.env.STRAVA_REDIRECT_URI) {
    throw new Error(
      "Define STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET e STRAVA_REDIRECT_URI antes de iniciar a app.",
    );
  }
}

function getContentType(filePath) {
  const extension = path.extname(filePath);

  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[extension] || "application/octet-stream"
  );
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  });
}

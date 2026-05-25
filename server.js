require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

dns.setServers((process.env.DNS_SERVERS || "1.1.1.1,8.8.8.8").split(",").map((server) => server.trim()));

const root = __dirname;
const port = Number(process.env.PORT || 5500);
const host = process.env.HOST || "0.0.0.0";
const mongoUri = process.env.MONGO_URI || "";
const mongoConfigured = mongoUri && !mongoUri.includes("SUA_SENHA");
let mongoClientPromise;
const sessionCookieName = "manga_session";
let indexesPromise;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error("Payload muito grande"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON invalido"));
      }
    });
    request.on("error", reject);
  });
}

async function getCollection() {
  return getDb().then((db) => db.collection("app_state"));
}

async function getDb() {
  if (!mongoConfigured) {
    throw new Error("Configure a senha real do MongoDB no arquivo .env");
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(mongoUri);
    mongoClientPromise = client.connect().catch((error) => {
      mongoClientPromise = null;
      throw error;
    });
  }

  const client = await mongoClientPromise;
  return client.db("mangaTracker");
}

async function getCollections() {
  const db = await getDb();
  const collections = {
    states: db.collection("app_state"),
    users: db.collection("users"),
    sessions: db.collection("sessions")
  };
  if (!indexesPromise) {
    indexesPromise = collections.users.dropIndex("email_1").catch(() => null).then(() => Promise.all([
      collections.users.createIndex({ email: 1 }, { unique: true, sparse: true }),
      collections.users.createIndex({ usernameKey: 1 }, { unique: true }),
      collections.sessions.createIndex({ token: 1 }, { unique: true }),
      collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collections.states.createIndex({ userId: 1 }, { unique: true })
    ]));
  }
  await indexesPromise;
  return collections;
}

function normalizeState(state) {
  return {
    mangas: Array.isArray(state?.mangas) ? state.mangas : [],
    favorites: Array.isArray(state?.favorites) ? state.favorites : [],
    history: Array.isArray(state?.history) ? state.history : []
  };
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, pair) => {
    const [rawName, ...rawValue] = pair.trim().split("=");
    if (!rawName) return cookies;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

function setSessionCookie(response, token) {
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`
  );
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword = "") {
  const [salt, originalHash] = storedPassword.split(":");
  if (!salt || !originalHash) return false;
  const candidateHash = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidateHash, "hex"), Buffer.from(originalHash, "hex"));
}

async function getCurrentUser(request) {
  const token = parseCookies(request.headers.cookie)[sessionCookieName];
  if (!token) return null;

  const { sessions, users } = await getCollections();
  const session = await sessions.findOne({
    token,
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;

  const user = await users.findOne({ _id: session.userId });
  return user || null;
}

async function createSession(response, user) {
  const { sessions } = await getCollections();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

  await sessions.insertOne({
    token,
    userId: user._id,
    createdAt: new Date(),
    expiresAt
  });
  setSessionCookie(response, token);
}

async function handleAuth(request, response, pathname) {
  try {
    const { users, sessions } = await getCollections();

    if (pathname === "/api/auth/me" && request.method === "GET") {
      const user = await getCurrentUser(request);
      sendJson(response, 200, { user: user ? publicUser(user) : null });
      return;
    }

    if (pathname === "/api/auth/register" && request.method === "POST") {
      const body = await readJsonBody(request);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (username.length < 3 || password.length < 4) {
        sendJson(response, 400, { error: "Preencha usuario e senha com pelo menos 4 caracteres." });
        return;
      }

      const existing = await users.findOne({ usernameKey: username.toLowerCase() });
      if (existing) {
        sendJson(response, 409, { error: "Usuario ja cadastrado." });
        return;
      }

      const now = new Date();
      const result = await users.insertOne({
        username,
        usernameKey: username.toLowerCase(),
        passwordHash: hashPassword(password),
        createdAt: now,
        updatedAt: now
      });
      const user = await users.findOne({ _id: result.insertedId });
      await createSession(response, user);
      sendJson(response, 201, { user: publicUser(user) });
      return;
    }

    if (pathname === "/api/auth/login" && request.method === "POST") {
      const body = await readJsonBody(request);
      const login = String(body.login || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = await users.findOne({ usernameKey: login });

      if (!user || !verifyPassword(password, user.passwordHash)) {
        sendJson(response, 401, { error: "Usuario ou senha invalidos." });
        return;
      }

      await createSession(response, user);
      sendJson(response, 200, { user: publicUser(user) });
      return;
    }

    if (pathname === "/api/auth/logout" && request.method === "POST") {
      const token = parseCookies(request.headers.cookie)[sessionCookieName];
      if (token) await sessions.deleteOne({ token });
      clearSessionCookie(response);
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { error: "Rota de auth nao encontrada" });
  } catch (error) {
    sendJson(response, 503, {
      error: "Autenticacao indisponivel",
      detail: error.message
    });
  }
}

async function handleApi(request, response, pathname) {
  if (pathname.startsWith("/api/auth/")) {
    await handleAuth(request, response, pathname);
    return;
  }

  if (pathname === "/api/status") {
    sendJson(response, 200, {
      storage: mongoConfigured ? "mongodb" : "localStorage",
      mongoConfigured
    });
    return;
  }

  if (pathname !== "/api/state") {
    sendJson(response, 404, { error: "Rota nao encontrada" });
    return;
  }

  try {
    const user = await getCurrentUser(request);
    if (!user) {
      sendJson(response, 401, { error: "Login necessario" });
      return;
    }

    const collection = await getCollection();

    if (request.method === "GET") {
      const document = await collection.findOne({ userId: user._id });
      sendJson(response, 200, {
        storage: "mongodb",
        state: document?.state || null,
        updatedAt: document?.updatedAt || null
      });
      return;
    }

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const state = normalizeState(body.state);
      const updatedAt = new Date().toISOString();
      await collection.updateOne(
        { userId: user._id },
        { $set: { userId: user._id, state, updatedAt } },
        { upsert: true }
      );
      sendJson(response, 200, { ok: true, storage: "mongodb", updatedAt });
      return;
    }

    sendJson(response, 405, { error: "Metodo nao permitido" });
  } catch (error) {
    sendJson(response, 503, {
      error: "MongoDB indisponivel",
      detail: error.message
    });
  }
}

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }

    const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filePath = path.resolve(root, requestedPath);

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "Content-Type": types[path.extname(filePath)] || "application/octet-stream"
      });
      response.end(data);
    });
  })
  .listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    console.log(`Manga Zenith: http://${displayHost}:${port}`);
    console.log(`Banco: ${mongoConfigured ? "MongoDB" : "localStorage (troque SUA_SENHA no .env para ativar MongoDB)"}`);
  });

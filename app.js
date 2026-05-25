const STORAGE_KEY = "mangaZenith:data:v2";
const THEME_KEY = "mangaZenith:theme";
const CLOUD_STATE_URL = "/api/state";
const AUTH_ME_URL = "/api/auth/me";
const LOGIN_URL = "/api/auth/login";
const REGISTER_URL = "/api/auth/register";
const LOGOUT_URL = "/api/auth/logout";
const PLACEHOLDER_COVER =
  "https://images.unsplash.com/photo-1612036782180-6f0b6cd846fe?auto=format&fit=crop&w=900&q=80";
const STATUS_OPTIONS = {
  reading: "Lendo",
  planned: "Quero ler",
  completed: "Completo",
  paused: "Pausado",
  dropped: "Dropado"
};

const sampleData = {
  mangas: [
    {
      id: crypto.randomUUID(),
      title: "Zenith Reborn",
      author: "Studio Aurora",
      genres: ["Fantasia", "Drama", "Acao"],
      cover: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=900&q=80",
      synopsis:
        "Uma agente renasce como herdeira nobre e tenta viver em silencio, ate perceber que a escola imperial esconde conspiracoes perigosas.",
      status: "reading",
      progressChapter: 1,
      score: 8,
      source: { provider: "local" },
      chapters: [
        {
          id: crypto.randomUUID(),
          title: "Capitulo 1",
          pages: [
            "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=80",
            "https://images.unsplash.com/photo-1601850494422-3cf14624b0b3?auto=format&fit=crop&w=1200&q=80",
            "https://images.unsplash.com/photo-1613376023733-0a73315d9b06?auto=format&fit=crop&w=1200&q=80"
          ]
        }
      ]
    }
  ],
  favorites: [],
  history: []
};

const apiProviders = {
  mangadex: {
    label: "MangaDex",
    async search(query) {
      const url = new URL("https://api.mangadex.org/manga");
      url.searchParams.set("title", query);
      url.searchParams.set("limit", "12");
      url.searchParams.append("includes[]", "cover_art");
      url.searchParams.append("includes[]", "author");
      url.searchParams.append("includes[]", "artist");
      url.searchParams.append("availableTranslatedLanguage[]", "pt-br");
      url.searchParams.append("availableTranslatedLanguage[]", "en");
      url.searchParams.set("order[relevance]", "desc");

      const json = await fetchJson(url);
      return json.data.map(normalizeMangaDex);
    }
  },
  jikan: {
    label: "Jikan / MyAnimeList",
    async search(query) {
      const url = new URL("https://api.jikan.moe/v4/manga");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "12");
      url.searchParams.set("order_by", "score");
      url.searchParams.set("sort", "desc");

      const json = await fetchJson(url);
      return json.data.map(normalizeJikan);
    }
  },
  anilist: {
    label: "AniList",
    async search(query) {
      const graphql = `
        query ($search: String) {
          Page(page: 1, perPage: 12) {
            media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
              id
              chapters
              volumes
              title { romaji english native }
              description(asHtml: false)
              coverImage { large extraLarge }
              genres
              staff(perPage: 3) { nodes { name { full } } }
            }
          }
        }
      `;

      const json = await fetchJson("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: graphql, variables: { search: query } })
      });

      return json.data.Page.media.map(normalizeAniList);
    }
  },
  kitsu: {
    label: "Kitsu",
    async search(query) {
      const url = new URL("https://kitsu.io/api/edge/manga");
      url.searchParams.set("filter[text]", query);
      url.searchParams.set("page[limit]", "12");

      const json = await fetchJson(url, {
        headers: { Accept: "application/vnd.api+json" }
      });
      return json.data.map(normalizeKitsu);
    }
  }
};

let state = loadState();
let currentGenre = "Todos";
let currentMangaId = null;
let cloudSaveTimer = null;
let cloudStorageAvailable = false;
let currentUser = null;
let authReady = false;

const views = {
  auth: document.querySelector("#authView"),
  home: document.querySelector("#homeView"),
  library: document.querySelector("#libraryView"),
  discover: document.querySelector("#discoverView"),
  details: document.querySelector("#detailsView"),
  reader: document.querySelector("#readerView"),
  history: document.querySelector("#historyView"),
  admin: document.querySelector("#adminView")
};

const mangaGrid = document.querySelector("#mangaGrid");
const genreFilters = document.querySelector("#genreFilters");
const searchInput = document.querySelector("#searchInput");
const statusFilter = document.querySelector("#statusFilter");
const homeSearchInput = document.querySelector("#homeSearchInput");
const homeMangaGrid = document.querySelector("#homeMangaGrid");
const detailsContent = document.querySelector("#detailsContent");
const historyList = document.querySelector("#historyList");
const adminList = document.querySelector("#adminList");
const mangaForm = document.querySelector("#mangaForm");
const editDialog = document.querySelector("#editDialog");
const editForm = document.querySelector("#editForm");
const chapterDialog = document.querySelector("#chapterDialog");
const chapterForm = document.querySelector("#chapterForm");
const apiSearchForm = document.querySelector("#apiSearchForm");
const apiSearchInput = document.querySelector("#apiSearchInput");
const apiProvider = document.querySelector("#apiProvider");
const apiResults = document.querySelector("#apiResults");
const apiStatus = document.querySelector("#apiStatus");
const userMenu = document.querySelector("#userMenu");
const userName = document.querySelector("#userName");
const logoutButton = document.querySelector("#logoutButton");
const authButton = document.querySelector("#authButton");
const loginTab = document.querySelector("#loginTab");
const registerTab = document.querySelector("#registerTab");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const authStatus = document.querySelector("#authStatus");

function loadState() {
  const saved = localStorage.getItem(getStateStorageKey()) || localStorage.getItem(STORAGE_KEY) || localStorage.getItem("mangaZenith:data");
  if (!saved) {
    saveRawState(sampleData);
    return structuredClone(sampleData);
  }

  try {
    const parsed = JSON.parse(saved);
    parsed.mangas = parsed.mangas || [];
    parsed.favorites = parsed.favorites || [];
    parsed.history = parsed.history || [];
    parsed.mangas.forEach(normalizeMangaProgress);
    return parsed;
  } catch {
    saveRawState(sampleData);
    return structuredClone(sampleData);
  }
}

function getStateStorageKey() {
  return currentUser ? `${STORAGE_KEY}:${currentUser.id}` : STORAGE_KEY;
}

function normalizeMangaProgress(manga) {
  manga.status = STATUS_OPTIONS[manga.status] ? manga.status : "reading";
  manga.progressChapter = clampProgress(Number(manga.progressChapter || 0), manga);
  manga.score = manga.score ? clampScore(Number(manga.score)) : null;
  manga.chapters = manga.chapters || [];
}

function saveRawState(value) {
  localStorage.setItem(getStateStorageKey(), JSON.stringify(value));
}

function saveState() {
  saveRawState(state);
  if (currentUser) scheduleCloudSave();
}

async function loadCloudState() {
  try {
    const response = await fetch(CLOUD_STATE_URL, { cache: "no-store" });
    if (response.status === 401) {
      currentUser = null;
      renderAuthState();
      return false;
    }
    if (!response.ok) return false;

    const data = await response.json();
    cloudStorageAvailable = data.storage === "mongodb";

    if (data.state) {
      state = normalizeLoadedState(data.state);
      saveRawState(state);
      return true;
    }

    state = loadState();
    await saveCloudState();
    return false;
  } catch (error) {
    cloudStorageAvailable = false;
    return false;
  }
}

function normalizeLoadedState(value) {
  const loaded = value && typeof value === "object" ? value : {};
  loaded.mangas = loaded.mangas || [];
  loaded.favorites = loaded.favorites || [];
  loaded.history = loaded.history || [];
  loaded.mangas.forEach(normalizeMangaProgress);
  return loaded;
}

function scheduleCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(saveCloudState, 500);
}

async function saveCloudState() {
  if (!currentUser) return;

  try {
    const response = await fetch(CLOUD_STATE_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    cloudStorageAvailable = response.ok;
  } catch (error) {
    cloudStorageAvailable = false;
  }
}

function setView(route) {
  Object.entries(views).forEach(([name, element]) => {
    element.hidden = name !== route;
  });

  document.querySelectorAll(".top-nav a").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });

  scrollToView(route);
}

function scrollToView(route, behavior = "smooth") {
  const element = views[route];
  if (!element || element.hidden) return;

  requestAnimationFrame(() => {
    const header = document.querySelector(".app-header");
    const headerOffset = (header?.offsetHeight || 0) + 24;
    const targetTop = Math.max(0, element.getBoundingClientRect().top + window.scrollY - headerOffset);
    window.scrollTo({ top: targetTop, behavior });
  });
}

function navigate() {
  if (!authReady || !currentUser) {
    setView("auth");
    return;
  }

  const hash = location.hash.replace("#", "") || "home";
  const [route, id, chapterId] = hash.split("/");

  if (route === "manga" && id) {
    currentMangaId = id;
    renderDetails(id);
    setView("details");
    return;
  }

  if (route === "read" && id && chapterId) {
    currentMangaId = id;
    renderReader(id, chapterId);
    setView("reader");
    return;
  }

  if (route === "home") renderHomeCatalog();
  if (route === "library") renderLibrary();
  if (route === "history") renderHistory();
  if (route === "admin") renderAdmin();

  setView(views[route] ? route : "home");
}

function renderAuthState() {
  const isLoggedIn = Boolean(currentUser);
  userMenu.hidden = !isLoggedIn;
  authButton.hidden = isLoggedIn;
  document.querySelector(".top-nav").hidden = !isLoggedIn;
  if (currentUser) userName.textContent = currentUser.username;

  if (!isLoggedIn) {
    setView("auth");
  }
}

function setAuthMode(mode) {
  const isRegister = mode === "register";
  loginForm.hidden = isRegister;
  registerForm.hidden = !isRegister;
  loginTab.classList.toggle("active", !isRegister);
  registerTab.classList.toggle("active", isRegister);
  authStatus.textContent = "";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function loadSession() {
  try {
    const data = await requestJson(AUTH_ME_URL, { method: "GET" });
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  authReady = true;
  renderAuthState();
  if (currentUser) {
    const loadedFromCloud = await loadCloudState();
    if (loadedFromCloud || cloudStorageAvailable) {
      navigate();
    } else {
      scheduleCloudSave();
      navigate();
    }
  }
}

async function handleLogin(event) {
  event.preventDefault();
  authStatus.textContent = "Entrando...";
  const formData = new FormData(loginForm);

  try {
    const data = await requestJson(LOGIN_URL, {
      method: "POST",
      body: JSON.stringify({
        login: formData.get("login"),
        password: formData.get("password")
      })
    });
    currentUser = data.user;
    loginForm.reset();
    renderAuthState();
    await loadCloudState();
    navigate();
  } catch (error) {
    authStatus.textContent = error.message;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  authStatus.textContent = "Criando conta...";
  const formData = new FormData(registerForm);

  try {
    const data = await requestJson(REGISTER_URL, {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        email: formData.get("email"),
        password: formData.get("password")
      })
    });
    currentUser = data.user;
    registerForm.reset();
    renderAuthState();
    await saveCloudState();
    navigate();
  } catch (error) {
    authStatus.textContent = error.message;
  }
}

async function logout() {
  await fetch(LOGOUT_URL, { method: "POST" }).catch(() => {});
  currentUser = null;
  cloudStorageAvailable = false;
  renderAuthState();
}

function getGenres() {
  return ["Todos", ...new Set(state.mangas.flatMap((manga) => manga.genres || []))];
}

function renderGenreFilters() {
  genreFilters.innerHTML = "";
  getGenres().forEach((genre) => {
    const button = document.createElement("button");
    button.className = `filter-chip${genre === currentGenre ? " active" : ""}`;
    button.type = "button";
    button.textContent = genre;
    button.addEventListener("click", () => {
      currentGenre = genre;
      renderLibrary();
    });
    genreFilters.append(button);
  });
}

function renderLibrary() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;
  renderGenreFilters();
  mangaGrid.innerHTML = "";

  const filtered = state.mangas.filter((manga) => {
    const haystack = [manga.title, manga.author, (manga.genres || []).join(" ")].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesGenre = currentGenre === "Todos" || (manga.genres || []).includes(currentGenre);
    const matchesStatus = selectedStatus === "all" || manga.status === selectedStatus;
    return matchesQuery && matchesGenre && matchesStatus;
  });

  if (!filtered.length) {
    mangaGrid.innerHTML = "<p>Nenhum manga encontrado nesse filtro. Adicione pela aba Buscar ou cadastre no Admin.</p>";
    return;
  }

  filtered.forEach((manga) => mangaGrid.append(createMangaCard(manga)));
}

function renderHomeCatalog() {
  const query = homeSearchInput.value.trim().toLowerCase();
  homeMangaGrid.innerHTML = "";

  const filtered = state.mangas
    .filter((manga) => {
      const haystack = [manga.title, manga.author, (manga.genres || []).join(" ")].join(" ").toLowerCase();
      return !query || haystack.includes(query);
    })
    .sort((a, b) => {
      const statusOrder = { reading: 0, paused: 1, planned: 2, completed: 3, dropped: 4 };
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    })
    .slice(0, 8);

  if (!filtered.length) {
    homeMangaGrid.innerHTML = '<p class="home-empty">Nenhum manga salvo ainda.</p>';
    return;
  }

  filtered.forEach((manga) => homeMangaGrid.append(createMangaCard(manga)));
}

function createMangaCard(manga) {
  const template = document.querySelector("#mangaCardTemplate").content.cloneNode(true);
  const article = template.querySelector(".manga-card");
  const image = template.querySelector("img");
  const title = template.querySelector("h3");
  const author = template.querySelector("p");
  const meta = template.querySelector(".card-meta");
  const button = template.querySelector(".cover-button");

  image.src = manga.cover || PLACEHOLDER_COVER;
  image.alt = `Capa de ${manga.title}`;
  title.textContent = manga.title;
  author.textContent = manga.author || providerLabel(manga.source?.provider);
  meta.append(createTag(statusLabel(manga.status)));
  (manga.genres || []).slice(0, 2).forEach((genre) => meta.append(createTag(genre)));
  meta.append(createTag(progressLabel(manga)));

  const progress = document.createElement("div");
  progress.className = "progress-strip";
  progress.innerHTML = `
    <div>
      <span>${escapeHtml(progressLabel(manga))}</span>
      <strong>${progressPercent(manga)}%</strong>
    </div>
    <progress max="100" value="${progressPercent(manga)}"></progress>
  `;

  const quickActions = document.createElement("div");
  quickActions.className = "quick-progress";
  quickActions.innerHTML = `
    <button type="button" aria-label="Diminuir capitulo">-</button>
    <button type="button" aria-label="Aumentar capitulo">+</button>
  `;
  const [minusButton, plusButton] = quickActions.querySelectorAll("button");
  minusButton.addEventListener("click", (event) => {
    event.stopPropagation();
    updateMangaProgress(manga.id, manga.progressChapter - 1);
    renderVisibleLists();
  });
  plusButton.addEventListener("click", (event) => {
    event.stopPropagation();
    updateMangaProgress(manga.id, manga.progressChapter + 1);
    renderVisibleLists();
  });

  article.querySelector(".manga-card-body").append(progress, quickActions);

  button.addEventListener("click", () => {
    location.hash = `manga/${manga.id}`;
  });
  article.addEventListener("dblclick", () => toggleFavorite(manga.id));
  return template;
}

function createTag(text) {
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = text;
  return tag;
}

function renderVisibleLists() {
  const route = location.hash.replace("#", "").split("/")[0] || "home";
  if (route === "home") renderHomeCatalog();
  if (route === "library") renderLibrary();
  if (route === "history") renderHistory();
  if (route === "admin") renderAdmin();
  if (route === "manga" && currentMangaId) renderDetails(currentMangaId);
}

async function renderDetails(id) {
  const manga = state.mangas.find((item) => item.id === id);
  if (!manga) {
    location.hash = "library";
    return;
  }

  detailsContent.innerHTML = "<p>Carregando detalhes...</p>";
  if (manga.source?.provider === "mangadex" && !manga.chaptersLoaded) {
    await loadMangaDexChapters(manga);
  }

  const isFavorite = state.favorites.includes(id);
  const chapters = manga.chapters || [];
  const totalChapters = getChapterTotal(manga);
  const progressValue = clampProgress(manga.progressChapter, manga);
  detailsContent.innerHTML = `
    <div class="details-poster">
      <img src="${escapeHtml(manga.cover || PLACEHOLDER_COVER)}" alt="Capa de ${escapeHtml(manga.title)}">
    </div>
    <div>
      <p class="eyebrow">${escapeHtml(providerLabel(manga.source?.provider))}</p>
      <h2>${escapeHtml(manga.title)}</h2>
      <p class="details-copy">${escapeHtml(manga.synopsis || "Sem sinopse cadastrada.")}</p>
      <div class="card-meta">
        ${(manga.genres || []).map((genre) => `<span class="tag">${escapeHtml(genre)}</span>`).join("")}
        <span class="tag">${escapeHtml(chapterCountLabel(manga))}</span>
        <span class="tag">${escapeHtml(statusLabel(manga.status))}</span>
        ${manga.score ? `<span class="tag">Nota ${escapeHtml(manga.score)}/10</span>` : ""}
      </div>
      <div class="tracking-panel">
        <label>
          Status
          <select id="detailsStatus">
            ${Object.entries(STATUS_OPTIONS)
              .map(([value, label]) => `<option value="${value}"${manga.status === value ? " selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          Capitulo atual
          <div class="progress-editor">
            <button type="button" id="decreaseProgress" aria-label="Diminuir capitulo">-</button>
            <input id="progressInput" type="number" min="0" ${totalChapters ? `max="${totalChapters}"` : ""} value="${progressValue}">
            <button type="button" id="increaseProgress" aria-label="Aumentar capitulo">+</button>
          </div>
        </label>
        <label>
          Nota
          <input id="scoreInput" type="number" min="1" max="10" placeholder="1 a 10" value="${manga.score || ""}">
        </label>
        <div class="progress-strip large">
          <div>
            <span>${escapeHtml(progressLabel(manga))}</span>
            <strong>${progressPercent(manga)}%</strong>
          </div>
          <progress max="100" value="${progressPercent(manga)}"></progress>
        </div>
      </div>
      <div class="details-actions">
        <button class="button primary" type="button" id="startReading"${chapters.length ? "" : " disabled"}>Ler agora</button>
        <button class="button secondary" type="button" id="addChapterButton">Adicionar capitulo</button>
        <button class="button secondary" type="button" id="favoriteButton">${isFavorite ? "Remover favorito" : "Favoritar"}</button>
        <button class="button secondary" type="button" id="completeButton">Marcar completo</button>
      </div>
      <div class="chapter-list">
        ${
          chapters.length
            ? chapters
                .map((chapter, index) => `<button class="chapter-button${index + 1 <= progressValue ? " read" : ""}" type="button" data-chapter="${chapter.id}" data-index="${index + 1}">${escapeHtml(chapter.title)}</button>`)
                .join("")
            : "<p>Esta API so entrega dados de catalogo. Adicione paginas manualmente para ler aqui.</p>"
        }
      </div>
    </div>
  `;

  const startButton = detailsContent.querySelector("#startReading");
  if (startButton) {
    startButton.addEventListener("click", () => {
      const chapter = getContinueChapter(manga) || chapters[0];
      if (chapter) location.hash = `read/${manga.id}/${chapter.id}`;
    });
  }

  detailsContent.querySelector("#favoriteButton").addEventListener("click", () => {
    toggleFavorite(manga.id);
    renderDetails(manga.id);
  });

  detailsContent.querySelector("#detailsStatus").addEventListener("change", (event) => {
    updateMangaStatus(manga.id, event.target.value);
    renderDetails(manga.id);
  });

  detailsContent.querySelector("#progressInput").addEventListener("change", (event) => {
    updateMangaProgress(manga.id, event.target.value);
    renderDetails(manga.id);
  });

  detailsContent.querySelector("#scoreInput").addEventListener("change", (event) => {
    manga.score = event.target.value ? clampScore(event.target.value) : null;
    manga.updatedAt = new Date().toISOString();
    saveState();
    renderDetails(manga.id);
  });

  detailsContent.querySelector("#decreaseProgress").addEventListener("click", () => {
    updateMangaProgress(manga.id, manga.progressChapter - 1);
    renderDetails(manga.id);
  });

  detailsContent.querySelector("#increaseProgress").addEventListener("click", () => {
    updateMangaProgress(manga.id, manga.progressChapter + 1);
    renderDetails(manga.id);
  });

  detailsContent.querySelector("#completeButton").addEventListener("click", () => {
    updateMangaStatus(manga.id, "completed");
    renderDetails(manga.id);
  });

  detailsContent.querySelector("#addChapterButton").addEventListener("click", () => {
    openChapterDialog(manga);
  });

  detailsContent.querySelectorAll("[data-chapter]").forEach((button) => {
    button.addEventListener("click", () => {
      updateMangaProgress(manga.id, button.dataset.index);
      location.hash = `read/${manga.id}/${button.dataset.chapter}`;
    });
  });
}

function getContinueChapter(manga) {
  const last = state.history.find((item) => item.mangaId === manga.id);
  return (manga.chapters || []).find((chapter) => chapter.id === last?.chapterId);
}

function toggleFavorite(id) {
  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter((favoriteId) => favoriteId !== id);
  } else {
    state.favorites.unshift(id);
  }
  saveState();
}

async function renderReader(mangaId, chapterId) {
  const manga = state.mangas.find((item) => item.id === mangaId);
  const chapter = manga?.chapters?.find((item) => item.id === chapterId);

  if (!manga || !chapter) {
    location.hash = "library";
    return;
  }

  document.querySelector("#readerTitle").textContent = manga.title;
  document.querySelector("#readerChapter").textContent = chapter.title;

  const select = document.querySelector("#chapterSelect");
  select.innerHTML = manga.chapters.map((item) => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join("");
  select.value = chapter.id;

  const readerPages = document.querySelector("#readerPages");
  readerPages.innerHTML = "<p>Carregando paginas...</p>";

  let pages = chapter.pages || [];
  if (!pages.length && manga.source?.provider === "mangadex") {
    pages = await loadMangaDexPages(chapter);
    chapter.pages = pages;
    saveState();
  }

  if (!pages.length) {
    readerPages.innerHTML = "<p>Nenhuma pagina disponivel para este capitulo.</p>";
    return;
  }

  readerPages.innerHTML = "";
  pages.forEach((page, index) => {
    const wrapper = document.createElement("section");
    wrapper.className = "reader-page";
    wrapper.innerHTML = `<img src="${escapeHtml(page)}" alt="${escapeHtml(manga.title)}, ${escapeHtml(chapter.title)}, pagina ${index + 1}">`;
    readerPages.append(wrapper);
  });

  recordHistory(manga.id, chapter.id);
}

function recordHistory(mangaId, chapterId) {
  const manga = state.mangas.find((item) => item.id === mangaId);
  const chapterIndex = manga?.chapters?.findIndex((chapter) => chapter.id === chapterId) ?? -1;
  if (manga && chapterIndex >= 0) {
    manga.progressChapter = Math.max(clampProgress(manga.progressChapter, manga), chapterIndex + 1);
    if (manga.status === "planned") manga.status = "reading";
    if (getChapterTotal(manga) && manga.progressChapter >= getChapterTotal(manga)) manga.status = "completed";
    manga.updatedAt = new Date().toISOString();
  }
  state.history = state.history.filter((item) => item.mangaId !== mangaId);
  state.history.unshift({
    mangaId,
    chapterId,
    updatedAt: new Date().toISOString()
  });
  saveState();
}

function renderHistory() {
  historyList.innerHTML = "";
  const stats = document.createElement("section");
  stats.className = "status-summary";
  Object.entries(STATUS_OPTIONS).forEach(([status, label]) => {
    const count = state.mangas.filter((manga) => manga.status === status).length;
    const tile = document.createElement("article");
    tile.innerHTML = `<strong>${count}</strong><span>${escapeHtml(label)}</span>`;
    stats.append(tile);
  });
  historyList.append(stats);

  const favoriteItems = state.favorites
    .map((id) => state.mangas.find((manga) => manga.id === id))
    .filter(Boolean);

  if (favoriteItems.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Favoritos";
    historyList.append(heading);
    favoriteItems.forEach((manga) => historyList.append(createHistoryItem(manga, getContinueChapter(manga), "Favorito")));
  }

  if (state.history.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Continuar lendo";
    historyList.append(heading);
    state.history.forEach((item) => {
      const manga = state.mangas.find((entry) => entry.id === item.mangaId);
      const chapter = manga?.chapters?.find((entry) => entry.id === item.chapterId);
      if (manga) historyList.append(createHistoryItem(manga, chapter, "Historico"));
    });
  }

  const activeList = state.mangas
    .filter((manga) => ["reading", "paused", "planned"].includes(manga.status))
    .sort((a, b) => (b.updatedAt || b.importedAt || "").localeCompare(a.updatedAt || a.importedAt || ""));

  if (activeList.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Lista de acompanhamento";
    historyList.append(heading);
    activeList.forEach((manga) => historyList.append(createHistoryItem(manga, getContinueChapter(manga), statusLabel(manga.status))));
  }

  if (historyList.children.length === 1 && !state.mangas.length) {
    const empty = document.createElement("p");
    empty.textContent = "Sua lista ainda esta vazia.";
    historyList.append(empty);
  }
}

function createHistoryItem(manga, chapter, label) {
  const item = document.createElement("article");
  item.className = "history-item";
  item.innerHTML = `
    <div>
      <strong>${escapeHtml(manga.title)}</strong>
      <p>${label} - ${escapeHtml(progressLabel(manga))}${chapter ? ` - ${escapeHtml(chapter.title)}` : ""}</p>
    </div>
    <button class="button primary" type="button">${chapter ? "Continuar" : "Ver"}</button>
  `;
  item.querySelector("button").addEventListener("click", () => {
    location.hash = chapter ? `read/${manga.id}/${chapter.id}` : `manga/${manga.id}`;
  });
  return item;
}

function renderAdmin() {
  adminList.innerHTML = "";
  state.mangas.forEach((manga) => {
    const row = document.createElement("article");
    row.className = "admin-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(manga.title)}</strong>
        <p>${escapeHtml(statusLabel(manga.status))} - ${escapeHtml(progressLabel(manga))} - ${escapeHtml(providerLabel(manga.source?.provider))}</p>
      </div>
      <div class="admin-actions">
        <button class="button secondary" type="button" data-action="edit">Personalizar</button>
        <button class="button secondary" type="button" data-action="delete">Excluir</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => {
      openEditDialog(manga);
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      state.mangas = state.mangas.filter((item) => item.id !== manga.id);
      state.favorites = state.favorites.filter((id) => id !== manga.id);
      state.history = state.history.filter((item) => item.mangaId !== manga.id);
      saveState();
      renderAdmin();
    });
    adminList.append(row);
  });
}

async function addManga(formData) {
  const uploadedCover = await readImageFile(formData.get("coverFile"));
  const cover = uploadedCover || formData.get("cover").trim() || PLACEHOLDER_COVER;
  const pages = formData
    .get("pages")
    .split(/\r?\n/)
    .map((page) => page.trim())
    .filter(Boolean);
  const chapterTitle = formData.get("chapterTitle").trim();
  const chapters = chapterTitle || pages.length
    ? [
        {
          id: crypto.randomUUID(),
          title: chapterTitle || "Capitulo 1",
          pages
        }
      ]
    : [];

  const manga = {
    id: crypto.randomUUID(),
    title: formData.get("title").trim(),
    author: formData.get("author").trim(),
    genres: formData
      .get("genres")
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean),
    cover,
    synopsis: formData.get("synopsis").trim(),
    status: "reading",
    progressChapter: 0,
    score: null,
    source: { provider: "local" },
    chapterCount: Number(formData.get("chapterCount")) || chapters.length,
    volumeCount: Number(formData.get("volumeCount")) || null,
    chapters
  };

  state.mangas.unshift(manga);
  saveState();
}

function openEditDialog(manga) {
  editForm.elements.id.value = manga.id;
  editForm.elements.title.value = manga.title || "";
  editForm.elements.author.value = manga.author || "";
  editForm.elements.genres.value = (manga.genres || []).join(", ");
  editForm.elements.cover.value = manga.cover || "";
  editForm.elements.chapterCount.value = manga.chapterCount || manga.chapters?.length || "";
  editForm.elements.volumeCount.value = manga.volumeCount || "";
  editForm.elements.synopsis.value = manga.synopsis || "";
  editDialog.showModal();
}

function openChapterDialog(manga) {
  const nextNumber = (manga.chapters?.length || 0) + 1;
  chapterForm.reset();
  chapterForm.elements.mangaId.value = manga.id;
  chapterForm.elements.chapterTitle.value = `Capitulo ${nextNumber}`;
  chapterDialog.showModal();
}

async function saveMangaCustomization(formData) {
  const manga = state.mangas.find((item) => item.id === formData.get("id"));
  if (!manga) return;
  const uploadedCover = await readImageFile(formData.get("coverFile"));

  manga.title = formData.get("title").trim();
  manga.author = formData.get("author").trim();
  manga.genres = formData
    .get("genres")
    .split(",")
    .map((genre) => genre.trim())
    .filter(Boolean);
  manga.cover = uploadedCover || formData.get("cover").trim() || manga.cover || PLACEHOLDER_COVER;
  manga.synopsis = formData.get("synopsis").trim();
  manga.chapterCount = Number(formData.get("chapterCount")) || null;
  manga.volumeCount = Number(formData.get("volumeCount")) || null;
  manga.customizedAt = new Date().toISOString();

  saveState();
}

function addChapter(formData) {
  const manga = state.mangas.find((item) => item.id === formData.get("mangaId"));
  if (!manga) return null;

  const pages = formData
    .get("pages")
    .split(/\r?\n/)
    .map((page) => page.trim())
    .filter(Boolean);

  const chapter = {
    id: crypto.randomUUID(),
    title: formData.get("chapterTitle").trim(),
    pages
  };

  manga.chapters = manga.chapters || [];
  manga.chapters.push(chapter);
  manga.chapterCount = Math.max(Number(manga.chapterCount || 0), manga.chapters.length);
  manga.updatedAt = new Date().toISOString();
  saveState();
  return { manga, chapter };
}

function readImageFile(file) {
  if (!file || !file.size) return Promise.resolve("");

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function runApiSearch(event) {
  event.preventDefault();
  const query = apiSearchInput.value.trim();
  const selectedProvider = apiProvider.value;
  const providerKeys = selectedProvider === "all" ? Object.keys(apiProviders) : [selectedProvider];

  apiStatus.textContent = "Buscando nas APIs...";
  apiResults.innerHTML = "";

  const searches = await Promise.allSettled(
    providerKeys.map(async (key) => ({
      key,
      label: apiProviders[key].label,
      results: await apiProviders[key].search(query)
    }))
  );

  const fulfilled = searches.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const rejected = searches.filter((result) => result.status === "rejected");
  const total = fulfilled.reduce((sum, provider) => sum + provider.results.length, 0);

  apiStatus.textContent = `${total} resultado(s) encontrados${rejected.length ? `, ${rejected.length} API(s) falharam por rede/CORS/limite.` : "."}`;

  if (!total) {
    apiResults.innerHTML = "<p>Nenhum resultado encontrado. Voce pode criar esse manga manualmente no Admin.</p>";
    return;
  }

  fulfilled.forEach((provider) => {
    const section = document.createElement("section");
    section.className = "api-provider-block";
    section.innerHTML = `<h3>${escapeHtml(provider.label)}</h3>`;
    const grid = document.createElement("div");
    grid.className = "manga-grid";

    provider.results.forEach((manga) => grid.append(createApiResultCard(manga)));
    section.append(grid);
    apiResults.append(section);
  });
}

function createApiResultCard(manga) {
  const card = document.createElement("article");
  card.className = "manga-card";
  const exists = state.mangas.some(
    (item) => item.source?.provider === manga.source.provider && item.source?.externalId === manga.source.externalId
  );

  card.innerHTML = `
    <img src="${escapeHtml(manga.cover || PLACEHOLDER_COVER)}" alt="Capa de ${escapeHtml(manga.title)}" loading="lazy">
    <div class="manga-card-body">
      <div>
        <h3>${escapeHtml(manga.title)}</h3>
        <p>${escapeHtml(manga.author || providerLabel(manga.source.provider))}</p>
      </div>
      <div class="card-meta">
        ${manga.genres.slice(0, 2).map((genre) => `<span class="tag">${escapeHtml(genre)}</span>`).join("")}
        <span class="tag">${escapeHtml(chapterCountLabel(manga))}</span>
      </div>
      <div class="api-card-actions">
        <button class="button ${exists ? "secondary" : "primary"}" type="button" data-action="import">${exists ? "Ja importado" : "Importar"}</button>
        <button class="button secondary" type="button" data-action="chapter">Adicionar capitulo</button>
      </div>
    </div>
  `;

  const importButton = card.querySelector('[data-action="import"]');
  const chapterButton = card.querySelector('[data-action="chapter"]');
  importButton.disabled = exists;
  importButton.addEventListener("click", () => {
    const imported = importManga(manga);
    importButton.textContent = "Importado";
    importButton.className = "button secondary";
    importButton.disabled = true;
    location.hash = `manga/${imported.id}`;
  });
  chapterButton.addEventListener("click", () => {
    const imported = findImportedManga(manga) || importManga(manga);
    importButton.textContent = "Importado";
    importButton.className = "button secondary";
    importButton.disabled = true;
    location.hash = `manga/${imported.id}`;
    openChapterDialog(imported);
  });

  return card;
}

function findImportedManga(manga) {
  return state.mangas.find(
    (item) => item.source?.provider === manga.source.provider && item.source?.externalId === manga.source.externalId
  );
}

function importManga(manga) {
  const imported = {
    ...manga,
    id: crypto.randomUUID(),
    status: "planned",
    progressChapter: 0,
    score: null,
    importedAt: new Date().toISOString(),
    chapters: manga.chapters || []
  };
  state.mangas.unshift(imported);
  saveState();
  return imported;
}

function normalizeMangaDex(item) {
  const attributes = item.attributes || {};
  const title = pickText(attributes.title) || "Sem titulo";
  const cover = item.relationships?.find((rel) => rel.type === "cover_art")?.attributes?.fileName;
  const authors = item.relationships
    ?.filter((rel) => rel.type === "author" || rel.type === "artist")
    .map((rel) => rel.attributes?.name)
    .filter(Boolean);

  return {
    title,
    author: [...new Set(authors || [])].join(", ") || "MangaDex",
    genres: (attributes.tags || []).map((tag) => pickText(tag.attributes?.name)).filter(Boolean).slice(0, 6),
    cover: cover ? `https://uploads.mangadex.org/covers/${item.id}/${cover}.512.jpg` : PLACEHOLDER_COVER,
    synopsis: pickText(attributes.description) || "Sem sinopse.",
    source: { provider: "mangadex", externalId: item.id },
    chapterCount: null,
    chapters: [],
    chaptersLoaded: false
  };
}

function normalizeJikan(item) {
  return {
    title: item.title || item.title_english || "Sem titulo",
    author: (item.authors || []).map((author) => author.name).join(", ") || "MyAnimeList",
    genres: (item.genres || []).map((genre) => genre.name).slice(0, 6),
    cover: item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || PLACEHOLDER_COVER,
    synopsis: item.synopsis || "Sem sinopse.",
    source: { provider: "jikan", externalId: String(item.mal_id) },
    chapterCount: item.chapters || null,
    volumeCount: item.volumes || null,
    chapters: []
  };
}

function normalizeAniList(item) {
  const title = item.title?.english || item.title?.romaji || item.title?.native || "Sem titulo";
  return {
    title,
    author: item.staff?.nodes?.map((staff) => staff.name?.full).filter(Boolean).join(", ") || "AniList",
    genres: (item.genres || []).slice(0, 6),
    cover: item.coverImage?.extraLarge || item.coverImage?.large || PLACEHOLDER_COVER,
    synopsis: stripHtml(item.description) || "Sem sinopse.",
    source: { provider: "anilist", externalId: String(item.id) },
    chapterCount: item.chapters || null,
    volumeCount: item.volumes || null,
    chapters: []
  };
}

function normalizeKitsu(item) {
  const attributes = item.attributes || {};
  return {
    title: attributes.canonicalTitle || attributes.titles?.en || attributes.titles?.en_jp || "Sem titulo",
    author: "Kitsu",
    genres: attributes.subtype ? [attributes.subtype] : [],
    cover: attributes.posterImage?.large || attributes.posterImage?.original || PLACEHOLDER_COVER,
    synopsis: attributes.synopsis || "Sem sinopse.",
    source: { provider: "kitsu", externalId: String(item.id) },
    chapterCount: attributes.chapterCount || null,
    volumeCount: attributes.volumeCount || null,
    chapters: []
  };
}

async function loadMangaDexChapters(manga) {
  try {
    const url = new URL(`https://api.mangadex.org/manga/${manga.source.externalId}/feed`);
    url.searchParams.set("limit", "80");
    url.searchParams.set("includeFutureUpdates", "0");
    url.searchParams.append("translatedLanguage[]", "pt-br");
    url.searchParams.append("translatedLanguage[]", "en");
    url.searchParams.set("order[chapter]", "asc");

    const json = await fetchJson(url);
    manga.chapters = json.data.map((chapter, index) => {
      const number = chapter.attributes?.chapter || String(index + 1);
      const title = chapter.attributes?.title ? `Capitulo ${number} - ${chapter.attributes.title}` : `Capitulo ${number}`;
      return {
        id: chapter.id,
        title,
        pages: [],
        source: { provider: "mangadex", externalId: chapter.id }
      };
    });
    manga.chapterCount = manga.chapters.length;
    manga.chaptersLoaded = true;
    saveState();
  } catch (error) {
    manga.chaptersLoaded = true;
    saveState();
  }
}

async function loadMangaDexPages(chapter) {
  const json = await fetchJson(`https://api.mangadex.org/at-home/server/${chapter.source.externalId}`);
  const chapterData = json.chapter;
  return chapterData.data.map((page) => `${json.baseUrl}/data/${chapterData.hash}/${page}`);
}

async function fetchJson(input, options = {}) {
  const response = await fetch(input, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function pickText(values = {}) {
  return values["pt-br"] || values.en || values["en-us"] || Object.values(values)[0] || "";
}

function stripHtml(value = "") {
  const div = document.createElement("div");
  div.innerHTML = value;
  return div.textContent || div.innerText || "";
}

function providerLabel(provider = "local") {
  return apiProviders[provider]?.label || "Local";
}

function chapterCountLabel(manga) {
  const chapterCount = Number(manga.chapterCount || manga.chapters?.length || 0);
  if (chapterCount > 0) {
    return `${chapterCount} capitulo${chapterCount === 1 ? "" : "s"}`;
  }

  const volumeCount = Number(manga.volumeCount || 0);
  if (volumeCount > 0) {
    return `${volumeCount} volume${volumeCount === 1 ? "" : "s"}`;
  }

  return "Capitulos nao informados";
}

function getChapterTotal(manga) {
  return Number(manga.chapterCount || manga.chapters?.length || 0);
}

function clampProgress(value, manga) {
  const total = getChapterTotal(manga);
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  return total > 0 ? Math.min(safeValue, total) : safeValue;
}

function clampScore(value) {
  return Math.max(1, Math.min(10, Math.floor(Number(value) || 0)));
}

function progressLabel(manga) {
  const total = getChapterTotal(manga);
  const progress = clampProgress(manga.progressChapter, manga);
  return total ? `${progress}/${total} caps` : `${progress} caps`;
}

function progressPercent(manga) {
  const total = getChapterTotal(manga);
  return total ? Math.round((clampProgress(manga.progressChapter, manga) / total) * 100) : 0;
}

function statusLabel(status) {
  return STATUS_OPTIONS[status] || STATUS_OPTIONS.reading;
}

function updateMangaProgress(id, value) {
  const manga = state.mangas.find((item) => item.id === id);
  if (!manga) return;
  manga.progressChapter = clampProgress(value, manga);
  if (getChapterTotal(manga) && manga.progressChapter >= getChapterTotal(manga)) {
    manga.status = "completed";
  } else if (manga.status === "planned" && manga.progressChapter > 0) {
    manga.status = "reading";
  }
  manga.updatedAt = new Date().toISOString();
  saveState();
}

function updateMangaStatus(id, status) {
  const manga = state.mangas.find((item) => item.id === id);
  if (!manga || !STATUS_OPTIONS[status]) return;
  manga.status = status;
  if (status === "completed" && getChapterTotal(manga)) {
    manga.progressChapter = getChapterTotal(manga);
  }
  manga.updatedAt = new Date().toISOString();
  saveState();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[character];
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector("#themeIcon").textContent = theme === "dark" ? "Sol" : "Lua";
  localStorage.setItem(THEME_KEY, theme);
}

searchInput.addEventListener("input", renderLibrary);
statusFilter.addEventListener("change", renderLibrary);
homeSearchInput.addEventListener("input", renderHomeCatalog);
apiSearchForm.addEventListener("submit", runApiSearch);
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const nextHash = link.getAttribute("href");
    const route = nextHash.replace("#", "").split("/")[0];
    if (!views[route]) return;

    event.preventDefault();
    if (location.hash === nextHash) {
      navigate();
      return;
    }
    location.hash = nextHash;
  });
});
authButton.addEventListener("click", () => {
  setAuthMode("login");
  setView("auth");
});
loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));
loginForm.addEventListener("submit", handleLogin);
registerForm.addEventListener("submit", handleRegister);
logoutButton.addEventListener("click", logout);

document.querySelector("#backToLibrary").addEventListener("click", () => {
  location.hash = "library";
});

document.querySelector("#closeReader").addEventListener("click", () => {
  location.hash = currentMangaId ? `manga/${currentMangaId}` : "library";
});

document.querySelector("#chapterSelect").addEventListener("change", (event) => {
  location.hash = `read/${currentMangaId}/${event.target.value}`;
});

document.querySelector("#clearHistory").addEventListener("click", () => {
  state.history = [];
  saveState();
  renderHistory();
});

document.querySelector("#resetData").addEventListener("click", () => {
  state = structuredClone(sampleData);
  saveState();
  renderAdmin();
});

document.querySelector("#themeToggle").addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
});

mangaForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addManga(new FormData(mangaForm));
  mangaForm.reset();
  renderAdmin();
  renderHomeCatalog();
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveMangaCustomization(new FormData(editForm));
  editDialog.close();
  renderAdmin();
  renderHomeCatalog();
});

document.querySelector("#closeEditDialog").addEventListener("click", () => {
  editDialog.close();
});

document.querySelector("#closeChapterDialog").addEventListener("click", () => {
  chapterDialog.close();
});

chapterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const added = addChapter(new FormData(chapterForm));
  chapterDialog.close();
  chapterForm.reset();
  if (added) {
    renderDetails(added.manga.id);
    renderHomeCatalog();
  }
});

window.addEventListener("hashchange", navigate);
applyTheme(localStorage.getItem(THEME_KEY) || "light");

async function initializeApp() {
  setAuthMode("login");
  renderAuthState();
  await loadSession();
  navigate();
}

initializeApp();

(function () {
  const config = window.DEDICALIVRES_CONFIG;
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
    console.error("Configuration Supabase manquante.");
    return;
  }

  const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  const eventsGrid = document.getElementById("events-grid");
  const resultsCount = document.getElementById("results-count");
  const form = document.getElementById("submission-form");
  const formFeedback = document.getElementById("form-feedback");
  const searchInput = document.getElementById("search-input");
  const regionFilter = document.getElementById("region-filter");
  const typeFilter = document.getElementById("type-filter");
  const dateFilter = document.getElementById("date-filter");
  const mobileMapToggle = document.getElementById("mobile-map-toggle");
  const locateMeButton = document.getElementById("locate-me");
  const mapPanel = document.querySelector(".map-panel");

  const cityInput = document.getElementById("city-input");
  const citySuggestions = document.getElementById("city-suggestions");
  const cityLatInput = document.getElementById("city-lat");
  const cityLngInput = document.getElementById("city-lng");
  const cityHelp = document.getElementById("city-help");
  const regionSubmit = document.getElementById("region-submit");

  let map, markersLayer, userMarker;
  let userPosition = null;
  let markerByEventId = {};
  let allEvents = [];
  let cityResults = [];
  let citySearchTimer;

  init();

  function init() {
    trackVisit();
    initMap();
    bindEvents();
    bindCityAutocomplete();
    loadEvents();
    injectNewsletterBlock();
  }

  async function trackVisit() {
    try {
      const sessionKey = `dedicalivres_visit_${location.pathname}`;
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, "1");
      await supabaseClient.from("visits").insert([{
        page: document.title || "Dédicalivres",
        path: location.pathname || "/",
        referrer: document.referrer || null,
        user_agent: navigator.userAgent || null
      }]);
    } catch (error) {
      console.warn("Compteur de visite non enregistré :", error);
    }
  }

  function bindEvents() {
    document.getElementById("apply-filters")?.addEventListener("click", renderFilteredEvents);
    document.getElementById("reset-filters")?.addEventListener("click", resetFilters);
    searchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") renderFilteredEvents();
    });
    form?.addEventListener("submit", handleFormSubmit);
    mobileMapToggle?.addEventListener("click", () => {
      mapPanel?.classList.toggle("is-open");
      const isOpen = mapPanel?.classList.contains("is-open");
      mobileMapToggle.textContent = isOpen ? "Masquer la carte" : "Afficher la carte";
      setTimeout(() => map?.invalidateSize(), 220);
    });
    locateMeButton?.addEventListener("click", locateUser);
  }

  function bindCityAutocomplete() {
    if (!cityInput || !citySuggestions) return;

    cityInput.addEventListener("input", () => {
      clearTimeout(citySearchTimer);
      clearCityCoordinates();
      const query = cityInput.value.trim();
      if (query.length < 2) {
        citySuggestions.innerHTML = "";
        setCityHelp("Tapez au moins 2 caractères puis choisissez une ville proposée.", "");
        return;
      }
      cityInput.classList.add("loading");
      setCityHelp("Recherche de villes…", "");
      citySearchTimer = setTimeout(() => searchCities(query), 260);
    });

    cityInput.addEventListener("change", () => selectCityFromValue(cityInput.value));
    cityInput.addEventListener("blur", () => setTimeout(() => selectCityFromValue(cityInput.value), 120));
  }

  async function searchCities(query) {
    try {
      const response = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=8&type=municipality`);
      const data = await response.json();

      cityResults = (data.features || []).map((feature) => {
        const properties = feature.properties || {};
        const coords = feature.geometry?.coordinates || [];
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        const city = properties.city || properties.name || "";
        const postcode = properties.postcode || "";
        const context = properties.context || "";
        const region = guessRegionFromContext(context);
        return { city, postcode, context, region, lat, lng };
      }).filter((item) => item.city && Number.isFinite(item.lat) && Number.isFinite(item.lng));

      citySuggestions.innerHTML = "";
      cityResults.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.city;
        option.label = [item.city, item.postcode, item.context].filter(Boolean).join(" — ");
        citySuggestions.appendChild(option);
      });

      setCityHelp(cityResults.length ? "Choisissez une ville dans la liste pour verrouiller les coordonnées." : "Aucune ville trouvée.", cityResults.length ? "success" : "error");
    } catch (error) {
      console.error("Erreur recherche ville :", error);
      setCityHelp("Impossible de rechercher les villes pour le moment.", "error");
    } finally {
      cityInput.classList.remove("loading");
    }
  }

  function selectCityFromValue(value) {
    if (!value || !cityResults.length) return;
    const normalizedValue = normalize(value);
    const selected =
      cityResults.find((item) => normalize(item.city) === normalizedValue) ||
      cityResults.find((item) => normalize(`${item.city} ${item.postcode}`) === normalizedValue) ||
      cityResults[0];

    if (!selected) return;

    cityInput.value = selected.city;
    cityLatInput.value = selected.lat;
    cityLngInput.value = selected.lng;

    if (regionSubmit && selected.region && !regionSubmit.value) regionSubmit.value = selected.region;
    setCityHelp(`Ville sélectionnée : ${selected.city}${selected.postcode ? " (" + selected.postcode + ")" : ""}. Coordonnées OK.`, "success");
  }

  function clearCityCoordinates() {
    if (cityLatInput) cityLatInput.value = "";
    if (cityLngInput) cityLngInput.value = "";
  }

  function setCityHelp(message, type) {
    if (!cityHelp) return;
    cityHelp.textContent = message;
    cityHelp.className = `field-help ${type || ""}`.trim();
  }

  function guessRegionFromContext(context) {
    const value = normalize(context);
    const matches = [
      ["auvergne rhone alpes", "Auvergne-Rhône-Alpes"], ["bourgogne franche comte", "Bourgogne-Franche-Comté"],
      ["bretagne", "Bretagne"], ["centre val de loire", "Centre-Val de Loire"], ["corse", "Corse"],
      ["grand est", "Grand Est"], ["hauts de france", "Hauts-de-France"], ["ile de france", "Île-de-France"],
      ["normandie", "Normandie"], ["nouvelle aquitaine", "Nouvelle-Aquitaine"], ["occitanie", "Occitanie"],
      ["pays de la loire", "Pays de la Loire"], ["provence alpes cote d azur", "Provence-Alpes-Côte d’Azur"]
    ];
    const found = matches.find(([key]) => value.includes(key));
    return found ? found[1] : "";
  }

  function initMap() {
    const mapElement = document.getElementById("map");
    if (!mapElement || !window.L) return;
    map = L.map("map", { scrollWheelZoom: true }).setView([46.603354, 1.888334], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  async function loadEvents() {
    setLoadingState();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseClient
      .from("events")
      .select("*")
      .eq("validated", true)
      .eq("rejected", false)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("featured", { ascending: false })
      .order("start_date", { ascending: true });

    if (error) {
      console.error("Erreur chargement événements :", error);
      setErrorState("Impossible de charger les événements pour le moment.");
      return;
    }

    allEvents = Array.isArray(data) ? data : [];
    renderFilteredEvents();
  }

  function renderFilteredEvents() {
    const filtered = filterEvents(allEvents);
    renderEvents(filtered);
    renderMapMarkers(filtered);
  }

  function filterEvents(events) {
    const search = normalize(searchInput?.value || "");
    const region = regionFilter?.value || "";
    const type = typeFilter?.value || "";
    const date = dateFilter?.value || "";
    return events.filter((event) => {
      const haystack = normalize([event.title, event.city, event.region, event.description].filter(Boolean).join(" "));
      return (!search || haystack.includes(search))
        && (!region || event.region === region)
        && (!type || event.type === type)
        && (!date || (event.start_date && event.start_date >= date) || (event.end_date && event.end_date >= date));
    });
  }

  function renderEvents(events) {
    if (!eventsGrid || !resultsCount) return;
    resultsCount.textContent = `${events.length} événement${events.length > 1 ? "s" : ""} affiché${events.length > 1 ? "s" : ""}`;

    if (!events.length) {
      eventsGrid.innerHTML = `<article class="empty-state"><p>Aucun événement ne correspond aux filtres sélectionnés.</p></article>`;
      return;
    }

    eventsGrid.innerHTML = events.map((event) => {
      const imageUrl = resolveImageUrl(event.image_url);
      const isFavorite = getFavorites().includes(String(event.id));
      const distance = getDistanceLabel(event);
      return `
        <article class="event-card ${event.featured ? "event-card-featured" : ""}" id="event-${escapeAttribute(event.id)}" data-event-id="${escapeAttribute(event.id)}">
          ${event.featured ? `<div class="featured-ribbon">Mis en avant</div>` : ""}
          ${imageUrl ? `<img class="card-image" src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(event.title || "Événement")}" />` : `<div class="card-image"></div>`}
          <div class="card-body">
            <div class="card-tags">
              ${event.type ? `<span class="badge">${escapeHtml(event.type)}</span>` : ""}
              ${event.price ? `<span class="badge badge-price">${escapeHtml(event.price)}</span>` : ""}
              ${event.featured ? `<span class="badge badge-featured">Sélection</span>` : ""}
              ${event.verified ? `<span class="badge badge-verified">Vérifié</span>` : ""}
            </div>
            <h3 class="card-title">${escapeHtml(event.title || "Sans titre")}</h3>
            <div class="card-meta">
              ${event.start_date ? `<span>📅 ${formatDateRange(event.start_date, event.end_date)}</span>` : ""}
              <span>📍 ${escapeHtml([event.city, event.region].filter(Boolean).join(", ")) || "Lieu non précisé"}</span>
              ${distance ? `<span>🧭 ${distance}</span>` : ""}
              ${event.source_label ? `<span>🔎 Source : ${escapeHtml(event.source_label)}</span>` : ""}
            </div>
            <p class="card-description">${escapeHtml(event.description || "")}</p>
            <div class="card-footer">
              <a class="card-link" href="event.html?id=${encodeURIComponent(event.id)}">Voir le détail</a>
              <button class="card-link favorite-btn ${isFavorite ? "is-favorite" : ""}" type="button" onclick="toggleFavorite('${escapeAttribute(event.id)}')">${isFavorite ? "❤️ Favori" : "♡ Favori"}</button>
              <button class="card-link" type="button" onclick="downloadCalendar('${escapeAttribute(event.id)}')">📅 Agenda</button>
              ${event.website ? `<a class="card-link" href="${escapeAttribute(event.website)}" target="_blank" rel="noopener noreferrer">Site officiel</a>` : ""}
            </div>
          </div>
        </article>`;
    }).join("");
  }

  function renderMapMarkers(events) {
    if (!markersLayer || !map) return;
    markersLayer.clearLayers();
    markerByEventId = {};
    const validCoords = events.filter((event) => Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lng)));
    validCoords.forEach((event) => {
      const lat = Number(event.lat), lng = Number(event.lng);
      const marker = L.marker([lat, lng]);
      marker.bindPopup(`<strong>${escapeHtml(event.title || "Événement")}</strong><br>${escapeHtml(event.city || "")}<br>${event.featured ? "<em>Mis en avant</em><br>" : ""}<button class="popup-focus-btn" onclick="focusEventCard('${escapeAttribute(event.id)}')">Voir la fiche</button>`);
      marker.on("click", () => window.focusEventCard(event.id, false));
      markersLayer.addLayer(marker);
      markerByEventId[event.id] = marker;
    });
    if (validCoords.length === 1) map.setView([Number(validCoords[0].lat), Number(validCoords[0].lng)], 9);
    else if (validCoords.length > 1) map.fitBounds(L.latLngBounds(validCoords.map((event) => [Number(event.lat), Number(event.lng)])), { padding: [25, 25] });
    else map.setView([46.603354, 1.888334], 6);
  }

  window.focusEventCard = function (id, shouldScroll = true) {
    const card = document.getElementById(`event-${id}`);
    if (!card) return;
    document.querySelectorAll(".event-card-highlight").forEach((item) => item.classList.remove("event-card-highlight"));
    if (shouldScroll) card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("event-card-highlight");
    setTimeout(() => card.classList.remove("event-card-highlight"), 1800);
  };

  window.toggleFavorite = function (id) {
    const favorites = getFavorites();
    const stringId = String(id);
    const next = favorites.includes(stringId) ? favorites.filter((item) => item !== stringId) : [...favorites, stringId];
    localStorage.setItem("dedicalivres_favorites", JSON.stringify(next));
    renderFilteredEvents();
  };

  window.downloadCalendar = function (id) {
    const event = allEvents.find((item) => String(item.id) === String(id));
    if (!event) return;
    const ics = createIcs(event);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(event.title || "evenement")}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  };

  function getFavorites() {
    try { return JSON.parse(localStorage.getItem("dedicalivres_favorites") || "[]"); }
    catch { return []; }
  }

  function locateUser() {
    if (!navigator.geolocation || !map) return alert("La géolocalisation n’est pas disponible sur ce navigateur.");
    locateMeButton.disabled = true;
    locateMeButton.textContent = "Localisation…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        userPosition = { lat: latitude, lng: longitude };
        if (userMarker) userMarker.remove();
        userMarker = L.marker([latitude, longitude]).addTo(map);
        userMarker.bindPopup("Vous êtes ici").openPopup();
        map.setView([latitude, longitude], 9);
        locateMeButton.disabled = false;
        locateMeButton.textContent = "Me localiser";
        renderFilteredEvents();
      },
      () => {
        alert("Impossible de récupérer votre position.");
        locateMeButton.disabled = false;
        locateMeButton.textContent = "Me localiser";
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function getDistanceLabel(event) {
    if (!userPosition || !Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lng))) return "";
    const km = haversine(userPosition.lat, userPosition.lng, Number(event.lat), Number(event.lng));
    return `${Math.round(km)} km de vous`;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const r = 6371, dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function toRad(value) { return value * Math.PI / 180; }

  async function handleFormSubmit(event) {
    event.preventDefault();
    if (!form || !formFeedback) return;
    setFormFeedback("Envoi en cours...", "");
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    const formData = new FormData(form);
    let lat = Number(formData.get("lat"));
    let lng = Number(formData.get("lng"));
    const city = formData.get("city")?.toString().trim() || "";

    try {
      if (!formData.get("title")?.toString().trim()) throw new Error("Le titre est obligatoire.");
      if (!city) throw new Error("La ville est obligatoire.");
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const coords = await geocodeMunicipality(city);
        if (!coords) throw new Error("Merci de sélectionner une ville proposée dans la liste pour placer correctement l’événement sur la carte.");
        lat = coords.lat; lng = coords.lng;
        if (cityLatInput) cityLatInput.value = lat;
        if (cityLngInput) cityLngInput.value = lng;
      }

      const payload = {
        title: formData.get("title")?.toString().trim() || "",
        type: formData.get("type")?.toString().trim() || null,
        region: formData.get("region")?.toString().trim() || null,
        city,
        price: formData.get("price")?.toString().trim() || null,
        start_date: formData.get("start_date") || null,
        end_date: formData.get("end_date") || formData.get("start_date") || null,
        website: formData.get("website")?.toString().trim() || null,
        description: formData.get("description")?.toString().trim() || null,
        lat, lng,
        validated: false, featured: false, rejected: false, verified: false,
        source_label: "Soumission publique"
      };

      const imageFile = formData.get("image");
      if (imageFile instanceof File && imageFile.size > 0) payload.image_url = await uploadImage(imageFile);

      const { error } = await supabaseClient.from("events").insert([payload]);
      if (error) throw error;

      form.reset();
      clearCityCoordinates();
      setCityHelp("Sélectionnez une ville proposée pour placer correctement l’événement sur la carte.", "");
      setFormFeedback("Merci, votre événement a bien été transmis pour validation.", "success");
    } catch (error) {
      console.error("Erreur soumission formulaire :", error);
      setFormFeedback(`Une erreur est survenue pendant l’envoi : ${error.message}`, "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function geocodeMunicipality(city) {
    try {
      const response = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(city)}&limit=1&type=municipality`);
      const data = await response.json();
      const coords = data?.features?.[0]?.geometry?.coordinates || [];
      const lng = Number(coords[0]), lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch { return null; }
  }

  async function uploadImage(file) {
    const rawExtension = ((file.name || "jpg").split(".").pop() || "jpg").toLowerCase();
    const extension = rawExtension.replace(/[^a-z0-9]/g, "") || "jpg";
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const { error } = await supabaseClient.storage.from("event-images").upload(fileName, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    const { data } = supabaseClient.storage.from("event-images").getPublicUrl(fileName);
    return data.publicUrl;
  }

  function injectNewsletterBlock() {
    const main = document.querySelector("main.container");
    if (!main || document.getElementById("newsletter-form")) return;
    const section = document.createElement("section");
    section.className = "section newsletter-section";
    section.innerHTML = `
      <h2>Recevoir les prochains événements</h2>
      <p>Inscrivez-vous pour recevoir les prochains salons, festivals et dédicaces de votre région.</p>
      <form id="newsletter-form" class="newsletter-form">
        <input name="email" type="email" placeholder="Votre email" required />
        <select name="region">
          <option value="">Toutes les régions</option><option>Bretagne</option><option>Île-de-France</option><option>Occitanie</option>
          <option>Auvergne-Rhône-Alpes</option><option>Nouvelle-Aquitaine</option><option>Provence-Alpes-Côte d’Azur</option>
        </select>
        <button class="btn-primary" type="submit">S’inscrire</button>
      </form>
      <p id="newsletter-feedback"></p>`;
    main.appendChild(section);
    section.querySelector("#newsletter-form").addEventListener("submit", handleNewsletterSubmit);
  }

  async function handleNewsletterSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const feedback = document.getElementById("newsletter-feedback");
    const email = formData.get("email")?.toString().trim().toLowerCase();
    const region = formData.get("region")?.toString().trim() || null;
    try {
      const { error } = await supabaseClient.from("newsletter_subscribers").insert([{ email, region }]);
      if (error) throw error;
      event.currentTarget.reset();
      feedback.textContent = "Merci, inscription enregistrée.";
      feedback.className = "success";
    } catch {
      feedback.textContent = "Inscription déjà existante ou impossible pour le moment.";
      feedback.className = "error";
    }
  }

  function createIcs(event) {
    const start = icsDate(event.start_date);
    const end = icsDate(event.end_date || event.start_date);
    return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Dedicalivres//FR","BEGIN:VEVENT",
      `UID:${event.id}@dedicalivres.fr`, `DTSTAMP:${icsDateTime(new Date())}`,
      start ? `DTSTART;VALUE=DATE:${start}` : "", end ? `DTEND;VALUE=DATE:${end}` : "",
      `SUMMARY:${escapeIcs(event.title || "Événement Dédicalivres")}`,
      `DESCRIPTION:${escapeIcs(event.description || "")}`,
      `LOCATION:${escapeIcs([event.city, event.region].filter(Boolean).join(", "))}`,
      event.website ? `URL:${event.website}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  }

  function icsDate(value) { return value ? value.replaceAll("-", "") : ""; }
  function icsDateTime(date) { return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"; }
  function escapeIcs(value) { return String(value || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n"); }

  function resetFilters() {
    if (searchInput) searchInput.value = "";
    if (regionFilter) regionFilter.value = "";
    if (typeFilter) typeFilter.value = "";
    if (dateFilter) dateFilter.value = "";
    renderFilteredEvents();
  }

  function setLoadingState() { if (eventsGrid) eventsGrid.innerHTML = `<article class="empty-state"><div class="loader"></div><p>Chargement des événements...</p></article>`; }
  function setErrorState(message) { if (eventsGrid) eventsGrid.innerHTML = `<article class="empty-state"><p>${escapeHtml(message)}</p></article>`; }
  function setFormFeedback(message, kind) { if (formFeedback) { formFeedback.textContent = message; formFeedback.className = `form-feedback ${kind}`.trim(); } }
  function resolveImageUrl(path) { if (!path) return ""; return /^https?:\/\//i.test(path) ? path : `${config.assetsBaseUrl || ""}${path}`; }
  function formatDateRange(startDate, endDate) { const start = formatDate(startDate); const end = endDate && endDate !== startDate ? formatDate(endDate) : ""; return end ? `${start} → ${end}` : start; }
  function formatDate(value) { if (!value) return ""; return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)); }
  function normalize(value) { return (value || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, " ").toLowerCase(); }
  function slugify(value) { return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "evenement"; }
  function escapeHtml(value) { return (value || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
})();

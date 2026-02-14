/* street_food_map - split build (no bundler)
 * Features preserved:
 * - Supabase REST load (fallback kb.json)
 * - Local editable store (localStorage)
 * - CRUD: add/edit/delete
 * - Relocate via AMap.Geocoder
 * - Drawer + logs + mobile-friendly
 */

(() => {
  "use strict";

  let map = null;

  function setViewportHeightVar(){
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
    if (map && typeof map.resize === "function"){
      requestAnimationFrame(() => {
        try{ map.resize(); }catch{}
      });
    }
  }

  /**********************
   * 0) Constants
   **********************/
  const CFG_KEY = "sfm_cfg_v1";
  const DB_KEY  = "sfm_db_v1"; // local editable dataset
  const SUPABASE_URL = "https://gwwiwhmryyruyxrmvjbm.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3d2l3aG1yeXlydXl4cm12amJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NDA1MDcsImV4cCI6MjA4NjAxNjUwN30.Nl3u335qC5MylCYLjTfTm7vOu4msvl3QjplZuVPqAg4";

  /**********************
   * 1) Lightweight logger
   **********************/
  const LogLevel = { debug: 10, info: 20, warn: 30, error: 40 };
  let currentLevel = localStorage.getItem("sfm_log_level") || "info";

  function nowStr(){
    const d = new Date();
    const pad = (n)=> String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function errToStr(e){
    try{
      if (!e) return "";
      if (typeof e === "string") return e;
      if (e instanceof Error) return e.stack || e.message;
      return JSON.stringify(e);
    }catch{
      return String(e);
    }
  }
  function errMsg(e){
    if (!e) return "";
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message || "error";
    return (e.message || e.info || e.msg || "").toString() || JSON.stringify(e);
  }
  function toCNMsg(e){
    const raw = errMsg(e);
    const msg = (raw || "").toLowerCase();
    if (!msg) return "Unknown error";
    if (msg.includes("permission") || msg.includes("denied") || msg.includes("secure origin")){
      return "Location permission denied, or the page is not HTTPS, so location cannot be obtained";
    }
    if (msg.includes("timeout")){
      return "Location timed out. Please check your network and try again";
    }
    if (msg.includes("amap not ready")){
      return "AMap is not ready. Check your key or network";
    }
    if (msg.includes("no coordinates")){
      return "This place has no coordinates, route planning is not possible";
    }
    if (msg.includes("invalid_userkey") || msg.includes("key")){
      return "AMap key is invalid or lacks permission";
    }
    return raw;
  }
  function log(level, msg, extra){
    if (LogLevel[level] < LogLevel[currentLevel]) return;
    const line = `[${nowStr()}] [${level.toUpperCase()}] ${msg}` + (extra ? ` | ${extra}` : "");
    (console[level] || console.log)(line);
    const el = document.getElementById("logs");
    if (el){
      el.textContent += line + "\n";
      el.scrollTop = el.scrollHeight;
    }
  }
  window.addEventListener("error", (ev) => log("error", "window.onerror", `${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}`));
  window.addEventListener("unhandledrejection", (ev) => log("error", "unhandledrejection", errToStr(ev.reason)));

  /**********************
   * 2) Drawer UI
   **********************/
  const body = document.body;
  const drawer = document.getElementById("drawer");
  const fab = document.getElementById("fab");
  const mask = document.getElementById("mask");
  const closeBtn = document.getElementById("close");
  const loadingEl = document.getElementById("loading");
  let loadingCount = 0;

  function showLoading(msg){
    loadingCount += 1;
    if (!loadingEl) return;
    const textEl = loadingEl.querySelector(".loading-text");
    if (textEl && msg) textEl.textContent = msg;
    loadingEl.classList.add("show");
    loadingEl.setAttribute("aria-hidden", "false");
  }
  function hideLoading(){
    loadingCount = Math.max(0, loadingCount - 1);
    if (!loadingEl) return;
    if (loadingCount === 0){
      loadingEl.classList.remove("show");
      loadingEl.setAttribute("aria-hidden", "true");
    }
  }

  function openDrawer(){
    body.classList.add("open");
    drawer.setAttribute("aria-hidden","false");
    setViewportHeightVar();
  }
  function closeDrawer(){
    body.classList.remove("open");
    drawer.setAttribute("aria-hidden","true");
    setViewportHeightVar();
  }

  fab.addEventListener("click", openDrawer);
  mask.addEventListener("click", closeDrawer);
  closeBtn.addEventListener("click", closeDrawer);
  window.addEventListener("resize", setViewportHeightVar);
  window.addEventListener("orientationchange", setViewportHeightVar);
  setViewportHeightVar();

  const logLevelSel = document.getElementById("logLevel");
  logLevelSel.value = currentLevel;
  logLevelSel.addEventListener("change", () => {
    currentLevel = logLevelSel.value;
    localStorage.setItem("sfm_log_level", currentLevel);
    log("info", "Log level changed", currentLevel);
  });
  document.getElementById("btnClearLog").addEventListener("click", () => {
    document.getElementById("logs").textContent = "";
    log("info", "Logs cleared");
  });
  document.getElementById("btnCopyLog").addEventListener("click", async () => {
    const text = document.getElementById("logs").textContent || "";
    try{
      await navigator.clipboard.writeText(text);
      log("info", "Logs copied to clipboard");
    }catch(e){
      log("warn", "Copy failed (browser restriction)", errToStr(e));
    }
  });

  /**********************
   * 3) Config (default + local override)
   **********************/
  const DEFAULT_CFG = {
    supabaseUrl: "https://gwwiwhmryyruyxrmvjbm.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3d2l3aG1yeXlydXl4cm12amJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NDA1MDcsImV4cCI6MjA4NjAxNjUwN30.Nl3u335qC5MylCYLjTfTm7vOu4msvl3QjplZuVPqAg4",
    amapKey: "02cb6240c341113e242b757c9c31f120",
    amapSecurityJsCode: "65611fe43ded9c43124b30e1b29cb7ff",
    amapRestKey: "6beb081c646f5b3396228c8131d39025"
  };

  function loadCfg() {
    try {
      const savedRaw = localStorage.getItem(CFG_KEY);
      const saved = savedRaw ? JSON.parse(savedRaw) : {};
      return { ...DEFAULT_CFG, ...(saved && typeof saved === "object" ? saved : {}) };
    } catch (e) {
      return { ...DEFAULT_CFG };
    }
  }
  function saveCfg(patch){
    const cur = loadCfg();
    const next = { ...cur, ...patch };
    localStorage.setItem(CFG_KEY, JSON.stringify(next));
    return next;
  }

  // Supabase config is fixed in code; no settings UI.


  /**********************
   * 4) AMap dynamic loader + map helpers
   **********************/
  let markers = [];
  let amapLoading = null;
  let userMarker = null;

  function removeOldAMapScript(){
    const olds = document.querySelectorAll('script[data-amap="1"]');
    olds.forEach(s => s.remove());
    try{ delete window.AMap; }catch{}
    try{ delete window.AMapUI; }catch{}
  }

  async function ensureAMapLoaded(forceReload=false){
    const cfg = loadCfg();
    const key = cfg.amapKey;
    const scode = (cfg.amapSecurityJsCode || "").trim();
    if (!key){
      log("error", "AMap key not configured. Map cannot load. Please set it in Settings.");
      return false;
    }
    if (!forceReload && window.AMap){
      return true;
    }
    if (amapLoading && !forceReload){
      return amapLoading;
    }

    amapLoading = new Promise((resolve) => {
      if (forceReload) removeOldAMapScript();

      log("info", "Loading AMap script...");
      const s = document.createElement("script");
      s.dataset.amap = "1";
      const scodeParam = scode ? `&securityjscode=${encodeURIComponent(scode)}` : "";
      s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}${scodeParam}&plugin=AMap.Geocoder,AMap.Geolocation,AMap.Driving,AMap.Walking`;
      s.async = true;
      s.onload = () => { log("info", "AMap script loaded"); resolve(true); };
      s.onerror = () => { log("error", "AMap script load failed (check key / network / domain whitelist)"); resolve(false); };
      document.head.appendChild(s);
    });

    return amapLoading;
  }

  function initMap(){
    if (!window.AMap){
      log("error", "AMap not ready, initMap cancelled");
      return;
    }
    const center = [104.0668, 30.5728];
    map = new AMap.Map("map", {
      zoom: 12,
      center,
      viewMode: "2D"
    });
    log("info", "Map initialized", `center=${center.join(",")}`);
  }

  function clearMarkers(){
    if (!map) return;
    for (const m of markers) m.setMap(null);
    markers = [];
  }
  function addMarker(it){
    if (!map) return;
    if (it.lng == null || it.lat == null) return;
    const m = new AMap.Marker({
      position: [it.lng, it.lat],
      title: it.name || "(Unnamed)"
    });
    m.setMap(map);
    m.on("click", () => {
      const title = (it.name || "(Unnamed)") + (it.category ? ` / ${it.category}` : "");
      const addr = [it.city, it.address].filter(Boolean).join(" ");
      const navCall = `window.__sfm_nav.openRouteTo(${JSON.stringify(String(it.id))})`;
      const html = `<div style="font-size:13px;">
        <b>${escapeHtml(title)}</b><br/>
        ${escapeHtml(addr)}<br/>
        <button class="btn nav-btn" style="margin-top:6px;" onclick='${navCall}'>出发</button>
      </div>`;
      const info = new AMap.InfoWindow({ content: html, offset: new AMap.Pixel(0,-30) });
      info.open(map, m.getPosition());
    });
    it.__marker = m;
    markers.push(m);
  }
  function focusItem(it){
    if (!map || !it) return;
    if (it.lng != null && it.lat != null){
      map.setZoomAndCenter(16, [it.lng, it.lat], true);
      if (it.__marker) it.__marker.emit("click", { target: it.__marker });
    }
  }

  function setUserMarker(pos){
    if (!map || !pos) return;
    const lnglat = [pos.lng, pos.lat];
    const icon = new AMap.Icon({
      image: "https://webapi.amap.com/theme/v1.3/markers/b/mark_rs.png",
      size: new AMap.Size(22, 22),
      imageSize: new AMap.Size(22, 22)
    });
    if (!userMarker){
      userMarker = new AMap.Marker({
        position: lnglat,
        title: "Current Location",
        icon,
        zIndex: 200,
        offset: new AMap.Pixel(-12, -24),
      });
      userMarker.setMap(map);
    }else{
      userMarker.setPosition(lnglat);
    }
  }

  /**********************
   * 4.1) Geolocation + Route Planning (backend)
   **********************/
  let geo = null;
  let drivingSvc = null;
  let walkingSvc = null;
  let routeLine = null;

  async function getCurrentPosition(opts){
    const options = Object.assign({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }, opts || {});

    const ok = await ensureAMapLoaded(false);
    if (!ok || !window.AMap) throw new Error("AMap not ready");

    if (!geo){
      geo = new AMap.Geolocation(options);
    }

    return new Promise((resolve, reject) => {
      try{
        geo.getCurrentPosition((status, result) => {
          if (status === "complete" && result && result.position){
            resolve({
              lng: result.position.lng,
              lat: result.position.lat,
              raw: result
            });
          }else{
            const msg = (result && (result.message || result.info)) || "geolocation failed";
            reject(new Error(msg));
          }
        });
      }catch (e){
        reject(e);
      }
    });
  }

  function getRouteService(mode, renderOnMap){
    if (mode === "walking"){
      if (!walkingSvc){
        walkingSvc = new AMap.Walking({ map: renderOnMap ? map : null });
      }
      return walkingSvc;
    }
    if (!drivingSvc){
      drivingSvc = new AMap.Driving({ map: renderOnMap ? map : null });
    }
    return drivingSvc;
  }

  async function planRouteTo(it, opts){
    if (!it) throw new Error("target item is required");
    if (it.lng == null || it.lat == null) throw new Error("target has no coordinates");

    const options = Object.assign({
      mode: "driving",     // "driving" | "walking"
      from: null,          // {lng,lat} or null to use current position
      renderOnMap: false
    }, opts || {});

    const fromPos = options.from || await getCurrentPosition();
    const toPos = { lng: it.lng, lat: it.lat };
    const cfg = loadCfg();
    const restKey = (cfg.amapRestKey || "").trim();
    if (!restKey){
      throw new Error("AMap REST key missing");
    }

    const isWalking = options.mode === "walking";
    const endpoint = isWalking
      ? "https://restapi.amap.com/v3/direction/walking"
      : "https://restapi.amap.com/v3/direction/driving";

    const params = new URLSearchParams({
      key: restKey,
      origin: `${fromPos.lng},${fromPos.lat}`,
      destination: `${toPos.lng},${toPos.lat}`
    });
    if (!isWalking){
      params.set("strategy", "0");
      params.set("extensions", "base");
    }

    const url = `${endpoint}?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (data && String(data.status) === "1"){
      return {
        from: fromPos,
        to: toPos,
        mode: options.mode,
        result: data,
        url
      };
    }

    const extra = {
      mode: options.mode,
      origin: [fromPos.lng, fromPos.lat],
      destination: [toPos.lng, toPos.lat],
      info: data && (data.info || data.infocode),
      raw: data || null
    };
    log("error", "Route planning failed (details)", JSON.stringify(extra));
    throw new Error((data && (data.info || data.infocode)) || "route planning failed");
  }

  function buildAmapNavUri(it, opts){
    if (!it) throw new Error("target item is required");
    if (it.lng == null || it.lat == null) throw new Error("target has no coordinates");
    const options = Object.assign({
      callnative: 0,       // 0: web, 1: try open app
      mode: "drive"        // drive | walk | bus | ride
    }, opts || {});
    const name = encodeURIComponent(it.name || "target");
    const location = `${it.lng},${it.lat}`;
    return `https://uri.amap.com/navigation?to=${location},${name}&mode=${encodeURIComponent(options.mode)}&callnative=${options.callnative}`;
  }

  function openAmapNav(it, opts){
    const url = buildAmapNavUri(it, opts);
    window.open(url, "_blank");
    return url;
  }

  function isMobile(){
    const ua = navigator.userAgent || "";
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  }
  function isIOS(){
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua);
  }
  function isAndroid(){
    const ua = navigator.userAgent || "";
    return /Android/i.test(ua);
  }

  function mapNavMode(mode){
    if (mode === "walking") return "walk";
    if (mode === "driving") return "drive";
    return "drive";
  }
  function buildAmapIOSScheme(it, opts){
    const options = Object.assign({
      mode: "driving"
    }, opts || {});
    const name = encodeURIComponent(it.name || "destination");
    const style = options.mode === "walking" ? 2 : 2;
    // Official iOS navigation scheme: iosamap://navi?sourceApplication=...&poiname=...&lat=...&lon=...&dev=0&style=2
    return `iosamap://navi?sourceApplication=street_food_map&poiname=${name}&lat=${encodeURIComponent(it.lat)}&lon=${encodeURIComponent(it.lng)}&dev=0&style=${style}`;
  }

  function openAmapIOS(it, opts){
    const url = buildAmapIOSScheme(it, opts);
    location.href = url;
    return url;
  }

  function buildAmapAndroidScheme(it, opts){
    const options = Object.assign({
      mode: "driving"
    }, opts || {});
    const t = options.mode === "walking" ? 2 : 0; // 0 driving, 2 walking
    const name = encodeURIComponent(it.name || "destination");
    // androidamap://route?sourceApplication=app&dlat=..&dlon=..&dname=..&dev=0&t=0
    return `androidamap://route?sourceApplication=street_food_map&dlat=${encodeURIComponent(it.lat)}&dlon=${encodeURIComponent(it.lng)}&dname=${name}&dev=0&t=${t}`;
  }

  function openAmapAndroid(it, opts){
    const url = buildAmapAndroidScheme(it, opts);
    location.href = url;
    return url;
  }

  function clearRouteLine(){
    if (routeLine){
      routeLine.setMap(null);
      routeLine = null;
    }
  }

  function parsePolyline(polyline){
    if (!polyline) return [];
    return polyline.split(";").map(p => {
      const [lng, lat] = p.split(",").map(Number);
      return [lng, lat];
    }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }

  function drawRouteLine(points){
    clearRouteLine();
    if (!map || !points.length) return;
    routeLine = new AMap.Polyline({
      path: points,
      strokeColor: "#2563eb",
      strokeOpacity: 0.9,
      strokeWeight: 6
    });
    routeLine.setMap(map);
    map.setFitView([routeLine]);
  }

  async function renderRouteTo(it, opts){
    if (!it) throw new Error("target item is required");
    if (!map) initMap();
    const options = Object.assign({
      mode: "driving"
    }, opts || {});
    const res = await planRouteTo(it, {
      mode: options.mode,
      renderOnMap: false
    });

    const data = res && res.result;
    const steps = data && data.route && data.route.paths && data.route.paths[0] && data.route.paths[0].steps;
    const points = [];
    if (Array.isArray(steps)){
      for (const s of steps){
        if (s && s.polyline){
          points.push(...parsePolyline(s.polyline));
        }
      }
    }
    drawRouteLine(points);
    focusItem(it);
    return res;
  }

  function openRouteTo(id, opts){
    const it = allItems.find(x => String(x.id) === String(id));
    if (!it){
      log("warn", "Navigation target not found", id);
      return;
    }
    const options = Object.assign({ mode: "driving" }, opts || {});
    if (isMobile() && (isIOS() || isAndroid())){
      try{
        if (isIOS()){
          openAmapIOS(it, options);
        }else{
          openAmapAndroid(it, options);
        }
      }catch (e){
        log("error", "Failed to open AMap", errToStr(e));
        alert("Failed to open AMap: " + toCNMsg(e));
      }
      return;
    }
    renderRouteTo(it, options).catch((e) => {
      log("error", "Route planning failed", errToStr(e));
      alert("Route planning failed: " + toCNMsg(e));
    });
  }

  // Expose backend helpers for future UI wiring
  window.__sfm_nav = {
    getCurrentPosition,
    planRouteTo,
    buildAmapNavUri,
    openAmapNav,
    renderRouteTo,
    openRouteTo
  };

  /**********************
   * 5) Data layer: Supabase REST (fallback kb.json) + local editable store
   **********************/
  let allItems = [];
  let selectedId = null;
  let editMode = "none"; // none | new | edit

  function normRow(r){
    return {
      id: String(r.id ?? crypto.randomUUID()),
      name: r.name || "",
      city: r.city || "",
      address: r.address || "",
      category: r.category || "",
      lng: (r.lng === null || r.lng === undefined || r.lng === "") ? null : Number(r.lng),
      lat: (r.lat === null || r.lat === undefined || r.lat === "") ? null : Number(r.lat),
      updatedAt: r.updated_at || r.updatedAt || null
    };
  }

  function loadLocalDB(){
    try{
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || !Array.isArray(obj.items)) return null;
      const items = obj.items.map(normRow);
      return { version: obj.version ?? 1, items };
    }catch{
      return null;
    }
  }

  function saveLocalDB(items, modeLabel){
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      mode: modeLabel || "",
      items: (items || []).map(it => ({
        id: it.id,
        name: it.name,
        city: it.city,
        address: it.address,
        category: it.category,
        lng: it.lng,
        lat: it.lat,
        updatedAt: it.updatedAt || null
      }))
    };
    localStorage.setItem(DB_KEY, JSON.stringify(payload));
  }

  function clearLocalDB(){
    localStorage.removeItem(DB_KEY);
  }

  async function loadFromSupabase(){
    const base = SUPABASE_URL;
    const anon = SUPABASE_ANON_KEY;

    if (!base || !base.includes(".supabase.co")){
      log("warn", "Supabase URL missing/invalid, skip remote load");
      return null;
    }
    if (!anon || !anon.startsWith("eyJ")){
      log("warn", "Supabase anon key missing/invalid (must be anon public key: eyJ...), skip remote load");
      return null;
    }

    const url = `${base.replace(/\/$/,"")}/rest/v1/places?select=*`;
    log("info", "Start remote fetch: places", url);

    const t0 = performance.now();
    showLoading("正在加载数据...");
    const res = await fetch(url, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: "no-store"
    }).catch(e => {
      log("error", "Fetch failed", errToStr(e));
      return null;
    });
    hideLoading();
    if (!res) return null;

    const t1 = performance.now();
    log("info", "Remote request completed", `status=${res.status} cost=${Math.round(t1-t0)}ms`);

    if (!res.ok){
      const txt = await res.text().catch(()=> "");
      log("error", "Remote response not 2xx", txt || `HTTP ${res.status}`);
      return null;
    }

    const data = await res.json().catch(e => {
      log("error", "JSON parse failed", errToStr(e));
      return null;
    });
    if (!Array.isArray(data)){
      log("error", "Remote response is not an array", JSON.stringify(data).slice(0, 500));
      return null;
    }

    log("info", "Remote data count", String(data.length));
    return data.map(normRow);
  }

  async function supaRequest(method, path, body){
    const base = SUPABASE_URL.replace(/\/$/,"");
    const anon = SUPABASE_ANON_KEY;
    const url = `${base}${path}`;
    const headers = {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok){
      const txt = await res.text().catch(()=> "");
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const data = await res.json().catch(()=> null);
    return data;
  }


  async function bootLoadData(opts){
    const preferLocal = !!(opts && opts.preferLocal);

    if (preferLocal){
      const local = loadLocalDB();
      if (local && Array.isArray(local.items) && local.items.length){
        allItems = local.items;
        log("info", "Using local edited data", `count=${allItems.length}`);
        renderCity(allItems);
        renderCat(allItems);
        applyFilter();
        syncEditorSelection(null);
        return;
      }
      log("warn", "Local edited data is empty: please reload remote or import kb.json before editing");
    }

    const remote = await loadFromSupabase();
    allItems = remote;
    renderCity(allItems);
    renderCat(allItems);
    applyFilter();
    syncEditorSelection(null);
  }

  /**********************
   * 6) Render / filter
   **********************/
  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
  }

  function renderCity(items){
    const sel = document.getElementById("city");
    if (!sel) return;
    const counts = new Map();
    for (const it of items || []) {
      const c = (it.city || "").trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const cities = Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "zh"));
    sel.innerHTML =
      `<option value="">全部城市 (${items?.length || 0})</option>` +
      cities.map(([c, n]) => `<option value="${escapeHtml(c)}">${escapeHtml(c)} (${n})</option>`).join("");
    // default Chengdu if exists
    const defaultCity = "成都";
    if (cities.some(([c]) => c === defaultCity)){
      sel.value = defaultCity;
    }
  }

  function renderCat(items){
    const sel = document.getElementById("cat");
    const city = (document.getElementById("city")?.value || "").trim();
    const list = city ? (items || []).filter(it => (it.city || "").trim() === city) : (items || []);
    const counts = new Map();
    for (const it of list) {
      const c = (it.category || "").trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const cats = Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "zh"));
    sel.innerHTML =
      `<option value="">全部分类 (${list.length || 0})</option>` +
      cats.map(([c, n]) => `<option value="${escapeHtml(c)}">${escapeHtml(c)} (${n})</option>`).join("");
  }

  function renderList(items){
    const list = document.getElementById("list");
    if (!items.length){
      list.innerHTML = `<div class="item"><div class="name">No data</div><div class="meta">Check settings: Supabase Key / RLS / Network</div></div>`;
      return;
    }
    list.innerHTML = items.map(it => {
      const title = escapeHtml(it.name || "(Unnamed)");
      const cat = it.category ? `<span class="badge">${escapeHtml(it.category)}</span>` : "";
      const addr = escapeHtml([it.city, it.address].filter(Boolean).join(" ")) || "(No address)";
      const hasCoords = (it.lng != null && it.lat != null);
      const loc = hasCoords ? "Located" : "<span class='warn'>No coordinates</span>";
      const active = (String(it.id) === String(selectedId)) ? " style='background:#f7f7ff;'" : "";
      return `
        <div class="item" data-id="${escapeHtml(it.id)}"${active}>
          <div class="name">${title}${cat}</div>
          <div class="meta">${addr}<br/>${loc}</div>
          ${hasCoords ? `<div class="row" style="margin-top:6px;">
            <button class="btn nav-btn" data-id="${escapeHtml(it.id)}">出发</button>
          </div>` : ""}
        </div>
      `;
    }).join("");

    list.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const id = btn.getAttribute("data-id");
        openRouteTo(id);
      });
    });

    list.querySelectorAll(".item").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        const it = allItems.find(x => String(x.id) === String(id));
        if (!it){
          log("warn", "Clicked item not found", id);
          return;
        }
        selectedId = String(it.id);
        syncEditorSelection(selectedId);
        renderList(applyFilter({silent:true}));
        focusItem(it);
        log("info", "Focused item", `${it.id} ${it.name}`);
      });
    });
  }

   function applyFilter(opts){
    const silent = !!(opts && opts.silent);
    const q = (document.getElementById("q").value || "").trim().toLowerCase();
    const cat = (document.getElementById("cat").value || "").trim();
    const city = (document.getElementById("city")?.value || "").trim();

    const filtered = allItems.filter(it => {
      if (city && it.city !== city) return false;
      if (cat && it.category !== cat) return false;
      if (!q) return true;
      const hay = `${it.name} ${it.city} ${it.address} ${it.category}`.toLowerCase();
      return hay.includes(q);
    });

    clearMarkers();
    for (const it of filtered) addMarker(it);
    renderList(filtered);

    if (!silent){
      log("debug", "Filter done", `q=\"${q}\", cat=\"${cat}\", count=${filtered.length}`);
    }
    return filtered;
  }

  const qEl = document.getElementById("q");
  const qClearEl = document.getElementById("qClear");
  function syncQClear(){
    if (!qClearEl) return;
    qClearEl.style.display = (qEl && qEl.value) ? "block" : "none";
  }

  qEl.addEventListener("input", () => {
    clearTimeout(window.__sfm_q_t);
    window.__sfm_q_t = setTimeout(() => applyFilter(), 120);
    syncQClear();
  });
  if (qClearEl){
    qClearEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      qEl.value = "";
      syncQClear();
      applyFilter();
      qEl.focus();
    });
  }
  syncQClear();
  document.getElementById("cat").addEventListener("change", () => applyFilter());
  document.getElementById("city")?.addEventListener("change", () => {
    // Update category list based on selected city
    renderCat(allItems);
    // Reset category if it no longer exists
    if (!(document.getElementById("cat")?.value || "")) {
      // already reset
    }
    applyFilter();
  });

  /**********************
   * 7) Manage panel (CRUD + relocate)
   **********************/
  const fName = document.getElementById("fName");
  const fCategory = document.getElementById("fCategory");
  const fCity = document.getElementById("fCity");
  const fAddress = document.getElementById("fAddress");
  const fLng = document.getElementById("fLng");
  const fLat = document.getElementById("fLat");
  const editHint = document.getElementById("editHint");
  const btnDelete = document.getElementById("btnDelete");
  const btnRelocate = document.getElementById("btnRelocate");

  function setEditHint(html, tone){
       editHint.innerHTML = html || "";
       editHint.classList.remove("is-success", "is-error", "is-warn");
           if (tone === "success") editHint.classList.add("is-success");
              else if (tone === "error") editHint.classList.add("is-error");
                  else if (tone === "warn") editHint.classList.add("is-warn");
                  }
  function updateActionButtons(){
    const hasSelected = !!selectedId;
    if (btnDelete) btnDelete.disabled = !hasSelected;
    const hasAddr = !!(fAddress.value || "").trim();
    const showRelocate = (editMode === "new" || editMode === "edit");
    if (btnRelocate){
      btnRelocate.style.display = showRelocate ? "" : "none";
      btnRelocate.textContent = (editMode === "new") ? "定位" : "重新定位";
      btnRelocate.disabled = !hasAddr;
    }
  }

  function getEditingItemFromForm(){
    return {
      name: (fName.value || "").trim(),
      category: (fCategory.value || "").trim(),
      city: (fCity.value || "").trim(),
      address: (fAddress.value || "").trim(),
      lng: (fLng.value || "").trim(),
      lat: (fLat.value || "").trim()
    };
  }
  function setFormFromItem(it){
    fName.value = it?.name || "";
    fCategory.value = it?.category || "";
    fCity.value = it?.city || "";
    fAddress.value = it?.address || "";
    fLng.value = (it?.lng == null ? "" : String(it.lng));
    fLat.value = (it?.lat == null ? "" : String(it.lat));
  }

  function syncEditorSelection(id, modeOverride){
    selectedId = id ? String(id) : null;
    const it = selectedId ? allItems.find(x => String(x.id) === String(selectedId)) : null;
    if (it){
      editMode = "edit";
      setFormFromItem(it);
      setEditHint(`Editing: <b>${escapeHtml(it.name || "(Unnamed)")}</b> (id=${escapeHtml(it.id)})`, "info");
    }else{
      editMode = modeOverride || "none";
      setFormFromItem({name:"",category:"",city:"",address:"",lng:"",lat:""});
      setEditHint("Editing: <span class='warn'>None selected</span> (click a list item to edit, or click New)", "warn");
    }
    updateActionButtons();
  }

  function upsertLocalAndRerender(){
    saveLocalDB(allItems, "edited");
    renderCity(allItems);
    renderCat(allItems);
    applyFilter();
  }

  document.getElementById("btnNew").addEventListener("click", () => {
    selectedId = null;
    syncEditorSelection(null, "new");
    setEditHint("New item mode: fill in then click Save", "info");
    fName.focus();
  });
  fAddress.addEventListener("input", updateActionButtons);

  document.getElementById("btnSaveItem").addEventListener("click", async () => {
    const form = getEditingItemFromForm();
    if (!form.name){
      setEditHint("<span class='err'>Name is required</span>", "error");
      log("warn", "Save failed: name required");
      return;
    }
    const lng = form.lng === "" ? null : Number(form.lng);
    const lat = form.lat === "" ? null : Number(form.lat);
    if ((form.lng !== "" && Number.isNaN(lng)) || (form.lat !== "" && Number.isNaN(lat))){
      setEditHint("<span class='err'>lng/lat must be numbers or empty</span>", "error");
      log("warn", "Save failed: lng/lat invalid");
      return;
    }

    try{
      showLoading("正在保存...");
      if (selectedId){
        const idx = allItems.findIndex(x => String(x.id) === String(selectedId));
        if (idx < 0){
          setEditHint("<span class='err'>Item to edit not found</span>", "error");
          hideLoading();
          return;
        }
        const payload = {
          name: form.name,
          category: form.category,
          city: form.city,
          address: form.address,
          lng, lat,
          updated_at: new Date().toISOString()
        };
        const data = await supaRequest(
          "PATCH",
          `/rest/v1/places?id=eq.${encodeURIComponent(selectedId)}`,
          payload
        );
        const updated = Array.isArray(data) && data[0] ? normRow(data[0]) : { ...allItems[idx], ...payload };
        allItems[idx] = updated;
        log("info", "Saved item", `${allItems[idx].id} ${allItems[idx].name}`);
      }else{
        const it = {
          id: crypto.randomUUID(),
          name: form.name, category: form.category, city: form.city, address: form.address,
          lng, lat, updated_at: new Date().toISOString()
        };
        const data = await supaRequest("POST", "/rest/v1/places", [it]);
        const created = Array.isArray(data) && data[0] ? normRow(data[0]) : normRow(it);
        allItems.unshift(created);
        selectedId = String(created.id);
        log("info", "Added item", `${created.id} ${created.name}`);
      }

      upsertLocalAndRerender();
      syncEditorSelection(selectedId);
      const it2 = selectedId ? allItems.find(x => String(x.id) === String(selectedId)) : null;
      if (it2) focusItem(it2);
      setEditHint("Saved to database", "success");
    }catch (e){
      log("error", "Save to database failed", errToStr(e));
      setEditHint(`<span class='err'>Save failed</span>: ${escapeHtml(errToStr(e)).slice(0,200)}`, "error");
    }finally{
      hideLoading();
    }

  });

  document.getElementById("btnDelete").addEventListener("click", async () => {
    if (!selectedId){
      setEditHint("<span class='warn'>No item selected, cannot delete</span>", "warn");
      return;
    }
    const it = allItems.find(x => String(x.id) === String(selectedId));
    if (!it) return;

    const ok = confirm(`Delete ${it.name || "(Unnamed)"}?`);
    if (!ok) return;

    try{
      showLoading("正在删除...");
      await supaRequest("DELETE", `/rest/v1/places?id=eq.${encodeURIComponent(selectedId)}`);
      allItems = allItems.filter(x => String(x.id) !== String(selectedId));
      log("warn", "Deleted item", `${selectedId}`);
      selectedId = null;
      upsertLocalAndRerender();
      syncEditorSelection(null);
      setEditHint("Deleted from database", "success");
    }catch (e){
      log("error", "Delete failed", errToStr(e));
      setEditHint(`<span class='err'>Delete failed</span>: ${escapeHtml(errToStr(e)).slice(0,200)}`, "error");
    }finally{
      hideLoading();
    }
  });

  async function geocodeAddress(fullAddr){
    const cfg = loadCfg();
    const restKey = (cfg.amapRestKey || "").trim();
    if (!restKey) throw new Error("AMap REST key missing");
    const params = new URLSearchParams({
      key: restKey,
      address: fullAddr || "",
      city: "Nationwide"
    });
    const url = `https://restapi.amap.com/v3/geocode/geo?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (data && String(data.status) === "1" && Array.isArray(data.geocodes) && data.geocodes.length){
      const loc = data.geocodes[0].location;
      const [lng, lat] = (loc || "").split(",").map(Number);
      if (Number.isFinite(lng) && Number.isFinite(lat)){
        return { lng, lat };
      }
    }
    throw new Error("Geocoding failed: " + (data.info || data.infocode || "unknown"));
  }

  document.getElementById("btnRelocate").addEventListener("click", async () => {
    try{
      const form = getEditingItemFromForm();
      const addr = [form.city, form.address].filter(Boolean).join(" ").trim();
      if (!addr){
        setEditHint("<span class='err'>City/address is empty, cannot locate</span>", "error");
        return;
      }
      if (!window.AMap){
        setEditHint("<span class='err'>Map not loaded (AMap not ready)</span>", "error");
        return;
      }

      showLoading(editMode === "new" ? "正在新增定位..." : "正在重新定位...");
      setEditHint("Locating...");
      const loc = await geocodeAddress(addr);

      if (selectedId){
        const idx = allItems.findIndex(x => String(x.id) === String(selectedId));
        if (idx < 0){
          setEditHint("<span class='err'>Item not found</span>", "error");
          return;
        }
        const it = allItems[idx];
        const payload = { lng: loc.lng, lat: loc.lat, updated_at: new Date().toISOString() };
        // update database first
        await supaRequest(
          "PATCH",
          `/rest/v1/places?id=eq.${encodeURIComponent(it.id)}`,
          payload
        );
        allItems[idx] = { ...it, ...payload };
        upsertLocalAndRerender();
        syncEditorSelection(selectedId);
        const it2 = allItems[idx];
        focusItem(it2);
        log("info", "Relocate succeeded", `${it2.name} @ ${loc.lng},${loc.lat}`);
        setEditHint(`Relocated: <b>${escapeHtml(it2.name)}</b>`, "success");
      }else{
        fLng.value = String(loc.lng);
        fLat.value = String(loc.lat);
        updateActionButtons();
        log("info", "Locate succeeded (new item)", `${loc.lng},${loc.lat}`);
        setEditHint("定位成功：已填入经纬度", "success");
      }
    }catch(e){
      log("error", "Relocate failed", errToStr(e));
      setEditHint(`<span class='err'>Relocate failed</span>: ${escapeHtml(errToStr(e)).slice(0,200)}`, "error");
    }finally{
      hideLoading();
    }
  });


  /**********************
   * 8) Boot
   **********************/
  (async function main(){
    // No settings UI to render for Supabase

    log("info", "Page started");

    const ok = await ensureAMapLoaded(false);
    if (ok){
      initMap();
    }else{
      log("warn", "Map failed to load, but the list is still available. Check the AMap key in Settings.");
    }

    // Mobile: auto locate and show current position
    try{
      if (isMobile()){
        const pos = await getCurrentPosition();
        setUserMarker(pos);
        //if (map) map.setZoomAndCenter(14, [pos.lng, pos.lat], true);
      }
    }catch (e){
      log("warn", "Auto locate failed", errToStr(e));
    }

    await bootLoadData({ forceRemote: true });
    syncEditorSelection(null);
  })();

})();

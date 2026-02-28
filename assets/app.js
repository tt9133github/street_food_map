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
  const RUNTIME_CFG = (window.APP_CONFIG && typeof window.APP_CONFIG === "object")
    ? window.APP_CONFIG
    : {};

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
    if (!msg) return "未知错误";
    if (msg.includes("permission") || msg.includes("denied") || msg.includes("secure origin")){
      return "定位权限被拒绝，或页面非 HTTPS，无法获取定位";
    }
    if (msg.includes("timeout")){
      return "定位超时，请检查网络后重试";
    }
    if (msg.includes("amap not ready")){
      return "高德地图未就绪，请检查 Key 或网络";
    }
    if (msg.includes("no coordinates")){
      return "该地点没有坐标，无法规划路线";
    }
    if (msg.includes("invalid_userkey") || msg.includes("key")){
      return "高德 Key 无效或权限不足";
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
  window.addEventListener("error", (ev) => log("error", "窗口错误", `${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}`));
  window.addEventListener("unhandledrejection", (ev) => log("error", "未处理的Promise拒绝", errToStr(ev.reason)));

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
    log("info", "日志级别已修改", currentLevel);
  });
  document.getElementById("btnClearLog").addEventListener("click", () => {
    document.getElementById("logs").textContent = "";
    log("info", "日志已清空");
  });
  document.getElementById("btnCopyLog").addEventListener("click", async () => {
    const text = document.getElementById("logs").textContent || "";
    try{
      await navigator.clipboard.writeText(text);
      log("info", "日志已复制到剪贴板");
    }catch(e){
      log("warn", "复制失败（浏览器限制）", errToStr(e));
    }
  });

  /**********************
   * 3) Config (default + local override)
   **********************/
  const DEFAULT_CFG = {
    supabaseUrl: RUNTIME_CFG.supabaseUrl || "",
    supabaseAnonKey: RUNTIME_CFG.supabaseAnonKey || "",
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
      log("error", "未配置高德 Key，地图无法加载，请在设置中填写");
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

      log("info", "正在加载高德地图脚本…");
      const s = document.createElement("script");
      s.dataset.amap = "1";
      const scodeParam = scode ? `&securityjscode=${encodeURIComponent(scode)}` : "";
      s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}${scodeParam}&plugin=AMap.Geocoder,AMap.Geolocation,AMap.Driving,AMap.Walking`;
      s.async = true;
      s.onload = () => { log("info", "高德脚本加载完成"); resolve(true); };
      s.onerror = () => { log("error", "高德脚本加载失败（检查 Key / 网络 / 域名白名单）"); resolve(false); };
      document.head.appendChild(s);
    });

    return amapLoading;
  }

  function initMap(){
    if (!window.AMap){
      log("error", "高德未就绪，初始化地图取消");
      return;
    }
    const center = [104.0668, 30.5728];
    map = new AMap.Map("map", {
      zoom: 12,
      center,
      viewMode: "2D"
    });
    log("info", "地图已初始化", `center=${center.join(",")}`);
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
      title: it.name || "（未命名）"
    });
    m.setMap(map);
    m.on("click", () => {
      const title = (it.name || "（未命名）") + (it.category ? ` / ${it.category}` : "");
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
        title: "当前位置",
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
    if (!ok || !window.AMap) throw new Error("高德未就绪");

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
    if (!it) throw new Error("需要目标地点");
    if (it.lng == null || it.lat == null) throw new Error("目标地点没有坐标");

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
      throw new Error("高德 REST Key 缺失");
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
    log("error", "路线规划失败（详情）", JSON.stringify(extra));
    throw new Error((data && (data.info || data.infocode)) || "路线规划失败");
  }

  function buildAmapNavUri(it, opts){
    if (!it) throw new Error("需要目标地点");
    if (it.lng == null || it.lat == null) throw new Error("目标地点没有坐标");
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
    if (!it) throw new Error("需要目标地点");
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
      log("warn", "未找到导航目标", id);
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
        log("error", "打开高德失败", errToStr(e));
        alert("打开高德失败：" + toCNMsg(e));
      }
      return;
    }
    renderRouteTo(it, options).catch((e) => {
      log("error", "路线规划失败", errToStr(e));
      alert("路线规划失败：" + toCNMsg(e));
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
    const cfg = loadCfg();
    const base = (cfg.supabaseUrl || "").trim();
    const anon = (cfg.supabaseAnonKey || "").trim();

    if (!base || !base.includes(".supabase.co")){
      log("warn", "Supabase URL 缺失或无效，跳过远程加载");
      return null;
    }
    if (!anon || !anon.startsWith("eyJ")){
      log("warn", "Supabase anon key 缺失或无效（应为 eyJ 开头公钥），跳过远程加载");
      return null;
    }

    const url = `${base.replace(/\/$/,"")}/rest/v1/places?select=*`;
    log("info", "开始远程拉取：places", url);

    const t0 = performance.now();
    showLoading("正在加载数据...");
    const res = await fetch(url, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: "no-store"
    }).catch(e => {
      log("error", "请求失败", errToStr(e));
      return null;
    });
    hideLoading();
    if (!res) return null;

    const t1 = performance.now();
    log("info", "远程请求完成", `status=${res.status} cost=${Math.round(t1-t0)}ms`);

    if (!res.ok){
      const txt = await res.text().catch(()=> "");
      log("error", "远程响应非 2xx", txt || `HTTP ${res.status}`);
      return null;
    }

    const data = await res.json().catch(e => {
      log("error", "JSON 解析失败", errToStr(e));
      return null;
    });
    if (!Array.isArray(data)){
      log("error", "远程响应不是数组", JSON.stringify(data).slice(0, 500));
      return null;
    }

    log("info", "远程数据数量", String(data.length));
    return data.map(normRow);
  }

  async function supaRequest(method, path, body){
    const cfg = loadCfg();
    const base = (cfg.supabaseUrl || "").trim().replace(/\/$/,"");
    const anon = (cfg.supabaseAnonKey || "").trim();
    if (!base || !anon){
      throw new Error("Supabase 配置缺失");
    }
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
        log("info", "使用本地编辑数据", `count=${allItems.length}`);
        renderCity(allItems);
        renderCat(allItems);
        applyFilter();
        syncEditorSelection(null);
        return;
      }
      log("warn", "本地编辑数据为空：请先重新加载远程数据或导入 kb.json 再编辑");
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
      list.innerHTML = `<div class="item"><div class="name">暂无数据</div><div class="meta">请检查设置：Supabase Key / RLS / 网络</div></div>`;
      return;
    }
    list.innerHTML = items.map(it => {
      const title = escapeHtml(it.name || "（未命名）");
      const cat = it.category ? `<span class="badge">${escapeHtml(it.category)}</span>` : "";
      const addr = escapeHtml([it.city, it.address].filter(Boolean).join(" ")) || "（无地址）";
      const hasCoords = (it.lng != null && it.lat != null);
      const loc = hasCoords ? "已定位" : "<span class='warn'>无坐标</span>";
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
          log("warn", "点击的条目未找到", id);
          return;
        }
        selectedId = String(it.id);
        syncEditorSelection(selectedId);
        renderList(applyFilter({silent:true}));
        focusItem(it);
        log("info", "已聚焦条目", `${it.id} ${it.name}`);
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
      log("debug", "筛选完成", `q=\"${q}\", cat=\"${cat}\", count=${filtered.length}`);
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
      setEditHint(`正在编辑：<b>${escapeHtml(it.name || "（未命名）")}</b>（id=${escapeHtml(it.id)}）`, "info");
    }else{
      editMode = modeOverride || "none";
      setFormFromItem({name:"",category:"",city:"",address:"",lng:"",lat:""});
      setEditHint("正在编辑：<span class='warn'>未选择</span>（点击列表项编辑，或点击新增）", "warn");
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
    setEditHint("新增模式：填写后点击保存", "info");
    fName.focus();
  });
  fAddress.addEventListener("input", updateActionButtons);

  document.getElementById("btnSaveItem").addEventListener("click", async () => {
    const form = getEditingItemFromForm();
    if (!form.name){
      setEditHint("<span class='err'>店名必填</span>", "error");
      log("warn", "保存失败：店名必填");
      return;
    }
    const lng = form.lng === "" ? null : Number(form.lng);
    const lat = form.lat === "" ? null : Number(form.lat);
    if ((form.lng !== "" && Number.isNaN(lng)) || (form.lat !== "" && Number.isNaN(lat))){
      setEditHint("<span class='err'>经纬度必须为数字或留空</span>", "error");
      log("warn", "保存失败：经纬度无效");
      return;
    }

    try{
      showLoading("正在保存…");
      if (selectedId){
        const idx = allItems.findIndex(x => String(x.id) === String(selectedId));
        if (idx < 0){
          setEditHint("<span class='err'>未找到要编辑的条目</span>", "error");
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
        log("info", "已保存条目", `${allItems[idx].id} ${allItems[idx].name}`);
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
        log("info", "已新增条目", `${created.id} ${created.name}`);
      }

      upsertLocalAndRerender();
      syncEditorSelection(selectedId);
      const it2 = selectedId ? allItems.find(x => String(x.id) === String(selectedId)) : null;
      if (it2) focusItem(it2);
      setEditHint("已保存到数据库", "success");
    }catch (e){
      log("error", "保存到数据库失败", errToStr(e));
      setEditHint(`<span class='err'>保存失败</span>: ${escapeHtml(errToStr(e)).slice(0,200)}`, "error");
    }finally{
      hideLoading();
    }

  });

  document.getElementById("btnDelete").addEventListener("click", async () => {
    if (!selectedId){
      setEditHint("<span class='warn'>未选择条目，无法删除</span>", "warn");
      return;
    }
    const it = allItems.find(x => String(x.id) === String(selectedId));
    if (!it) return;

    const ok = confirm(`确认删除 ${it.name || "（未命名）"}？`);
    if (!ok) return;

    try{
      showLoading("正在删除…");
      await supaRequest("DELETE", `/rest/v1/places?id=eq.${encodeURIComponent(selectedId)}`);
      allItems = allItems.filter(x => String(x.id) !== String(selectedId));
      log("warn", "已删除条目", `${selectedId}`);
      selectedId = null;
      upsertLocalAndRerender();
      syncEditorSelection(null);
      setEditHint("已从数据库删除", "success");
    }catch (e){
      log("error", "删除失败", errToStr(e));
      setEditHint(`<span class='err'>删除失败</span>: ${escapeHtml(errToStr(e)).slice(0,200)}`, "error");
    }finally{
      hideLoading();
    }
  });

  async function geocodeAddress(fullAddr){
    const cfg = loadCfg();
    const restKey = (cfg.amapRestKey || "").trim();
    if (!restKey) throw new Error("高德 REST Key 缺失");
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
    throw new Error("地理编码失败：" + (data.info || data.infocode || "unknown"));
  }

  document.getElementById("btnRelocate").addEventListener("click", async () => {
    try{
      const form = getEditingItemFromForm();
      const addr = [form.city, form.address].filter(Boolean).join(" ").trim();
      if (!addr){
        setEditHint("<span class='err'>城市或地址为空，无法定位</span>", "error");
        return;
      }
      if (!window.AMap){
        setEditHint("<span class='err'>Map not loaded (高德未就绪)</span>", "error");
        return;
      }

      showLoading(editMode === "new" ? "正在定位…" : "正在重新定位…");
      setEditHint("正在定位…");
      const loc = await geocodeAddress(addr);

      if (selectedId){
        const idx = allItems.findIndex(x => String(x.id) === String(selectedId));
        if (idx < 0){
          setEditHint("<span class='err'>未找到条目</span>", "error");
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
        log("info", "重新定位成功", `${it2.name} @ ${loc.lng},${loc.lat}`);
        setEditHint(`已重新定位：<b>${escapeHtml(it2.name)}</b>`, "success");
      }else{
        fLng.value = String(loc.lng);
        fLat.value = String(loc.lat);
        updateActionButtons();
        log("info", "定位成功（新增）", `${loc.lng},${loc.lat}`);
        setEditHint("定位成功：已填入经纬度（保存后生效）", "success");
      }
    }catch(e){
      log("error", "重新定位失败", errToStr(e));
      setEditHint(`<span class='err'>重新定位失败</span>: ${escapeHtml(errToStr(e)).slice(0,200)}`, "error");
    }finally{
      hideLoading();
    }
  });


  /**********************
   * 8) Boot
   **********************/
  (async function main(){
    // No settings UI to render for Supabase

    log("info", "页面已启动");

    const ok = await ensureAMapLoaded(false);
    if (ok){
      initMap();
    }else{
      log("warn", "地图加载失败，但列表仍可用，请检查设置中的高德 Key");
    }

    // Mobile: auto locate and show current position
    try{
      if (isMobile()){
        const pos = await getCurrentPosition();
        setUserMarker(pos);
        //if (map) map.setZoomAndCenter(14, [pos.lng, pos.lat], true);
      }
    }catch (e){
      log("warn", "自动定位失败", errToStr(e));
    }

    await bootLoadData({ forceRemote: true });
    syncEditorSelection(null);
  })();

})();

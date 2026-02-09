/* street_food_map - split build (no bundler)
 * Features preserved:
 * - Supabase REST load (fallback kb.json)
 * - Local editable store (localStorage)
 * - CRUD: add/edit/delete
 * - Relocate via AMap.Geocoder
 * - Export/copy kb.json JSON
 * - Drawer + logs + mobile-friendly
 */

(() => {
  "use strict";

  /**********************
   * 0) Constants
   **********************/
  const CFG_KEY = "sfm_cfg_v1";
  const DB_KEY  = "sfm_db_v1"; // local editable dataset

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
      return "定位被拒绝或当前页面非 HTTPS，无法获取当前位置";
    }
    if (msg.includes("timeout")){
      return "定位超时，请检查网络或稍后重试";
    }
    if (msg.includes("amap not ready")){
      return "高德地图未就绪，请检查 Key 或网络";
    }
    if (msg.includes("no coordinates")){
      return "该店铺没有坐标，无法规划路线";
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

  function openDrawer(){ body.classList.add("open"); drawer.setAttribute("aria-hidden","false"); }
  function closeDrawer(){ body.classList.remove("open"); drawer.setAttribute("aria-hidden","true"); }

  fab.addEventListener("click", openDrawer);
  mask.addEventListener("click", closeDrawer);
  closeBtn.addEventListener("click", closeDrawer);

  const logLevelSel = document.getElementById("logLevel");
  logLevelSel.value = currentLevel;
  logLevelSel.addEventListener("change", () => {
    currentLevel = logLevelSel.value;
    localStorage.setItem("sfm_log_level", currentLevel);
    log("info", "日志级别切换", currentLevel);
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

  const sbUrlEl = document.getElementById("sbUrl");
  const sbAnonEl = document.getElementById("sbAnon");
  const sbHintEl = document.getElementById("sbHint");
  const amapKeyEl = document.getElementById("amapKey");
  const amapHintEl = document.getElementById("amapHint");
  const dataModeEl = document.getElementById("dataMode");

  function renderCfgToUI(){
    const cfg = loadCfg();
    sbUrlEl.value = cfg.supabaseUrl || "";
    sbAnonEl.value = cfg.supabaseAnonKey || "";
    amapKeyEl.value = cfg.amapKey || "";
    renderHints();
  }

  function renderHints(){
    const cfg = loadCfg();
    const urlOk = !!cfg.supabaseUrl && cfg.supabaseUrl.includes(".supabase.co");
    const anonOk = !!cfg.supabaseAnonKey && cfg.supabaseAnonKey.startsWith("eyJ");
    sbHintEl.innerHTML =
      `URL：${urlOk ? "OK" : "<span class='err'>缺失/不正确</span>"}；` +
      `anon key：${anonOk ? "OK" : "<span class='err'>请填 anon public key（eyJ...）</span>"}`;
    amapHintEl.innerHTML =
      `高德 Key：${cfg.amapKey ? "已配置" : "<span class='err'>未配置</span>"}`;
  }

  document.getElementById("btnSaveCfg").addEventListener("click", () => {
    const url = (sbUrlEl.value || "").trim();
    const anon = (sbAnonEl.value || "").trim();
    saveCfg({ supabaseUrl: url, supabaseAnonKey: anon });
    renderHints();
    log("info", "Supabase 配置已保存", url);
  });
  document.getElementById("btnSaveAmap").addEventListener("click", () => {
    const key = (amapKeyEl.value || "").trim();
    saveCfg({ amapKey: key });
    renderHints();
    log("info", "高德 Key 已保存");
  });

  /**********************
   * 4) AMap dynamic loader + map helpers
   **********************/
  let map = null;
  let markers = [];
  let amapLoading = null;

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
      log("error", "未配置高德 Key，地图无法加载。请在设置中填入。");
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

      log("info", "加载高德地图脚本…");
      const s = document.createElement("script");
      s.dataset.amap = "1";
      const scodeParam = scode ? `&securityjscode=${encodeURIComponent(scode)}` : "";
      s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}${scodeParam}&plugin=AMap.Geocoder,AMap.Geolocation,AMap.Driving,AMap.Walking`;
      s.async = true;
      s.onload = () => { log("info", "高德脚本加载成功"); resolve(true); };
      s.onerror = () => { log("error", "高德脚本加载失败（检查 key / 网络 / 域名白名单）"); resolve(false); };
      document.head.appendChild(s);
    });

    return amapLoading;
  }

  function initMap(){
    if (!window.AMap){
      log("error", "AMap 未就绪，initMap 取消");
      return;
    }
    const center = [104.0668, 30.5728];
    map = new AMap.Map("map", {
      zoom: 12,
      center,
      viewMode: "2D"
    });
    log("info", "地图初始化完成", `center=${center.join(",")}`);
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
      title: it.name || "(未命名)"
    });
    m.setMap(map);
    m.on("click", () => {
      const title = (it.name || "(未命名)") + (it.category ? ` / ${it.category}` : "");
      const addr = [it.city, it.address].filter(Boolean).join(" ");
      const navCall = `window.__sfm_nav.openRouteTo(${JSON.stringify(String(it.id))})`;
      const html = `<div style="font-size:13px;">
        <b>${escapeHtml(title)}</b><br/>
        ${escapeHtml(addr)}<br/>
        <button class="btn nav-btn" style="margin-top:6px;" onclick='${navCall}'>到这里去</button>
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
    log("error", "路线规划失败细节", JSON.stringify(extra));
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
    // 官方 iOS 导航：iosamap://navi?sourceApplication=...&poiname=...&lat=...&lon=...&dev=0&style=2
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
      log("warn", "导航目标不存在", id);
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
        log("error", "唤起高德失败", errToStr(e));
        alert("唤起高德失败：" + toCNMsg(e));
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
      log("warn", "Supabase URL 未配置/不正确，跳过远程加载");
      return null;
    }
    if (!anon || !anon.startsWith("eyJ")){
      log("warn", "Supabase anon key 未配置/不正确（必须 anon public key: eyJ...），跳过远程加载");
      return null;
    }

    const url = `${base.replace(/\/$/,"")}/rest/v1/places?select=*`;
    log("info", "开始远程拉取 places", url);

    const t0 = performance.now();
    const res = await fetch(url, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: "no-store"
    }).catch(e => {
      log("error", "fetch 失败", errToStr(e));
      return null;
    });
    if (!res) return null;

    const t1 = performance.now();
    log("info", "远程请求完成", `status=${res.status} cost=${Math.round(t1-t0)}ms`);

    if (!res.ok){
      const txt = await res.text().catch(()=> "");
      log("error", "远程返回非 2xx", txt || `HTTP ${res.status}`);
      return null;
    }

    const data = await res.json().catch(e => {
      log("error", "JSON 解析失败", errToStr(e));
      return null;
    });
    if (!Array.isArray(data)){
      log("error", "远程返回不是数组", JSON.stringify(data).slice(0, 500));
      return null;
    }

    log("info", "远程数据行数", String(data.length));
    return data.map(normRow);
  }

  async function loadFromLocalKb(){
    log("info", "回退读取本地 kb.json");
    try{
      const r = await fetch("./kb.json", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const kb = await r.json();
      const items = Array.isArray(kb.items) ? kb.items : [];
      const mapped = items.map(it => ({
        id: String(it.id ?? crypto.randomUUID()),
        name: it.name || "",
        city: it.city || "",
        address: it.address || "",
        category: it.category || "",
        lng: it?.location?.lng ?? null,
        lat: it?.location?.lat ?? null,
        updatedAt: it.updatedAt || null
      }));
      log("info", "本地数据行数", String(mapped.length));
      return mapped.map(normRow);
    }catch(e){
      log("error", "本地 kb.json 读取失败", errToStr(e));
      return [];
    }
  }

  function setDataMode(text){
    dataModeEl.textContent = text;
  }

  async function bootLoadData(opts){
    const forceRemote = !!(opts && opts.forceRemote);
    const preferLocal = !!(opts && opts.preferLocal);

    if (!forceRemote){
      const local = loadLocalDB();
      if (local && Array.isArray(local.items) && local.items.length){
        allItems = local.items;
        setDataMode("数据：本地编辑（已保存）");
        log("info", "使用本地编辑数据", `count=${allItems.length}`);
        renderCat(allItems);
        applyFilter();
        syncEditorSelection(null);
        return;
      }
    }

    if (preferLocal){
      setDataMode("数据：本地编辑（空）");
      log("warn", "本地编辑数据为空：请先重新加载远程或导入静态 kb.json 再编辑");
    }

    const remote = await loadFromSupabase();
    allItems = remote || await loadFromLocalKb();

    saveLocalDB(allItems, remote ? "supabase" : "kb.json");
    setDataMode(remote ? "数据：Supabase（已拉取→已缓存本地）" : "数据：kb.json（已缓存本地）");

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

  function renderCat(items){
    const sel = document.getElementById("cat");
    const counts = new Map();
    for (const it of items || []) {
      const c = (it.category || "").trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const cats = Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], "zh"));
    sel.innerHTML =
      `<option value="">全部品类 (${items?.length || 0})</option>` +
      cats.map(([c, n]) => `<option value="${escapeHtml(c)}">${escapeHtml(c)} (${n})</option>`).join("");
  }

  function renderList(items){
    const list = document.getElementById("list");
    if (!items.length){
      list.innerHTML = `<div class="item"><div class="name">没有数据</div><div class="meta">请检查设置里的 Supabase Key / RLS / 网络</div></div>`;
      return;
    }
    list.innerHTML = items.map(it => {
      const title = escapeHtml(it.name || "(未命名)");
      const cat = it.category ? `<span class="badge">${escapeHtml(it.category)}</span>` : "";
      const addr = escapeHtml([it.city, it.address].filter(Boolean).join(" ")) || "(无地址)";
      const loc = (it.lng != null && it.lat != null) ? "已定位" : "<span class='warn'>无坐标</span>";
      const active = (String(it.id) === String(selectedId)) ? " style='background:#f7f7ff;'" : "";
      return `
        <div class="item" data-id="${escapeHtml(it.id)}"${active}>
          <div class="name">${title}${cat}</div>
          <div class="meta">${addr}<br/>${loc}</div>
          <div class="row" style="margin-top:6px;">
            <button class="btn nav-btn" data-id="${escapeHtml(it.id)}">到这里去</button>
          </div>
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
          log("warn", "点击项不存在", id);
          return;
        }
        selectedId = String(it.id);
        syncEditorSelection(selectedId);
        renderList(applyFilter({silent:true}));
        focusItem(it);
        log("info", "定位到条目", `${it.id} ${it.name}`);
      });
    });
  }

   function applyFilter(opts){
    const silent = !!(opts && opts.silent);
    const q = (document.getElementById("q").value || "").trim().toLowerCase();
    const cat = (document.getElementById("cat").value || "").trim();

    const filtered = allItems.filter(it => {
      if (cat && it.category !== cat) return false;
      if (!q) return true;
      const hay = `${it.name} ${it.city} ${it.address} ${it.category}`.toLowerCase();
      return hay.includes(q);
    });

    clearMarkers();
    for (const it of filtered) addMarker(it);
    renderList(filtered);

    if (!silent){
      log("debug", "过滤完成", `q="${q}", cat="${cat}", count=${filtered.length}`);
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

  /**********************
   * 7) Manage panel (CRUD + relocate + export)
   **********************/
  const fName = document.getElementById("fName");
  const fCategory = document.getElementById("fCategory");
  const fCity = document.getElementById("fCity");
  const fAddress = document.getElementById("fAddress");
  const fLng = document.getElementById("fLng");
  const fLat = document.getElementById("fLat");
  const editHint = document.getElementById("editHint");
  const exportBox = document.getElementById("exportBox");

  function setEditHint(html){ editHint.innerHTML = html || ""; }

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

  function syncEditorSelection(id){
    selectedId = id ? String(id) : null;
    const it = selectedId ? allItems.find(x => String(x.id) === String(selectedId)) : null;
    if (it){
      setFormFromItem(it);
      setEditHint(`当前编辑：<b>${escapeHtml(it.name || "(未命名)")}</b>（id=${escapeHtml(it.id)}）`);
    }else{
      setFormFromItem({name:"",category:"",city:"",address:"",lng:"",lat:""});
      setEditHint("当前编辑：<span class='warn'>未选择</span>（点列表条目进入编辑，或点“新增”）");
    }
  }

  function upsertLocalAndRerender(){
    saveLocalDB(allItems, "edited");
    renderCat(allItems);
    applyFilter();
  }

  document.getElementById("btnNew").addEventListener("click", () => {
    selectedId = null;
    syncEditorSelection(null);
    setEditHint("新增模式：填写后点“保存”");
    fName.focus();
  });

  document.getElementById("btnSaveItem").addEventListener("click", () => {
    const form = getEditingItemFromForm();
    if (!form.name){
      setEditHint("<span class='err'>店名必填</span>");
      log("warn", "保存失败：店名必填");
      return;
    }
    const lng = form.lng === "" ? null : Number(form.lng);
    const lat = form.lat === "" ? null : Number(form.lat);
    if ((form.lng !== "" && Number.isNaN(lng)) || (form.lat !== "" && Number.isNaN(lat))){
      setEditHint("<span class='err'>lng/lat 必须是数字或留空</span>");
      log("warn", "保存失败：lng/lat 非数字");
      return;
    }

    if (selectedId){
      const idx = allItems.findIndex(x => String(x.id) === String(selectedId));
      if (idx < 0){
        setEditHint("<span class='err'>未找到要编辑的条目</span>");
        return;
      }
      allItems[idx] = { ...allItems[idx],
        name: form.name, category: form.category, city: form.city, address: form.address,
        lng, lat, updatedAt: new Date().toISOString()
      };
      log("info", "已保存编辑", `${allItems[idx].id} ${allItems[idx].name}`);
    }else{
      const it = {
        id: crypto.randomUUID(),
        name: form.name, category: form.category, city: form.city, address: form.address,
        lng, lat, updatedAt: new Date().toISOString()
      };
      allItems.unshift(it);
      selectedId = String(it.id);
      log("info", "已新增条目", `${it.id} ${it.name}`);
    }

    upsertLocalAndRerender();
    syncEditorSelection(selectedId);

    const it2 = selectedId ? allItems.find(x => String(x.id) === String(selectedId)) : null;
    if (it2) focusItem(it2);
  });

  document.getElementById("btnDelete").addEventListener("click", () => {
    if (!selectedId){
      setEditHint("<span class='warn'>未选择条目，无法删除</span>");
      return;
    }
    const it = allItems.find(x => String(x.id) === String(selectedId));
    if (!it) return;

    const ok = confirm(`确认删除：${it.name || "(未命名)"} ?`);
    if (!ok) return;

    allItems = allItems.filter(x => String(x.id) !== String(selectedId));
    log("warn", "已删除条目", `${selectedId}`);
    selectedId = null;
    upsertLocalAndRerender();
    syncEditorSelection(null);
  });

  async function geocodeAddress(fullAddr){
    if (!window.AMap) throw new Error("AMap 未就绪");
    return new Promise((resolve, reject) => {
      try{
        const geocoder = new AMap.Geocoder({ city: "全国" });
        geocoder.getLocation(fullAddr, (status, result) => {
          if (status === "complete" && result && result.geocodes && result.geocodes.length){
            const loc = result.geocodes[0].location;
            resolve({ lng: loc.lng, lat: loc.lat });
          }else{
            reject(new Error("地理编码失败：" + (result?.info || status || "unknown")));
          }
        });
      }catch(e){
        reject(e);
      }
    });
  }

  document.getElementById("btnRelocate").addEventListener("click", async () => {
    try{
      if (!selectedId){
        setEditHint("<span class='warn'>请先在列表选择一条，再重新定位</span>");
        return;
      }
      const idx = allItems.findIndex(x => String(x.id) === String(selectedId));
      if (idx < 0){
        setEditHint("<span class='err'>未找到该条目</span>");
        return;
      }
      const it = allItems[idx];
      const addr = [it.city, it.address].filter(Boolean).join(" ").trim();
      if (!addr){
        setEditHint("<span class='err'>城市/地址为空，无法定位</span>");
        return;
      }
      if (!window.AMap){
        setEditHint("<span class='err'>地图未加载（AMap 未就绪）</span>");
        return;
      }

      setEditHint("正在定位…");
      const loc = await geocodeAddress(addr);
      allItems[idx] = { ...it, lng: loc.lng, lat: loc.lat, updatedAt: new Date().toISOString() };
      upsertLocalAndRerender();
      syncEditorSelection(selectedId);
      const it2 = allItems[idx];
      focusItem(it2);
      log("info", "重新定位成功", `${it2.name} @ ${loc.lng},${loc.lat}`);
      setEditHint(`重新定位成功：<b>${escapeHtml(it2.name)}</b>`);
    }catch(e){
      log("error", "重新定位失败", errToStr(e));
      setEditHint(`<span class='err'>重新定位失败</span>：${escapeHtml(errToStr(e)).slice(0,200)}`);
    }
  });

  function toKbJson(items){
    return {
      version: 1,
      items: (items || []).map(it => ({
        id: it.id,
        name: it.name || "",
        city: it.city || "",
        address: it.address || "",
        category: it.category || "",
        location: (it.lng != null && it.lat != null) ? { lng: Number(it.lng), lat: Number(it.lat) } : null
      }))
    };
  }

  function refreshExportBox(){
    const kb = toKbJson(allItems);
    exportBox.value = JSON.stringify(kb, null, 2);
    return exportBox.value;
  }

  function downloadText(filename, text){
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById("btnExport").addEventListener("click", () => {
    const text = refreshExportBox();
    downloadText("kb.json", text);
    log("info", "已导出 kb.json（下载）");
  });
  document.getElementById("btnCopyExport").addEventListener("click", async () => {
    const text = refreshExportBox();
    try{
      await navigator.clipboard.writeText(text);
      log("info", "已复制导出 JSON");
      setEditHint("已复制导出 JSON（可直接替换仓库 kb.json）");
    }catch(e){
      log("warn", "复制导出 JSON 失败（浏览器限制）", errToStr(e));
      setEditHint("<span class='warn'>复制失败（浏览器限制）</span>：你可以手动选中下方文本复制");
    }
  });

  document.getElementById("btnClearLocal").addEventListener("click", () => {
    const ok = confirm("确认清空本地编辑数据？清空后将回到远程/静态数据。");
    if (!ok) return;
    clearLocalDB();
    selectedId = null;
    exportBox.value = "";
    log("warn", "已清空本地编辑数据");
    bootLoadData({ forceRemote: true });
  });

  /**********************
   * 8) Other buttons
   **********************/
  document.getElementById("btnReload").addEventListener("click", () => {
    closeDrawer();
    bootLoadData({ forceRemote: true });
  });
  document.getElementById("btnUseLocal").addEventListener("click", () => {
    closeDrawer();
    bootLoadData({ preferLocal: true });
  });
  document.getElementById("btnReloadMap").addEventListener("click", async () => {
    closeDrawer();
    const ok = await ensureAMapLoaded(true);
    if (ok){
      initMap();
      applyFilter();
    }
  });

  /**********************
   * 9) Boot
   **********************/
  (async function main(){
    renderCfgToUI();
    renderHints();

    log("info", "页面启动");

    const ok = await ensureAMapLoaded(false);
    if (ok){
      initMap();
    }else{
      log("warn", "地图未加载成功，但列表仍可用。请在设置中检查高德 Key。");
    }

    await bootLoadData({ forceRemote: false });
    syncEditorSelection(null);
    refreshExportBox();
  })();

})();

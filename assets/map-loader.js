export function createMapLoader({ loadCfg, log, showNetworkNotice }) {
  let amapLoading = null;

  function removeOldAMapScript() {
    const olds = document.querySelectorAll('script[data-amap="1"]');
    olds.forEach((s) => s.remove());
    try { delete window.AMap; } catch {}
    try { delete window.AMapUI; } catch {}
  }

  function loadAMapScriptOnce(url, timeoutMs) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.dataset.amap = "1";
      s.src = url;
      s.async = true;

      let done = false;
      const finish = (ok, reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        s.onload = null;
        s.onerror = null;
        if (!ok) {
          try { s.remove(); } catch {}
        }
        resolve({ ok, reason: reason || "" });
      };

      const timer = setTimeout(() => {
        finish(false, "timeout");
      }, Math.max(3000, Number(timeoutMs) || 12000));

      s.onload = () => {
        if (window.AMap && typeof window.AMap.Map === "function") {
          finish(true);
        } else {
          finish(false, "amap_not_ready_after_onload");
        }
      };
      s.onerror = () => finish(false, "script_error");
      document.head.appendChild(s);
    });
  }

  async function ensureAMapLoaded(forceReload = false) {
    const cfg = loadCfg();
    const key = cfg.amapKey;
    const scode = (cfg.amapSecurityJsCode || "").trim();
    if (!key) {
      log("error", "未配置高德 Key，地图无法加载，请在设置中填写");
      return false;
    }
    if (!forceReload && window.AMap) {
      return true;
    }
    if (amapLoading && !forceReload) {
      return amapLoading;
    }

    amapLoading = (async () => {
      if (forceReload) removeOldAMapScript();
      if (scode) {
        window._AMapSecurityConfig = { securityJsCode: scode };
      }

      const base = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.Geolocation,AMap.Driving,AMap.Walking`;
      const urls = [
        base,
        scode ? `${base}&jscode=${encodeURIComponent(scode)}` : "",
        scode ? `${base}&securityjscode=${encodeURIComponent(scode)}` : ""
      ].filter(Boolean);

      log("info", "正在加载高德地图脚本…");
      for (let i = 0; i < urls.length; i += 1) {
        const tryNo = i + 1;
        const ret = await loadAMapScriptOnce(urls[i], 12000);
        if (ret.ok) {
          log("info", "高德脚本加载完成", `attempt=${tryNo}`);
          return true;
        }
        if (ret.reason === "timeout" || ret.reason === "script_error") {
          showNetworkNotice("地图资源加载超时或失败，当前网络可能不稳定。", "warn", 7000);
        }
        log("warn", "高德脚本加载失败，准备重试", `attempt=${tryNo}, reason=${ret.reason || "unknown"}`);
      }

      log("error", "高德脚本加载失败（检查网络 / Key / 域名白名单）");
      return false;
    })().finally(() => {
      amapLoading = null;
    });

    return amapLoading;
  }

  function initMap() {
    if (!window.AMap) {
      log("error", "高德未就绪，初始化地图取消");
      return null;
    }
    const center = [104.0668, 30.5728];
    const map = new AMap.Map("map", {
      zoom: 12,
      center,
      viewMode: "2D"
    });
    log("info", "地图已初始化", `center=${center.join(",")}`);
    return map;
  }

  return {
    ensureAMapLoaded,
    initMap
  };
}

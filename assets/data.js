export function createDataService({
  loadCfg,
  fetchWithTimeout,
  notifyIfNetworkIssue,
  showLoading,
  hideLoading,
  log,
  errToStr,
  normRow
}) {
  async function loadFromSupabase() {
    const cfg = loadCfg();
    const base = (cfg.supabaseUrl || "").trim();
    const anon = (cfg.supabaseAnonKey || "").trim();

    if (!base || !base.includes(".supabase.co")) {
      log("warn", "Supabase URL 缺失或无效，跳过远程加载");
      return null;
    }
    if (!anon || !anon.startsWith("eyJ")) {
      log("warn", "Supabase anon key 缺失或无效（应为 eyJ 开头公钥），跳过远程加载");
      return null;
    }

    const url = `${base.replace(/\/$/, "")}/rest/v1/places?select=*`;
    log("info", "开始远程拉取：places", url);

    const t0 = performance.now();
    showLoading("正在加载数据...");
    const res = await fetchWithTimeout(url, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: "no-store"
    }, 15000, "远程数据加载").catch((e) => {
      log("error", "请求失败", errToStr(e));
      notifyIfNetworkIssue("加载数据", e);
      return null;
    });
    hideLoading();
    if (!res) return null;

    const t1 = performance.now();
    log("info", "远程请求完成", `status=${res.status} cost=${Math.round(t1 - t0)}ms`);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      log("error", "远程响应非 2xx", txt || `HTTP ${res.status}`);
      return null;
    }

    const data = await res.json().catch((e) => {
      log("error", "JSON 解析失败", errToStr(e));
      return null;
    });
    if (!Array.isArray(data)) {
      log("error", "远程响应不是数组", JSON.stringify(data).slice(0, 500));
      return null;
    }

    log("info", "远程数据数量", String(data.length));
    return data.map(normRow);
  }

  async function supaRequest(method, path, body) {
    const cfg = loadCfg();
    const base = (cfg.supabaseUrl || "").trim().replace(/\/$/, "");
    const anon = (cfg.supabaseAnonKey || "").trim();
    if (!base || !anon) {
      throw new Error("Supabase 配置缺失");
    }
    const url = `${base}${path}`;
    const headers = {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
    let res;
    try {
      res = await fetchWithTimeout(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      }, 15000, "数据库请求");
    } catch (e) {
      notifyIfNetworkIssue("数据库请求", e);
      throw e;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    return data;
  }

  return {
    loadFromSupabase,
    supaRequest
  };
}

export function createNetworkService({ errMsg }) {
  let netNoticeTimer = null;

  function ensureNetNoticeEl() {
    let el = document.getElementById("netNotice");
    if (el) return el;
    el = document.createElement("div");
    el.id = "netNotice";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:14px",
      "transform:translateX(-50%)",
      "max-width:min(92vw,640px)",
      "padding:10px 14px",
      "border-radius:10px",
      "font-size:13px",
      "line-height:1.35",
      "z-index:9999",
      "box-shadow:0 6px 18px rgba(0,0,0,.18)",
      "display:none"
    ].join(";");
    document.body.appendChild(el);
    return el;
  }

  function showNetworkNotice(msg, tone, durationMs) {
    if (!msg) return;
    const el = ensureNetNoticeEl();
    const t = tone || "warn";
    if (t === "error") {
      el.style.background = "#7f1d1d";
      el.style.color = "#fff";
      el.style.border = "1px solid #7f1d1d";
    } else if (t === "info") {
      el.style.background = "#eff6ff";
      el.style.color = "#1e3a8a";
      el.style.border = "1px solid #bfdbfe";
    } else {
      el.style.background = "#fff7ed";
      el.style.color = "#9a3412";
      el.style.border = "1px solid #fed7aa";
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(netNoticeTimer);
    netNoticeTimer = setTimeout(() => {
      el.style.display = "none";
    }, Math.max(2500, Number(durationMs) || 6000));
  }

  function isLikelyNetworkIssue(e) {
    const msg = (errMsg(e) || "").toLowerCase();
    return msg.includes("timeout")
      || msg.includes("timed out")
      || msg.includes("failed to fetch")
      || msg.includes("networkerror")
      || msg.includes("network request failed")
      || msg.includes("etimedout")
      || msg.includes("err_timed_out")
      || msg.includes("err_network");
  }

  function notifyIfNetworkIssue(scene, e) {
    if (!isLikelyNetworkIssue(e)) return;
    const sceneText = scene ? `${scene}：` : "";
    showNetworkNotice(`网络不通畅，${sceneText}请求超时或失败，请稍后重试。`, "warn", 7000);
  }

  async function fetchWithTimeout(url, options, timeoutMs, scene) {
    const ms = Math.max(2000, Number(timeoutMs) || 15000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const t0 = performance.now();
    try {
      const res = await fetch(url, { ...(options || {}), signal: controller.signal });
      const cost = performance.now() - t0;
      if (cost > 8000) {
        showNetworkNotice(`网络较慢：${scene || "请求"}耗时 ${Math.round(cost)}ms`, "info", 4500);
      }
      return res;
    } catch (e) {
      if (e && e.name === "AbortError") {
        const err = new Error(`timeout after ${ms}ms`);
        err.code = "ETIMEDOUT";
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    showNetworkNotice,
    notifyIfNetworkIssue,
    fetchWithTimeout
  };
}

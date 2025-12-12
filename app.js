// UTF-8
const VWORLD_KEY = "D1D59BC9-DC45-34F9-A83C-20322886531A";
const KMA_KEY = "cdb64aec25afc08c33bab533618778169abbb08ec707b766c86c924e3b9c821b";
const OCEAN_KEY = "jF8ovdxhZM4qHCWyT0pv7w=="; // 현재 미사용, 해수욕장 날씨 API로 대체
const KMA_BEACH_BASE_URL = "https://apis.data.go.kr";
const KMA_BEACH_LIST_PATH = "/1360000/BeachInfoService/getBeachCodeList";
const KMA_BEACH_WEATHER_PATH = "/1360000/BeachInfoService/getBeachWeather";
const KMA_BEACH_KEY = KMA_KEY;

const regionButtonsEl = document.getElementById("region-buttons");
const beachGridEl = document.getElementById("beach-grid");
const statusDotEl = document.getElementById("status-dot");
const statusTextEl = document.getElementById("status-text");
const loaderEl = document.getElementById("loader");
const weatherTopRow = document.getElementById("weather-top-row");
const weatherBottomRow = document.getElementById("weather-bottom-row");
const apiTestButton = document.getElementById("api-test-button");
const statusVworld = document.getElementById("status-vworld");
const statusKma = document.getElementById("status-kma");
const statusOcean = document.getElementById("status-ocean");
const apiDebugLogEl = document.getElementById("api-debug-log");

let selectedRegion = "제주시";
let selectedBeach = null;
let kmaBeachList = null;

async function fetchJsonViaProxy(apiUrl) {
  const proxyUrl = `/.netlify/functions/proxy?url=${encodeURIComponent(apiUrl)}`;
  let res;
  try {
    res = await fetch(proxyUrl);
  } catch (err) {
    appendApiLog(`프록시 요청 실패 (네트워크): ${err && err.message ? err.message : err}`);
    throw new Error(`Proxy fetch failed (network): ${err && err.message ? err.message : err}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();
  const snippet = bodyText.slice(0, 500);
  const trimmed = bodyText.trimStart();
  const isJson =
    contentType.toLowerCase().includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");

  if (!res.ok) {
    appendApiLog(`프록시 오류 ${res.status}: ${snippet}`);
    throw new Error(`Proxy fetch failed: ${res.status} ${res.statusText} | body: ${snippet}`);
  }

  if (isJson) {
    try {
      return JSON.parse(bodyText);
    } catch (err) {
      appendApiLog(`JSON 파싱 실패: ${err && err.message ? err.message : err} | body: ${snippet}`);
      throw new Error(`JSON parse failed: ${err && err.message ? err.message : err}`);
    }
  }

  appendApiLog(
    `JSON 파싱 불가: content-type=${contentType || "unknown"}, body[0..500]=${snippet}`
  );
  throw new Error(`Non-JSON response from proxy: content-type=${contentType || "unknown"}`);
}

async function fetchCoordinatesFromVWorld(address) {
  const base = "https://api.vworld.kr/req/address";
  const params = new URLSearchParams({
    service: "address",
    request: "getcoord",
    format: "json",
    type: "ROAD",
    key: VWORLD_KEY,
    address,
  });

  const url = `${base}?${params.toString()}`;
  const data = await fetchJsonViaProxy(url);
  const result = data?.response?.result;
  if (result?.point) {
    return { lat: Number(result.point.y), lon: Number(result.point.x) };
  }

  params.set("type", "PARCEL");
  const fbData = await fetchJsonViaProxy(`${base}?${params.toString()}`);
  const fbResult = fbData?.response?.result;
  if (fbResult?.point) {
    return { lat: Number(fbResult.point.y), lon: Number(fbResult.point.x) };
  }

  throw new Error("좌표를 찾을 수 없습니다");
}

function latLonToGrid(lat, lon) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;

  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

async function loadKmaBeachList() {
  if (kmaBeachList) return kmaBeachList;
  try {
    const params = new URLSearchParams({
      serviceKey: KMA_BEACH_KEY,
      pageNo: "1",
      numOfRows: "300",
      dataType: "JSON",
    });
    const url = `${KMA_BEACH_BASE_URL}${KMA_BEACH_LIST_PATH}?${params.toString()}`;
    const data = await fetchJsonViaProxy(url);
    const items = data?.response?.body?.items?.item || [];
    kmaBeachList = items.map((it) => ({
      code: it.beachNum || it.beach_num || it.beachCode || it.code,
      name: it.beachName || it.beach_name || it.name || "",
      region: it.region || it.gugun || it.si || "",
    }));
    return kmaBeachList;
  } catch (error) {
    console.error("loadKmaBeachList failed:", error);
    kmaBeachList = [];
    return kmaBeachList;
  }
}

function findKmaBeachForSpot(spot) {
  if (!kmaBeachList || !kmaBeachList.length) return null;
  const hint = (spot.beachHint || spot.name || "").replace(/\s+/g, "").toLowerCase();
  if (!hint) return null;

  let best = kmaBeachList.find(
    (b) => (b.name || "").replace(/\s+/g, "").toLowerCase() === hint
  );
  if (!best) {
    best = kmaBeachList.find((b) => {
      const bn = (b.name || "").replace(/\s+/g, "").toLowerCase();
      return bn.includes(hint) || hint.includes(bn);
    });
  }
  return best || null;
}

async function fetchBeachSeaState(spot) {
  try {
    const list = await loadKmaBeachList();
    if (!list || !list.length) {
      console.warn("No KMA beach list");
      return { waveHeight: null, waterTemp: null, stationName: null };
    }
    const matched = findKmaBeachForSpot(spot);
    if (!matched || !matched.code) {
      console.warn("No matched KMA beach for spot", spot?.name);
      return { waveHeight: null, waterTemp: null, stationName: null };
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const baseDate = `${y}${m}${d}`;
    const baseTime = `${h}00`;

    const params = new URLSearchParams({
      serviceKey: KMA_BEACH_KEY,
      pageNo: "1",
      numOfRows: "20",
      dataType: "JSON",
      beach_num: matched.code,
      beachNum: matched.code,
      base_date: baseDate,
      base_time: baseTime,
    });
    const url = `${KMA_BEACH_BASE_URL}${KMA_BEACH_WEATHER_PATH}?${params.toString()}`;
    const data = await fetchJsonViaProxy(url);
    const items = data?.response?.body?.items?.item || [];
    if (!items.length) {
      return { waveHeight: null, waterTemp: null, stationName: matched.name || null };
    }

    const targetTime = `${baseDate}${baseTime}`;
    let best = null;
    let bestDiff = Infinity;
    for (const it of items) {
      const tDate = it.baseDate || it.fcstDate || it.dt || "";
      const tTime = it.baseTime || it.fcstTime || it.hh || it.tm || "";
      const tt = `${tDate}${tTime}`.replace(/\D/g, "");
      const diff = Math.abs(Number(tt) - Number(targetTime));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = it;
      }
    }
    const selected = best || items[0];
    const rawTemp =
      selected?.wt ??
      selected?.waterTemp ??
      selected?.seaTemp ??
      selected?.wTemp ??
      selected?.watTemp ??
      selected?.sea_temperature;
    const rawWave =
      selected?.wh ??
      selected?.waveHeight ??
      selected?.wave ??
      selected?.whSig ??
      selected?.waveHt;

    const waterTemp = rawTemp != null ? parseFloat(rawTemp) : null;
    const waveHeight = rawWave != null ? parseFloat(rawWave) : null;

    return {
      waveHeight: Number.isFinite(waveHeight) ? waveHeight : null,
      waterTemp: Number.isFinite(waterTemp) ? waterTemp : null,
      stationName: matched.name || null,
    };
  } catch (error) {
    console.error("fetchBeachSeaState failed:", error);
    return { waveHeight: null, waterTemp: null, stationName: null };
  }
}

function getBaseDateTime(now = new Date()) {
  const kst = new Date(now.getTime());
  const baseTimes = [2, 5, 8, 11, 14, 17, 20, 23];
  let hour = kst.getHours();
  const minute = kst.getMinutes();

  if (minute < 45) hour -= 1;
  let baseHour = baseTimes.filter((h) => h <= hour).pop();
  const baseDate = new Date(kst);
  if (baseHour === undefined) {
    baseHour = 23;
    baseDate.setDate(baseDate.getDate() - 1);
  }

  const y = baseDate.getFullYear();
  const m = String(baseDate.getMonth() + 1).padStart(2, "0");
  const d = String(baseDate.getDate()).padStart(2, "0");
  return {
    baseDate: `${y}${m}${d}`,
    baseTime: `${String(baseHour).padStart(2, "0")}00`,
  };
}

async function fetchKmaForecast(nx, ny, baseDateTime) {
  const params = new URLSearchParams({
    serviceKey: KMA_KEY,
    pageNo: "1",
    numOfRows: "200",
    dataType: "JSON",
    base_date: baseDateTime.baseDate,
    base_time: baseDateTime.baseTime,
    nx: String(nx),
    ny: String(ny),
  });

  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${params.toString()}`;
  const data = await fetchJsonViaProxy(url);
  const items = data?.response?.body?.items?.item;
  if (!items) throw new Error("예보 데이터를 찾을 수 없습니다");
  return items;
}

function pickForecastForNext3Hours(items) {
  const wanted = new Set(["TMP", "T1H", "SKY", "PTY", "WSD", "REH"]);
  const map = new Map();
  items.forEach((it) => {
    if (!wanted.has(it.category)) return;
    const key = `${it.fcstDate}${it.fcstTime}`;
    if (!map.has(key)) map.set(key, {});
    const slot = map.get(key);
    const cat = it.category === "T1H" ? "TMP" : it.category;
    slot[cat] = Number(it.fcstValue);
  });

  const now = new Date();
  const result = [];
  for (let i = 0; i < 3; i++) {
    const t = new Date(now.getTime() + i * 60 * 60 * 1000);
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const d = String(t.getDate()).padStart(2, "0");
    const h = String(t.getHours()).padStart(2, "0");
    const key = `${y}${m}${d}${h}00`;
    const payload = map.get(key) || {};
    result.push({
      label: i === 0 ? "현재" : `+${i}시간`,
      fcstDate: `${y}-${m}-${d}`,
      fcstTime: `${h}:00`,
      temp: payload.TMP ?? null,
      sky: payload.SKY ?? null,
      pty: payload.PTY ?? 0,
      wind: payload.WSD ?? null,
      humidity: payload.REH ?? null,
    });
  }
  return result;
}

async function fetchOceanData(spot) {
  // Backward compatibility alias
  return fetchBeachSeaState(spot);
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeSwimRisk(temp, sky, pty, wind, waveHeight) {
  let score = 1;
  if (temp !== null) {
    if (temp < 18) score += 2;
    else if (temp < 22) score += 1;
  }
  if (sky === 3) score += 0.5;
  if (sky === 4) score += 1;
  if ([1, 4, 5].includes(pty)) score += 2;
  if ([2, 3, 6, 7].includes(pty)) score += 3;
  if (wind !== null) {
    if (wind >= 12) score += 3;
    else if (wind >= 8) score += 1.5;
    else if (wind >= 4) score += 0.5;
  }
  const h = typeof waveHeight === "number" && !Number.isNaN(waveHeight) ? waveHeight : null;
  if (h !== null) {
    if (h >= 3) score += 3;
    else if (h >= 1.5) score += 2;
    else if (h >= 0.5) score += 1;
  }
  const clamped = Math.min(5, Math.max(1, Math.round(score * 10) / 10));
  const rounded = Math.min(5, Math.max(1, Math.round(clamped)));
  const labelMap = {
    1: "아주 좋음 (수영 적합)",
    2: "좋음 (대체로 가능)",
    3: "주의 (현장 확인)",
    4: "위험 (입수 권장 X)",
    5: "매우 위험 (입수 금지)",
  };
  return { score: rounded, exact: clamped, label: labelMap[rounded] };
}

function getWeatherIcon(sky, pty) {
  if ([1, 4, 5].includes(pty)) return "🌧";
  if ([2, 6].includes(pty)) return "🌨";
  if ([3, 7].includes(pty)) return "⛈";
  if (sky === 1 && pty === 0) return "☀️";
  if (sky === 3 && pty === 0) return "⛅";
  if (sky === 4 && pty === 0) return "☁️";
  return "🌥";
}

function skyToText(sky) {
  return { 1: "맑음", 3: "구름 많음", 4: "흐림" }[sky] || "-";
}

function ptyToText(pty) {
  return { 0: "없음", 1: "비", 2: "비/눈", 3: "눈", 4: "소나기", 5: "빗방울", 6: "빗방울/눈날림", 7: "눈날림" }[pty] || "-";
}

function getWindDescription(wind) {
  if (wind === null || wind === undefined) return "-";
  if (wind < 4) return "잔잔";
  if (wind < 8) return "약풍";
  if (wind < 12) return "강풍";
  return "매우 강풍";
}

function getFeelsLike(temp, wind) {
  const t = Number(temp);
  const w = Math.max(0, Number(wind) || 0);
  if (!Number.isFinite(t)) return null;
  const v = Math.pow(w, 0.16);
  const result = 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v;
  return Number.isFinite(result) ? Number(result.toFixed(1)) : null;
}

function getFeelsLikeLevel(feelsLike) {
  const t = Number(feelsLike);
  if (!Number.isFinite(t)) {
    return {
      label: "데이터 없음",
      key: "unknown",
    };
  }
  if (t >= 24) {
    return {
      label: "매우 따뜻함 (수영 최적)",
      key: "best",
    };
  }
  if (t >= 20) {
    return {
      label: "따뜻함 (무난)",
      key: "good",
    };
  }
  if (t >= 16) {
    return {
      label: "약간 서늘함 (짧은 입수 권장)",
      key: "cool",
    };
  }
  if (t >= 12) {
    return {
      label: "추움 (웻슈트 권장)",
      key: "cold",
    };
  }
  return {
    label: "매우 추움 (입수 비권장)",
    key: "very-cold",
  };
}

function renderRegionButtons() {
  const regions = Array.from(new Set(beaches.map((b) => b.region)));
  // Region buttons are static in HTML now; just sync active state and listeners
  regionButtonsEl.querySelectorAll(".region-btn").forEach((btn) => {
    const r = btn.dataset.region;
    if (r === selectedRegion) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
    btn.addEventListener("click", () => {
      selectedRegion = r;
      renderRegionButtons();
      renderBeachButtons();
    });
  });
}

function renderBeachButtons() {
  const list = beaches.filter((b) => b.region === selectedRegion);
  beachGridEl.innerHTML = list
    .map(
      (b) => `<button class="beach-btn" data-id="${b.id}">
          <strong>${b.name}</strong>
          <span>${b.address}</span>
        </button>`
    )
    .join("");

  beachGridEl.querySelectorAll(".beach-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const beach = beaches.find((b) => b.id === btn.dataset.id);
      selectedBeach = beach;
      loadBeach(beach);
    });
  });
}

async function loadBeach(beach) {
  setLoading(true);
  setTopMessage(`${beach.name} 좌표를 조회 중...`, "ok");
  try {
    const coord = await fetchCoordinatesFromVWorld(beach.address || beach.name);
    setTopMessage("기상청 격자 변환 중...", "ok");
    const grid = latLonToGrid(coord.lat, coord.lon);
    const baseDateTime = getBaseDateTime();

    setTopMessage("단기예보 불러오는 중...", "ok");
    const fcItems = await fetchKmaForecast(grid.nx, grid.ny, baseDateTime);
    const forecast = pickForecastForNext3Hours(fcItems);

    setTopMessage("파고/수온 조회 중...", "ok");
    let ocean = { waveHeight: null, waterTemp: null, stationName: null };
    try {
      ocean = await fetchBeachSeaState(beach);
    } catch (e) {
      console.error("fetchBeachSeaState unexpected error:", e);
      ocean = { waveHeight: null, waterTemp: null, stationName: null };
    }

    const baseline = forecast[0] || {};
    const risk = computeSwimRisk(
      baseline.temp,
      baseline.sky,
      baseline.pty,
      baseline.wind,
      ocean.waveHeight
    );

    renderWeatherCards(beach, forecast, ocean, risk);
    setTopMessage(`${beach.name} 업데이트 완료`, "ok");
  } catch (err) {
    console.error(err);
    setTopMessage("데이터를 불러오지 못했습니다.");
    renderErrorCards(err && err.message);
  } finally {
    setLoading(false);
  }
}

function renderWeatherCards(beach, forecast, ocean, risk) {
  const topCards = forecast
    .map((f) => {
      const icon = getWeatherIcon(f.sky, f.pty);
      const tempText = f.temp !== null ? `${f.temp.toFixed(0)}°C` : "-";
      const windText = f.wind !== null ? `${f.wind.toFixed(1)} m/s` : "-";
      return `<div class="card">
          <div class="badge">${beach.name}</div>
          <h3>${f.label} · ${f.fcstTime}</h3>
          <div class="meta">${f.fcstDate}</div>
          <div class="value">${icon} ${tempText}</div>
          <div class="tags">
            <span class="tag">${skyToText(f.sky)}</span>
            <span class="tag">${ptyToText(f.pty)}</span>
            <span class="tag">풍속 ${windText}</span>
          </div>
          <div class="muted">습도 ${f.humidity ?? "-"}%</div>
        </div>`;
    })
    .join("");

  const feelsLikeValue = getFeelsLike(forecast[0]?.temp ?? null, forecast[0]?.wind ?? null);
  const feelsLikeLevel = getFeelsLikeLevel(feelsLikeValue);
  const feelsLikeText = feelsLikeValue !== null ? `${feelsLikeValue}C` : "데이터 없음";
  const oceanCard = `<div class="card">
      <h3>A · 체감수온</h3>
      <div class="meta">현재 기온/풍속 기준</div>
      <div class="value">${feelsLikeText}</div>
      <div class="metric-sub"><span class="temp-tag temp-${feelsLikeLevel.key}">${feelsLikeLevel.label}</span></div>
      <div class="muted">바람을 고려한 실제 체감 기온</div>
    </div>`;

  const windCard = `<div class="card">
      <h3>B · 풍속</h3>
      <div class="meta">현재 예보 기준</div>
      <div class="value">${forecast[0]?.wind !== null ? `${forecast[0].wind.toFixed(1)} m/s` : "-"}</div>
      <div class="muted">${getWindDescription(forecast[0]?.wind)}</div>
    </div>`;

  const waveHeight =
    typeof ocean.waveHeight === "number" && !Number.isNaN(ocean.waveHeight)
      ? `${ocean.waveHeight.toFixed(2)} m`
      : "파고 데이터 없음";
  const riskCard = `<div class="card risk-${risk.score}">
      <h3>C · 파고 · 수영 위험도</h3>
      <div class="meta">파고 ${waveHeight}</div>
      <div class="value">${risk.label}</div>
      <div class="muted">종합 점수 ${risk.exact.toFixed(1)} / 5.0</div>
    </div>`;

  weatherTopRow.innerHTML = topCards;
  weatherBottomRow.innerHTML = `${oceanCard}${windCard}${riskCard}`;
}

function renderErrorCards(message) {
  const msg = "데이터를 불러오지 못했습니다.";
  weatherTopRow.innerHTML = `
    <div class="card"><h3>현재</h3><p class="metric error">${msg}</p></div>
    <div class="card"><h3>+1시간 후</h3><p class="metric error">${msg}</p></div>
    <div class="card"><h3>+2시간 후</h3><p class="metric error">${msg}</p></div>
  `;
  weatherBottomRow.innerHTML = `
    <div class="card"><h3>A. 체감수온</h3><p class="metric error">${msg}</p></div>
    <div class="card"><h3>B. 풍속</h3><p class="metric error">${msg}</p></div>
    <div class="card"><h3>C. 파고 / 수영 위험도</h3><p class="metric error">${msg}</p></div>
  `;
}

function appendApiLog(message) {
  if (!apiDebugLogEl) return;
  const now = new Date();
  const timestamp = now.toISOString().replace("T", " ").slice(0, 19);
  apiDebugLogEl.textContent += `\n[${timestamp}] ${message}`;
  apiDebugLogEl.scrollTop = apiDebugLogEl.scrollHeight;
}

function setApiStatus(el, status, isOk) {
  if (!el) return;
  el.textContent = status;
  el.classList.remove("ok", "error");
  if (isOk === true) el.classList.add("ok");
  if (isOk === false) el.classList.add("error");
}

async function testApis() {
  appendApiLog("=== API 연결 테스트 시작 ===");

  // V-world
  try {
    setApiStatus(statusVworld, "요청 중...", null);
    const testAddress = "제주특별자치도 제주시 연동 2401";
    const params = new URLSearchParams({
      service: "address",
      request: "getcoord",
      format: "json",
      type: "ROAD",
      key: VWORLD_KEY,
      address: testAddress,
    });
    const url = `https://api.vworld.kr/req/address?${params.toString()}`;
    appendApiLog(`V-world 요청: ${url}`);
    const data = await fetchJsonViaProxy(url);
    appendApiLog("V-world 응답 JSON 일부: " + JSON.stringify(data, null, 2).slice(0, 500));
    setApiStatus(statusVworld, "성공", true);
  } catch (err) {
    console.error("V-world 테스트 실패", err);
    setApiStatus(statusVworld, "실패", false);
    appendApiLog("V-world 에러: " + (err && err.message));
    if (err && String(err.message).includes("Failed to fetch")) {
      appendApiLog("브라우저 CORS 정책에 의해 차단되었을 수 있습니다. file:// 대신 로컬 서버(예: npx serve)로 열어보세요.");
    }
  }

  // KMA
  try {
    setApiStatus(statusKma, "요청 중...", null);
    const { baseDate, baseTime } = getBaseDateTime();
    const nx = 53;
    const ny = 38;
    const params = new URLSearchParams({
      serviceKey: KMA_KEY,
      pageNo: "1",
      numOfRows: "10",
      dataType: "JSON",
      base_date: baseDate,
      base_time: baseTime,
      nx: String(nx),
      ny: String(ny),
    });
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${params.toString()}`;
    appendApiLog(`KMA 요청: ${url}`);
    const data = await fetchJsonViaProxy(url);
    appendApiLog("KMA 응답 JSON 일부: " + JSON.stringify(data, null, 2).slice(0, 500));
    setApiStatus(statusKma, "성공", true);
  } catch (err) {
    console.error("KMA 테스트 실패", err);
    setApiStatus(statusKma, "실패", false);
    appendApiLog("KMA 에러: " + (err && err.message));
    if (err && String(err.message).includes("Failed to fetch")) {
      appendApiLog("브라우저 CORS 정책에 의해 차단되었을 수 있습니다. file:// 대신 로컬 서버(예: npx serve)로 열어보세요.");
    }
  }

  // 해수욕장 수온/파고
  try {
    setApiStatus(statusOcean, "요청 중...", null);
    const list = await loadKmaBeachList();
    appendApiLog(`해수욕장 목록 로드: ${list.length}개`);
    const sampleSpot = selectedBeach || beaches[0];
    const seaState = await fetchBeachSeaState(sampleSpot);
    appendApiLog("해수욕장 수온/파고: " + JSON.stringify(seaState, null, 2));
    setApiStatus(statusOcean, "성공", true);
  } catch (err) {
    console.error("해수욕장 API 테스트 실패", err);
    setApiStatus(statusOcean, "실패", false);
    appendApiLog("해수욕장 API 에러: " + (err && err.message));
    if (err && String(err.message).includes("Failed to fetch")) {
      appendApiLog("브라우저 CORS 정책에 의해 차단되었을 수 있습니다. file:// 대신 로컬 서버(예: npx serve)로 열어보세요.");
    }
  }

  appendApiLog("=== API 연결 테스트 종료 ===");
}

function setLoading(isLoading) {
  loaderEl.classList.toggle("visible", isLoading);
}

function setTopMessage(text, state = "warn") {
  statusTextEl.textContent = text;
  statusDotEl.classList.remove("ok", "warn", "error");
  statusDotEl.classList.add(state === "ok" ? "ok" : state === "error" ? "error" : "warn");
}

function init() {
  renderRegionButtons();
  renderBeachButtons();
  if (apiTestButton) {
    apiTestButton.addEventListener("click", () => {
      testApis();
    });
  }
  document.querySelectorAll(".cctv-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      if (type === "north") {
        window.open("http://cctv.jejudoin.co.kr/north_cctv", "_blank");
      } else if (type === "south") {
        window.open("https://cctv.jejudoin.co.kr/south_cctv", "_blank");
      }
    });
  });
}

init();

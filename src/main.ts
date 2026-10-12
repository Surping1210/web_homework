/**
 * 校园水文水质智能监测系统 - 原生 TypeScript / JavaScript 核心控制器
 * 严格按照要求：禁止使用前端框架，全原生DOM驱动与交互逻辑
 */

// ================= 类型定义 =================
interface StationData {
  id: number;
  name: string;
  temp: number;      // ℃
  ph: number;        // pH
  do: number;        // 溶解氧 mg/L
  turb: number;      // 浊度 NTU
  level: number;     // 水位 m
  ec: number;        // 电导率 μS/cm
  flow: number;      // 流速 m/s
  humidity: number;  // 湿度 %
  airTemp: number;   // 气温 ℃
}

interface Thresholds {
  tempMin: number;
  tempMax: number;
  phMin: number;
  phMax: number;
  doMin: number;
  turbMax: number;
  levelMax: number;
  enableAudioAlarm: boolean;
  enableAutoAerator: boolean;
  enableAutoGate: boolean;
}

interface DeviceState {
  aerator: boolean;  // 增氧曝气泵
  filter: boolean;   // 生态循环滤水机
  dosing: boolean;   // 调碱酸投药机
  gate: boolean;     // 升降闸门
  runtime: {
    aerator: number;
    filter: number;
    dosing: number;
    gate: number;
  };
}

interface HistoryRecord {
  id: number;
  time: string;
  stationName: string;
  temp: number;
  ph: number;
  do: number;
  turb: number;
  level: number;
  ec: number;
  grade: string;
  isAlarm: boolean;
  alarmMsg: string;
  deviceStatusStr: string;
}

// ================= 用户身份与权限定义 =================
interface User {
  username: string;
  displayName: string;
  role: 'admin' | 'guest';
  roleName: string;
  avatar: string;
}

// 预设写死系统账号库 (仅保留管理员和访客)
const ACCOUNTS: Record<string, { password: string; user: User }> = {
  admin: {
    password: "123456",
    user: {
      username: "admin",
      displayName: "管理员",
      role: "admin",
      roleName: "管理员",
      avatar: "👑"
    }
  },
  guest: {
    password: "123456",
    user: {
      username: "guest",
      displayName: "访客",
      role: "guest",
      roleName: "访客",
      avatar: "👤"
    }
  }
};

let currentUser: User | null = null;
let currentCaptcha = "";

// ================= 状态仓库 =================
const stations: Record<number, StationData> = {
  1: { id: 1, name: "1号站 · 未名湖中央生态站", temp: 22.4, ph: 7.35, do: 6.8, turb: 6.5, level: 1.68, ec: 412, flow: 0.38, humidity: 62, airTemp: 24.5 },
  2: { id: 2, name: "2号站 · 镜湖湿地涵养站", temp: 21.8, ph: 7.20, do: 6.5, turb: 5.2, level: 1.82, ec: 395, flow: 0.25, humidity: 68, airTemp: 23.8 },
  3: { id: 3, name: "3号站 · 临溪明渠水文站", temp: 23.1, ph: 7.48, do: 6.2, turb: 8.4, level: 1.45, ec: 460, flow: 0.65, humidity: 60, airTemp: 25.1 },
  4: { id: 4, name: "4号站 · 观赏景观蓄水池", temp: 22.9, ph: 7.15, do: 7.1, turb: 4.8, level: 2.10, ec: 380, flow: 0.15, humidity: 65, airTemp: 24.2 },
};

let currentStationId = 1;
let controlMode: 'auto' | 'manual' = 'auto'; // 'auto' | 'manual'
let isAutoRefreshActive = true;
let isAudioEnabled = true;

// 默认阈值 (地表水环境质量标准 GB 3838-2002 III类标准)
const thresholds: Thresholds = {
  tempMin: 10.0,
  tempMax: 30.0,
  phMin: 6.5,
  phMax: 8.5,
  doMin: 5.0,
  turbMax: 15.0,
  levelMax: 2.50,
  enableAudioAlarm: true,
  enableAutoAerator: true,
  enableAutoGate: true,
};

// 执行设备状态
const devices: DeviceState = {
  aerator: false,
  filter: false,
  dosing: false,
  gate: false,
  runtime: {
    aerator: 12.4,
    filter: 8.1,
    dosing: 3.6,
    gate: 0.8,
  },
};

// 趋势历史点 (最近25次用于绘制Canvas折线)
const chartHistory: { time: string; temp: number; ph: number; do: number; turb: number; level: number }[] = [];

// 完整表格历史记录列表
let historyRecords: HistoryRecord[] = [];
let nextHistoryId = 1;

// Web Audio API 警报发生器单例
let audioCtx: AudioContext | null = null;
let lastAlarmBeepTime = 0;

// ================= DOM 元素快捷选择器 =================
const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const $$ = (selector: string) => document.querySelectorAll(selector);

// ================= 初始化入口 =================
document.addEventListener("DOMContentLoaded", () => {
  // 恢复记住的登录会话
  try {
    const saved = localStorage.getItem("campus_water_auth");
    if (saved) {
      currentUser = JSON.parse(saved);
    }
  } catch {
    currentUser = null;
  }
  updateAuthUI();
  refreshCaptchaUI();

  initInitialHistory();
  initChartData();
  bindEvents();
  renderThresholdDisplays();
  updateClock();
  setInterval(updateClock, 1000);

  // 核心定时器：每2秒进行一次遥测模拟与自动控制联动
  setInterval(() => {
    if (isAutoRefreshActive) {
      simulateSensorFluctuation();
      renderRealtimeCards();
      checkThresholdsAndAlarm();
      if (controlMode === 'auto') {
        runAutoControlLogic();
      }
      renderDevices();
      updateChartData();
      drawWaterChart();
    }
  }, 2000);

  // 每8秒自动保存一次历史快照
  setInterval(() => {
    if (isAutoRefreshActive) {
      captureSnapshot(false);
    }
  }, 8000);

  // 初始界面渲染
  renderRealtimeCards();
  renderDevices();
  renderHistoryTable();
  drawWaterChart();

  // 监听窗口尺寸变化重绘画布
  window.addEventListener("resize", () => {
    drawWaterChart();
  });
});

// ================= 1. 模拟传感器数据生成 =================
function simulateSensorFluctuation() {
  const current = stations[currentStationId];
  if (!current) return;

  // 在真实基准附近微小高斯波动
  const deltaTemp = (Math.random() - 0.5) * 0.2;
  const deltaPh = (Math.random() - 0.5) * 0.04;
  const deltaDo = (Math.random() - 0.5) * 0.15;
  const deltaTurb = (Math.random() - 0.5) * 0.3;
  const deltaLevel = (Math.random() - 0.5) * 0.02;
  const deltaEc = Math.round((Math.random() - 0.5) * 6);

  // 如果对应设备在运行，则产生正向治理效果
  let doBonus = 0;
  if (devices.aerator) doBonus += 0.3; // 曝气泵提升溶解氧
  let turbBonus = 0;
  if (devices.filter) turbBonus -= 0.5; // 砂滤机降低浊度
  let phBonus = 0;
  if (devices.dosing) {
    if (current.ph < 7.0) phBonus += 0.1;
    else if (current.ph > 7.4) phBonus -= 0.1;
  }
  let levelBonus = 0;
  if (devices.gate) levelBonus -= 0.08; // 开闸排水降低水位

  current.temp = parseFloat((current.temp + deltaTemp).toFixed(1));
  current.ph = parseFloat((current.ph + deltaPh + phBonus).toFixed(2));
  current.do = parseFloat(Math.max(1.0, current.do + deltaDo + doBonus).toFixed(2));
  current.turb = parseFloat(Math.max(1.0, current.turb + deltaTurb + turbBonus).toFixed(1));
  current.level = parseFloat(Math.max(0.5, current.level + deltaLevel + levelBonus).toFixed(2));
  current.ec = Math.max(100, current.ec + deltaEc);

  // 累加设备运行时间
  if (devices.aerator) devices.runtime.aerator += 0.001;
  if (devices.filter) devices.runtime.filter += 0.001;
  if (devices.dosing) devices.runtime.dosing += 0.001;
  if (devices.gate) devices.runtime.gate += 0.001;
}

// ================= 2. 渲染实时遥测卡片与状态 =================
function renderRealtimeCards() {
  const current = stations[currentStationId];
  if (!current) return;

  // 更新数值
  $("#val-temp").textContent = current.temp.toFixed(1);
  $("#val-ph").textContent = current.ph.toFixed(2);
  $("#val-do").textContent = current.do.toFixed(2);
  $("#val-turb").textContent = current.turb.toFixed(1);
  $("#val-level").textContent = current.level.toFixed(2);
  $("#val-ec").textContent = current.ec.toString();
  $("#val-flow").textContent = current.flow.toFixed(2);
  $("#val-humidity").textContent = `${current.humidity}% / ${current.airTemp}℃`;

  // 仪表条比例计算
  const gaugeTempPercent = Math.min(100, Math.max(5, (current.temp / 40) * 100));
  const gaugePhPercent = Math.min(100, Math.max(5, (current.ph / 14) * 100));
  const gaugeDoPercent = Math.min(100, Math.max(5, (current.do / 12) * 100));
  const gaugeTurbPercent = Math.min(100, Math.max(5, (current.turb / 30) * 100));
  const gaugeLevelPercent = Math.min(100, Math.max(5, (current.level / 3.5) * 100));
  const gaugeEcPercent = Math.min(100, Math.max(5, (current.ec / 1000) * 100));

  ($("#gauge-temp") as HTMLElement).style.width = `${gaugeTempPercent}%`;
  ($("#gauge-ph") as HTMLElement).style.width = `${gaugePhPercent}%`;
  ($("#gauge-do") as HTMLElement).style.width = `${gaugeDoPercent}%`;
  ($("#gauge-turb") as HTMLElement).style.width = `${gaugeTurbPercent}%`;
  ($("#gauge-level") as HTMLElement).style.width = `${gaugeLevelPercent}%`;
  ($("#gauge-ec") as HTMLElement).style.width = `${gaugeEcPercent}%`;
}

// ================= 3. 阈值判断与异常报警系统 =================
function checkThresholdsAndAlarm() {
  const current = stations[currentStationId];
  if (!current) return;

  const alarms: string[] = [];

  // 判断水温
  const isTempAlarm = current.temp < thresholds.tempMin || current.temp > thresholds.tempMax;
  updateCardStatus("#card-temp", "#status-temp", isTempAlarm, isTempAlarm ? "⚠️ 水温超标" : "✅ 正常");
  if (isTempAlarm) {
    alarms.push(`水温异常 (${current.temp}℃ 不在 [${thresholds.tempMin}~${thresholds.tempMax}℃] 范围内)`);
  }

  // 判断pH
  const isPhAlarm = current.ph < thresholds.phMin || current.ph > thresholds.phMax;
  updateCardStatus("#card-ph", "#status-ph", isPhAlarm, isPhAlarm ? (current.ph < thresholds.phMin ? "⚠️ 偏酸异常" : "⚠️ 偏碱异常") : "✅ 正常");
  if (isPhAlarm) {
    alarms.push(`pH值超限 (${current.ph} 不在 [${thresholds.phMin}~${thresholds.phMax}] 范围内)`);
  }

  // 判断溶解氧 DO
  const isDoAlarm = current.do < thresholds.doMin;
  updateCardStatus("#card-do", "#status-do", isDoAlarm, isDoAlarm ? "⚠️ 严重缺氧" : "✨ 优良");
  if (isDoAlarm) {
    alarms.push(`溶解氧过低 (${current.do} mg/L < 保护阈值 ${thresholds.doMin} mg/L)`);
  }

  // 判断浊度 Turbidity
  const isTurbAlarm = current.turb > thresholds.turbMax;
  updateCardStatus("#card-turb", "#status-turb", isTurbAlarm, isTurbAlarm ? "⚠️ 浑浊超标" : "💧 清澈");
  if (isTurbAlarm) {
    alarms.push(`水体浊度超标 (${current.turb} NTU > 警戒上限 ${thresholds.turbMax} NTU)`);
  }

  // 判断水位 Level
  const isLevelAlarm = current.level > thresholds.levelMax;
  updateCardStatus("#card-level", "#status-level", isLevelAlarm, isLevelAlarm ? "⚠️ 超汛限水位" : "🛡️ 安全");
  if (isLevelAlarm) {
    alarms.push(`水位超防汛警戒线 (${current.level} m > 阈值 ${thresholds.levelMax} m)`);
  }

  // 全局报警UI响应
  const hasAlarm = alarms.length > 0;
  const alertModal = $("#alert-modal");
  const alertBanner = $("#fixed-alarm-banner");
  const pingIndicator = $("#status-ping-indicator");
  const dotIndicator = $("#status-dot-indicator");
  const navStatus = $("#nav-system-status");
  const gradeBadge = $("#station-grade-badge");

  if (hasAlarm) {
    // 状态标识变为红色报警
    pingIndicator.style.backgroundColor = "#ef4444";
    dotIndicator.style.backgroundColor = "#ef4444";
    navStatus.textContent = `站点警报 (${alarms.length}项异常)`;
    navStatus.style.color = "#f87171";

    gradeBadge.className = "badge badge-alarm";
    gradeBadge.textContent = "🚨 劣 V 类水质 (超标预警)";

    // 模态弹窗与横幅展示
    alertModal.style.display = "block";
    $("#alert-modal-msg").innerHTML = `<strong>${current.name}：</strong><br/>` + alarms.map(a => `• ${a}`).join("<br/>");

    alertBanner.style.display = "flex";
    $("#fixed-alarm-text").textContent = `⚠️ 紧急水质水文告警：${current.name} 发生 ${alarms[0]}`;

    // 触发蜂鸣器
    if (isAudioEnabled && thresholds.enableAudioAlarm) {
      const now = Date.now();
      if (now - lastAlarmBeepTime > 3000) {
        playAlarmBeep();
        lastAlarmBeepTime = now;
      }
    }
  } else {
    // 恢复正常
    pingIndicator.style.backgroundColor = "var(--success-color)";
    dotIndicator.style.backgroundColor = "var(--success-color)";
    navStatus.textContent = "在线运行";
    navStatus.style.color = "#059669";

    gradeBadge.className = "badge badge-normal";
    gradeBadge.textContent = "🌿 国标 II 类水质 (优)";

    alertModal.style.display = "none";
    alertBanner.style.display = "none";
  }
}

function updateCardStatus(cardSelector: string, badgeSelector: string, isAlarm: boolean, text: string) {
  const card = $(cardSelector);
  const badge = $(badgeSelector);
  if (isAlarm) {
    card.setAttribute("data-status", "alarm");
    badge.className = "badge badge-alarm";
  } else {
    card.setAttribute("data-status", "normal");
    badge.className = "badge badge-normal";
  }
  badge.textContent = text;
}

// ================= 4. 设备控制（双模：手动 + 自动） =================
function runAutoControlLogic() {
  const current = stations[currentStationId];
  if (!current) return;

  // 1. 溶解氧联动增氧曝气泵
  if (thresholds.enableAutoAerator) {
    if (current.do < thresholds.doMin) {
      devices.aerator = true;
    } else if (current.do >= thresholds.doMin + 0.8) {
      devices.aerator = false;
    }
  }

  // 2. 浊度联动生态循环砂滤机
  if (current.turb > thresholds.turbMax) {
    devices.filter = true;
  } else if (current.turb <= thresholds.turbMax - 3.0) {
    devices.filter = false;
  }

  // 3. pH失衡联动酸碱调理投药机
  if (current.ph < thresholds.phMin || current.ph > thresholds.phMax) {
    devices.dosing = true;
  } else if (current.ph >= thresholds.phMin + 0.3 && current.ph <= thresholds.phMax - 0.3) {
    devices.dosing = false;
  }

  // 4. 水位汛期联动升降闸门
  if (thresholds.enableAutoGate) {
    if (current.level > thresholds.levelMax) {
      devices.gate = true;
    } else if (current.level <= thresholds.levelMax - 0.3) {
      devices.gate = false;
    }
  }
}

function renderDevices() {
  // 增氧曝气泵 (Pump)
  renderSingleDevice("aerator", devices.aerator, "⚡ 运行增氧中", "⏸ 待机停机");
  $("#runtime-aerator").textContent = devices.runtime.aerator.toFixed(1);

  // 砂滤机 (Filter)
  renderSingleDevice("filter", devices.filter, "🌀 循环净化中", "⏸ 待机停机");
  $("#runtime-filter").textContent = devices.runtime.filter.toFixed(1);

  // 投药机 (Dose)
  renderSingleDevice("dosing", devices.dosing, "🧪 加药中和中", "⏸ 待机停机");
  $("#runtime-dosing").textContent = devices.runtime.dosing.toFixed(1);

  // 升降闸门 (Gate)
  const gateCard = $("#dev-card-gate");
  const gateBadge = $("#dev-status-gate");
  const gateBtn = gateCard.querySelector(".dev-toggle-btn") as HTMLButtonElement;
  gateCard.setAttribute("data-active", devices.gate ? "true" : "false");
  if (devices.gate) {
    gateBadge.className = "badge badge-alarm";
    gateBadge.textContent = "🌊 已开启泄洪 (开度100%)";
    $("#gate-openness").textContent = "100%";
    gateBtn.textContent = "⏹ 关闭闸门";
    gateBtn.className = "btn btn-sm btn-danger dev-toggle-btn";
  } else {
    gateBadge.className = "badge badge-info";
    gateBadge.textContent = "⛩️ 闸门常闭 (开度0%)";
    $("#gate-openness").textContent = "0%";
    gateBtn.textContent = "▶ 开闸泄洪";
    gateBtn.className = "btn btn-sm btn-primary dev-toggle-btn";
  }

  // 控制模式徽章
  const modeBadge = $("#current-mode-badge");
  const toggleModeBtn = $("#toggle-global-mode-btn");
  if (controlMode === 'auto') {
    modeBadge.className = "badge badge-normal";
    modeBadge.textContent = "🤖 自动阈值联动模式";
    toggleModeBtn.textContent = "切换为手动模式";
  } else {
    modeBadge.className = "badge badge-info";
    modeBadge.textContent = "✋ 人工手动接管模式";
    toggleModeBtn.textContent = "切换为自动模式";
  }
}

function renderSingleDevice(devKey: 'aerator' | 'filter' | 'dosing', isActive: boolean, activeText: string, inactiveText: string) {
  const card = $(`#dev-card-${devKey}`);
  const badge = $(`#dev-status-${devKey}`);
  const btn = card.querySelector(".dev-toggle-btn") as HTMLButtonElement;

  card.setAttribute("data-active", isActive ? "true" : "false");
  if (isActive) {
    badge.className = "badge badge-normal";
    badge.textContent = activeText;
    btn.textContent = "⏹ 手动停机";
    btn.className = "btn btn-sm btn-danger dev-toggle-btn";
  } else {
    badge.className = "badge badge-info";
    badge.textContent = inactiveText;
    btn.textContent = "▶ 手动启动";
    btn.className = "btn btn-sm btn-primary dev-toggle-btn";
  }
}

// ================= 5. Canvas 图表绘制 (原生 HTML5 Canvas) =================
function initChartData() {
  const now = Date.now();
  for (let i = 24; i >= 0; i--) {
    const t = new Date(now - i * 2000);
    const timeStr = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}`;
    chartHistory.push({
      time: timeStr,
      temp: 22.0 + (Math.sin(i * 0.4) * 0.8),
      ph: 7.3 + (Math.cos(i * 0.3) * 0.1),
      do: 6.5 + (Math.sin(i * 0.5) * 0.5),
      turb: 6.0 + (Math.cos(i * 0.4) * 1.5),
      level: 1.65 + (Math.sin(i * 0.2) * 0.1),
    });
  }
}

function updateChartData() {
  const current = stations[currentStationId];
  if (!current) return;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  chartHistory.push({
    time: timeStr,
    temp: current.temp,
    ph: current.ph,
    do: current.do,
    turb: current.turb,
    level: current.level,
  });

  if (chartHistory.length > 30) {
    chartHistory.shift();
  }
}

function drawWaterChart() {
  const canvas = $("#waterChart") as HTMLCanvasElement;
  if (!canvas) return;

  // 自适应父容器宽度和设备像素比
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;

  // 清空画布
  ctx.clearRect(0, 0, w, h);

  // 绘制网格背景
  const paddingLeft = 50;
  const paddingRight = 30;
  const paddingTop = 20;
  const paddingBottom = 35;
  const plotW = w - paddingLeft - paddingRight;
  const plotH = h - paddingTop - paddingBottom;

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  const gridRows = 5;
  for (let r = 0; r <= gridRows; r++) {
    const y = paddingTop + (plotH / gridRows) * r;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(w - paddingRight, y);
    ctx.stroke();

    // 刻度百分比/标尺
    ctx.fillStyle = "#64748b";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    const valPercent = Math.round(100 - (100 / gridRows) * r);
    ctx.fillText(`${valPercent}%`, paddingLeft - 8, y + 3);
  }

  if (chartHistory.length < 2) return;

  const metricType = ($("#chart-metric-select") as HTMLSelectElement).value;

  // 绘制曲线的辅助函数
  const drawLine = (
    data: number[],
    minVal: number,
    maxVal: number,
    color: string,
    fillColor: string,
    label: string
  ) => {
    const stepX = plotW / (data.length - 1);
    const range = maxVal - minVal || 1;

    // 绘制填充阴影
    ctx.beginPath();
    ctx.moveTo(paddingLeft, paddingTop + plotH);
    for (let i = 0; i < data.length; i++) {
      const x = paddingLeft + i * stepX;
      const normalized = (data[i] - minVal) / range;
      const y = paddingTop + plotH - normalized * plotH;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(paddingLeft + (data.length - 1) * stepX, paddingTop + plotH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // 绘制主折线
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < data.length; i++) {
      const x = paddingLeft + i * stepX;
      const normalized = (data[i] - minVal) / range;
      const y = paddingTop + plotH - normalized * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 绘制最新值高亮点
    const lastX = paddingLeft + (data.length - 1) * stepX;
    const lastNormalized = (data[data.length - 1] - minVal) / range;
    const lastY = paddingTop + plotH - lastNormalized * plotH;

    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    // 标注最新值文本
    ctx.fillStyle = color;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${label}: ${data[data.length - 1]}`, lastX - 70, Math.max(paddingTop + 14, lastY - 8));
  };

  // 根据当前选择的指标绘制 (浅色明亮高辨识度线条)
  if (metricType === "all" || metricType === "do") {
    const doData = chartHistory.map(d => d.do);
    drawLine(doData, 0, 12, "#0284c7", "rgba(2, 132, 199, 0.08)", "DO");
  }

  if (metricType === "all" || metricType === "turb") {
    const turbData = chartHistory.map(d => d.turb);
    drawLine(turbData, 0, 30, "#d97706", "rgba(217, 119, 6, 0.08)", "NTU");
  }

  if (metricType === "all" || metricType === "temp") {
    const tempData = chartHistory.map(d => d.temp);
    drawLine(tempData, 10, 35, "#059669", "rgba(5, 150, 105, 0.08)", "Temp");
  }

  if (metricType === "level" || metricType === "all") {
    const levelData = chartHistory.map(d => d.level);
    drawLine(levelData, 0.5, 3.5, "#7c3aed", "rgba(124, 58, 237, 0.08)", "Level");
  }

  if (metricType === "ph") {
    const phData = chartHistory.map(d => d.ph);
    drawLine(phData, 5, 10, "#0d9488", "rgba(13, 148, 136, 0.08)", "pH");
  }

  // 绘制底部时间坐标刻度
  ctx.fillStyle = "#64748b";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  const stepX = plotW / (chartHistory.length - 1);
  const timeStep = Math.max(1, Math.floor(chartHistory.length / 5));
  for (let i = 0; i < chartHistory.length; i += timeStep) {
    const x = paddingLeft + i * stepX;
    ctx.fillText(chartHistory[i].time, x, paddingTop + plotH + 18);
  }
}

// ================= 6. 历史数据记录与管理 =================
function initInitialHistory() {
  const sampleTimes = [
    "08:10:20", "08:12:15", "08:14:30", "08:16:45", "08:18:22",
    "08:20:00", "08:22:18", "08:24:35", "08:26:50", "08:28:12"
  ];

  sampleTimes.forEach((t, idx) => {
    const isSpecialAlarm = idx === 3;
    historyRecords.push({
      id: nextHistoryId++,
      time: `2026-10-12 ${t}`,
      stationName: stations[1].name,
      temp: isSpecialAlarm ? 32.5 : 22.1 + (idx % 3) * 0.3,
      ph: isSpecialAlarm ? 8.9 : 7.32 + (idx % 2) * 0.08,
      do: isSpecialAlarm ? 3.4 : 6.8 - (idx % 4) * 0.2,
      turb: isSpecialAlarm ? 24.0 : 6.2 + (idx % 3) * 0.8,
      level: isSpecialAlarm ? 2.65 : 1.68 + (idx % 2) * 0.04,
      ec: isSpecialAlarm ? 840 : 410 + (idx % 5) * 12,
      grade: isSpecialAlarm ? "劣 V 类 (超标)" : "II 类 (优)",
      isAlarm: isSpecialAlarm,
      alarmMsg: isSpecialAlarm ? "溶解氧偏低与水温超标" : "指标全优",
      deviceStatusStr: isSpecialAlarm ? "曝气泵运行, 砂滤开启" : "全设备常态待机",
    });
  });
}

function captureSnapshot(isManual: boolean) {
  const current = stations[currentStationId];
  if (!current) return;

  const now = new Date();
  const timeStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  const isAlarm = current.temp < thresholds.tempMin || current.temp > thresholds.tempMax ||
                  current.ph < thresholds.phMin || current.ph > thresholds.phMax ||
                  current.do < thresholds.doMin || current.turb > thresholds.turbMax ||
                  current.level > thresholds.levelMax;

  let activeDevs: string[] = [];
  if (devices.aerator) activeDevs.push("曝气泵");
  if (devices.filter) activeDevs.push("循环滤");
  if (devices.dosing) activeDevs.push("投药机");
  if (devices.gate) activeDevs.push("排涝闸");

  const record: HistoryRecord = {
    id: nextHistoryId++,
    time: timeStr,
    stationName: current.name,
    temp: current.temp,
    ph: current.ph,
    do: current.do,
    turb: current.turb,
    level: current.level,
    ec: current.ec,
    grade: isAlarm ? "劣 V 类 (超标)" : "II 类 (优)",
    isAlarm: isAlarm,
    alarmMsg: isAlarm ? "存在超标指标" : "正常",
    deviceStatusStr: activeDevs.length > 0 ? activeDevs.join(", ") : "待机",
  };

  historyRecords.unshift(record);

  // 保持最多 100 条
  if (historyRecords.length > 100) {
    historyRecords.pop();
  }

  renderHistoryTable();

  if (isManual) {
    showNotification("已成功捕获当前采样快照！");
  }
}

function renderHistoryTable() {
  const tbody = $("#history-tbody");
  const filterType = ($("#filter-status-select") as HTMLSelectElement).value;

  const filtered = historyRecords.filter(r => {
    if (filterType === "alarm") return r.isAlarm;
    if (filterType === "normal") return !r.isAlarm;
    return true;
  });

  $("#history-total-count").textContent = filtered.length.toString();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: #64748b; padding: 24px;">暂无匹配的历史监测数据记录</td></tr>`;
    resetTfoot();
    return;
  }

  let html = "";
  let sumTemp = 0, sumPh = 0, sumDo = 0, sumTurb = 0, sumLevel = 0, sumEc = 0;

  filtered.forEach(r => {
    sumTemp += r.temp;
    sumPh += r.ph;
    sumDo += r.do;
    sumTurb += r.turb;
    sumLevel += r.level;
    sumEc += r.ec;

    const rowStyle = r.isAlarm ? `style="background-color: rgba(239, 68, 68, 0.12);"` : "";
    const badgeClass = r.isAlarm ? "badge badge-alarm" : "badge badge-normal";

    html += `
      <tr ${rowStyle} data-record-id="${r.id}">
        <td><strong>#${r.id}</strong></td>
        <td style="font-family: monospace; font-size: 11px;">${r.time}</td>
        <td>${r.stationName}</td>
        <td style="color: ${r.temp > thresholds.tempMax ? '#f87171' : '#f1f5f9'}; font-weight: 600;">${r.temp.toFixed(1)}</td>
        <td style="color: ${(r.ph < thresholds.phMin || r.ph > thresholds.phMax) ? '#f87171' : '#f1f5f9'};">${r.ph.toFixed(2)}</td>
        <td style="color: ${r.do < thresholds.doMin ? '#f87171' : '#38bdf8'}; font-weight: 700;">${r.do.toFixed(2)}</td>
        <td style="color: ${r.turb > thresholds.turbMax ? '#f87171' : '#f1f5f9'};">${r.turb.toFixed(1)}</td>
        <td style="color: ${r.level > thresholds.levelMax ? '#f87171' : '#f1f5f9'};">${r.level.toFixed(2)}</td>
        <td>${r.ec}</td>
        <td><span class="${badgeClass}">${r.grade}</span></td>
        <td style="font-size: 11px; color: #94a3b8;">${r.deviceStatusStr}</td>
        <td>
          <button class="btn btn-sm btn-secondary delete-record-btn" data-id="${r.id}" style="padding: 2px 8px; font-size: 11px;">删除</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  // 绑定行删除按钮事件
  tbody.querySelectorAll(".delete-record-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const targetId = parseInt((e.currentTarget as HTMLElement).getAttribute("data-id") || "0");
      historyRecords = historyRecords.filter(r => r.id !== targetId);
      renderHistoryTable();
    });
  });

  // 更新表尾平均值
  const n = filtered.length;
  $("#tfoot-avg-temp").textContent = `平均: ${(sumTemp / n).toFixed(1)}℃`;
  $("#tfoot-avg-ph").textContent = `平均: ${(sumPh / n).toFixed(2)}`;
  $("#tfoot-avg-do").textContent = `平均: ${(sumDo / n).toFixed(2)}`;
  $("#tfoot-avg-turb").textContent = `平均: ${(sumTurb / n).toFixed(1)}`;
  $("#tfoot-avg-level").textContent = `平均: ${(sumLevel / n).toFixed(2)}m`;
  $("#tfoot-avg-ec").textContent = `平均: Math.round(sumEc / n)`;
}

function resetTfoot() {
  $("#tfoot-avg-temp").textContent = "平均: --";
  $("#tfoot-avg-ph").textContent = "平均: --";
  $("#tfoot-avg-do").textContent = "平均: --";
  $("#tfoot-avg-turb").textContent = "平均: --";
  $("#tfoot-avg-level").textContent = "平均: --";
  $("#tfoot-avg-ec").textContent = "平均: --";
}

// 导出 CSV 功能 (纯原生JS实现)
function exportHistoryToCSV() {
  if (historyRecords.length === 0) {
    alert("当前无历史数据可导出！");
    return;
  }

  const headers = ["序号", "采样时间", "监测站点", "水温(℃)", "pH值", "溶解氧(mg/L)", "浊度(NTU)", "水位(m)", "电导率(μS/cm)", "水质评级", "联动设备工况"];
  const rows = historyRecords.map(r => [
    r.id,
    `"${r.time}"`,
    `"${r.stationName}"`,
    r.temp,
    r.ph,
    r.do,
    r.turb,
    r.level,
    r.ec,
    `"${r.grade}"`,
    `"${r.deviceStatusStr}"`
  ]);

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `校园水文水质监测历史数据_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ================= 用户身份认证与登录控制器 =================
function generateCaptcha(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function refreshCaptchaUI() {
  currentCaptcha = generateCaptcha();
  const el = $("#captcha-display");
  if (el) el.textContent = currentCaptcha;
}

function openLoginModal() {
  refreshCaptchaUI();
  const usernameInput = $("#login-username") as HTMLInputElement;
  const passwordInput = $("#login-password") as HTMLInputElement;
  const captchaInput = $("#login-captcha") as HTMLInputElement;
  if (usernameInput) usernameInput.value = "";
  if (passwordInput) passwordInput.value = "";
  if (captchaInput) captchaInput.value = "";

  const overlay = $("#login-modal-overlay");
  if (overlay) overlay.style.display = "flex";
}

function closeLoginModal() {
  const overlay = $("#login-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

function updateAuthUI() {
  const avatarIcon = $("#user-avatar-icon");
  const displayName = $("#user-display-name");
  const roleBadge = $("#user-role-badge");
  const authBtn = $("#auth-action-btn");
  const adminAccountInput = $("#admin-account") as HTMLInputElement;

  if (currentUser) {
    if (avatarIcon) avatarIcon.textContent = currentUser.avatar;
    if (displayName) displayName.textContent = currentUser.displayName;
    if (roleBadge) {
      roleBadge.textContent = currentUser.roleName;
      if (currentUser.role === 'admin') {
        roleBadge.className = "badge badge-alarm";
      } else {
        roleBadge.className = "badge badge-info";
      }
    }
    if (authBtn) {
      authBtn.textContent = "退出";
      authBtn.className = "btn btn-sm btn-secondary";
    }
    if (adminAccountInput && currentUser.role === 'admin') {
      adminAccountInput.value = currentUser.username;
    }
  } else {
    if (avatarIcon) avatarIcon.textContent = "👤";
    if (displayName) displayName.textContent = "访客";
    if (roleBadge) {
      roleBadge.textContent = "研学";
      roleBadge.className = "badge badge-info";
    }
    if (authBtn) {
      authBtn.textContent = "登录";
      authBtn.className = "btn btn-sm btn-primary";
    }
    if (adminAccountInput) {
      adminAccountInput.value = "admin";
    }
  }
}

function fillQuickAccount(roleKey: 'admin' | 'guest') {
  const usernameInput = $("#login-username") as HTMLInputElement;
  const passwordInput = $("#login-password") as HTMLInputElement;
  const roleSelect = $("#login-role") as HTMLSelectElement;
  const captchaInput = $("#login-captcha") as HTMLInputElement;

  const targetKey = roleKey === 'guest' ? 'guest' : 'admin';
  const acc = ACCOUNTS[targetKey];
  if (acc) {
    if (usernameInput) usernameInput.value = acc.user.username;
    if (passwordInput) passwordInput.value = acc.password;
    if (roleSelect) roleSelect.value = acc.user.role;
    if (captchaInput) captchaInput.value = currentCaptcha; // 自动填入当前验证码
  }
  showNotification(`已快速填入【${acc.user.roleName}】测试账号`);
}

function handleLoginFormSubmit(e: Event) {
  e.preventDefault();

  const username = ($("#login-username") as HTMLInputElement).value.trim();
  const password = ($("#login-password") as HTMLInputElement).value.trim();
  const role = ($("#login-role") as HTMLSelectElement).value;
  const captcha = ($("#login-captcha") as HTMLInputElement).value.trim().toUpperCase();
  const remember = ($("#login-remember") as HTMLInputElement).checked;

  // 1. 验证码校验
  if (captcha !== currentCaptcha) {
    alert("❌ 验证码输入错误，请重新输入！");
    refreshCaptchaUI();
    ($("#login-captcha") as HTMLInputElement).value = "";
    return;
  }

  // 2. 账号密码匹配 (写死只留 admin 和 guest)
  const account = ACCOUNTS[username.toLowerCase()];
  if (!account || account.password !== password) {
    alert("❌ 登录失败：账号或密码错误！\n（提示：系统写死用户为 管理员 admin / 123456，访客 guest / 123456）");
    refreshCaptchaUI();
    return;
  }

  // 3. 登录成功
  currentUser = {
    ...account.user,
    role: role as 'admin' | 'guest',
  };

  if (remember) {
    localStorage.setItem("campus_water_auth", JSON.stringify(currentUser));
  } else {
    sessionStorage.setItem("campus_water_auth", JSON.stringify(currentUser));
  }

  updateAuthUI();
  closeLoginModal();
  showNotification(`🎉 欢迎您，${currentUser.displayName}！已获得【${currentUser.roleName}】系统权限。`);
}

function handleLogout() {
  if (confirm("确定要退出当前账号登录状态吗？")) {
    currentUser = null;
    localStorage.removeItem("campus_water_auth");
    sessionStorage.removeItem("campus_water_auth");
    updateAuthUI();
    showNotification("已安全退出系统登录");
  }
}

// ================= 7. 表单校验与阈值保存 =================
function renderThresholdDisplays() {
  $("#thresh-display-temp").textContent = `${thresholds.tempMin.toFixed(1)} ~ ${thresholds.tempMax.toFixed(1)}`;
  $("#thresh-display-ph").textContent = `${thresholds.phMin.toFixed(2)} ~ ${thresholds.phMax.toFixed(2)}`;
  $("#thresh-display-do").textContent = thresholds.doMin.toFixed(1);
  $("#thresh-display-turb").textContent = thresholds.turbMax.toFixed(1);
  $("#thresh-display-level").textContent = thresholds.levelMax.toFixed(2);
}

function handleThresholdFormSubmit(e: Event) {
  e.preventDefault();

  // 0. 权限校验 (RBAC)
  if (!currentUser || currentUser.role !== 'admin') {
    alert("⚠️ 权限限制：当前操作人员无权修改核心安全阈值！\n仅【系统超级管理员】拥有此权限。\n请先登录管理员账号 (测试账号: admin / 密码: 123456)。");
    openLoginModal();
    return;
  }

  const form = $("#threshold-config-form") as HTMLFormElement;
  const adminAccount = ($("#admin-account") as HTMLInputElement).value.trim();
  const passwordInput = ($("#admin-password") as HTMLInputElement).value.trim();

  // 1. 密码校验 (演示口令: admin123 或 123456)
  if (passwordInput !== "admin123" && passwordInput !== "123456") {
    alert("❌ 权限校验失败：管理员密码错误！\n（提示：测试默认管理员口令为 admin123 或 123456）");
    return;
  }

  // 2. 表单数值提取
  const tempMin = parseFloat(($("#input-temp-min") as HTMLInputElement).value);
  const tempMax = parseFloat(($("#input-temp-max") as HTMLInputElement).value);
  const phMin = parseFloat(($("#input-ph-min") as HTMLInputElement).value);
  const phMax = parseFloat(($("#input-ph-max") as HTMLInputElement).value);
  const doMin = parseFloat(($("#input-do-min") as HTMLInputElement).value);
  const turbMax = parseFloat(($("#input-turb-max") as HTMLInputElement).value);
  const levelMax = parseFloat(($("#input-level-max") as HTMLInputElement).value);

  // 3. 原生表单边界校验
  if (tempMin >= tempMax) {
    alert("❌ 表单校验错误：水温下限不能大于或等于水温上限！");
    return;
  }
  if (phMin >= phMax) {
    alert("❌ 表单校验错误：pH 下限不能大于或等于 pH 上限！");
    return;
  }
  if (doMin <= 0 || turbMax <= 0 || levelMax <= 0) {
    alert("❌ 表单校验错误：溶解氧、浊度及水位警戒阈值必须大于 0！");
    return;
  }

  // 4. 更新内存阈值
  thresholds.tempMin = tempMin;
  thresholds.tempMax = tempMax;
  thresholds.phMin = phMin;
  thresholds.phMax = phMax;
  thresholds.doMin = doMin;
  thresholds.turbMax = turbMax;
  thresholds.levelMax = levelMax;

  // 单选与复选模式提取
  const radioAuto = form.querySelector('input[name="formControlMode"][value="auto"]') as HTMLInputElement;
  controlMode = radioAuto.checked ? 'auto' : 'manual';

  thresholds.enableAudioAlarm = ($("#chk-audio-alarm") as HTMLInputElement).checked;
  thresholds.enableAutoAerator = ($("#chk-auto-aerator") as HTMLInputElement).checked;
  thresholds.enableAutoGate = ($("#chk-auto-gate") as HTMLInputElement).checked;

  renderThresholdDisplays();
  renderDevices();
  checkThresholdsAndAlarm();

  alert(`✅ 阈值配置已成功更新并生效！\n操作人员: ${adminAccount}\n当前控制模式: ${controlMode === 'auto' ? '自动阈值联动' : '手动控制'}\n系统将依据新规则进行实时超限报警与自动化控制。`);
}

// 恢复默认推荐国标
function handleFormReset() {
  setTimeout(() => {
    thresholds.tempMin = 10.0;
    thresholds.tempMax = 30.0;
    thresholds.phMin = 6.5;
    thresholds.phMax = 8.5;
    thresholds.doMin = 5.0;
    thresholds.turbMax = 15.0;
    thresholds.levelMax = 2.50;
    thresholds.enableAudioAlarm = true;
    thresholds.enableAutoAerator = true;
    thresholds.enableAutoGate = true;
    controlMode = 'auto';

    renderThresholdDisplays();
    renderDevices();
    checkThresholdsAndAlarm();
    showNotification("已恢复国家地表水环境质量标准 III 类默认基准！");
  }, 50);
}

// ================= 8. Web Audio API 音效警报 =================
function playAlarmBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    // 双频交替蜂鸣音 (880Hz -> 440Hz)
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(440, audioCtx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch {
    // 忽略未交互时的策略限制
  }
}

// ================= 9. 事件绑定与用户交互 =================
function bindEvents() {
  // 站点切换
  $("#station-select-top").addEventListener("change", (e) => {
    currentStationId = parseInt((e.target as HTMLSelectElement).value);
    renderRealtimeCards();
    checkThresholdsAndAlarm();
    showNotification(`已切换至：${stations[currentStationId].name}`);
  });

  // 刷新暂停与恢复
  $("#auto-refresh-toggle").addEventListener("click", () => {
    isAutoRefreshActive = !isAutoRefreshActive;
    const btn = $("#auto-refresh-toggle");
    if (isAutoRefreshActive) {
      btn.textContent = "⏸ 暂停刷新";
      btn.className = "btn btn-sm btn-secondary";
      showNotification("已恢复实时遥测刷新 (2秒/次)");
    } else {
      btn.textContent = "▶ 恢复刷新";
      btn.className = "btn btn-sm btn-primary";
      showNotification("实时遥测已暂停");
    }
  });

  // 手动立即遥测
  $("#refresh-manual-btn").addEventListener("click", () => {
    simulateSensorFluctuation();
    renderRealtimeCards();
    checkThresholdsAndAlarm();
    drawWaterChart();
    showNotification("已手动拉取传感器最新遥测数据帧");
  });

  // 音频警报开关
  $("#toggle-audio-btn").addEventListener("click", () => {
    isAudioEnabled = !isAudioEnabled;
    const btn = $("#toggle-audio-btn");
    btn.textContent = isAudioEnabled ? "告警音效: 开" : "告警音效: 关";
    btn.className = isAudioEnabled ? "btn btn-sm btn-secondary" : "btn btn-sm btn-danger";
    showNotification(isAudioEnabled ? "告警音效已开启" : "告警音效已静音");
  });

  // 模式切换按钮 (全局)
  $("#toggle-global-mode-btn").addEventListener("click", () => {
    controlMode = controlMode === 'auto' ? 'manual' : 'auto';
    // 同步到表单单选框
    const radios = document.querySelectorAll('input[name="formControlMode"]') as NodeListOf<HTMLInputElement>;
    radios.forEach(r => {
      if (r.value === controlMode) r.checked = true;
    });
    renderDevices();
    showNotification(`已切换至：${controlMode === 'auto' ? '自动阈值联动模式' : '人工手动接管模式'}`);
  });

  // 设备手动切换按钮事件委托
  document.querySelectorAll(".dev-toggle-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      // 权限检查：需登录，访客无权操作
      if (!currentUser) {
        alert("权限限制：请先登录系统后再执行设备远程控制！");
        openLoginModal();
        return;
      }
      if (currentUser.role === 'guest') {
        alert("权限限制：研学访客账号仅享有数据与图表浏览权限，无法人工遥控现场治理设备！\n请切换登录为管理员 (admin / 123456) 账号。");
        openLoginModal();
        return;
      }

      const targetDev = (e.currentTarget as HTMLElement).getAttribute("data-target") as keyof typeof devices;
      if (!targetDev) return;

      if (controlMode === 'auto') {
        const confirmSwitch = confirm("当前处于【自动模式】。点击此按钮将临时人工干预切换该设备状态，是否继续？");
        if (!confirmSwitch) return;
      }

      // 切换状态
      devices[targetDev as 'aerator' | 'filter' | 'dosing' | 'gate'] = !devices[targetDev as 'aerator' | 'filter' | 'dosing' | 'gate'];
      renderDevices();
      showNotification(`已手动切换设备工况状态！`);
    });
  });

  // 模拟场景测试按钮
  // 暴雨汛期
  $("#sim-storm-btn").addEventListener("click", () => {
    const cur = stations[currentStationId];
    cur.level = 2.85; // 超汛期水位
    cur.turb = 18.2;  // 伴随泥沙浊度升高
    renderRealtimeCards();
    checkThresholdsAndAlarm();
    if (controlMode === 'auto') runAutoControlLogic();
    renderDevices();
    drawWaterChart();
    showNotification("已模拟【暴雨汛期】工况：水位涨至 2.85m！");
  });

  // 突发污染
  $("#sim-pollute-btn").addEventListener("click", () => {
    const cur = stations[currentStationId];
    cur.do = 2.4;    // 严重缺氧
    cur.turb = 28.5; // 泥浊度升高
    cur.ph = 9.2;    // 偏碱性水质
    renderRealtimeCards();
    checkThresholdsAndAlarm();
    if (controlMode === 'auto') runAutoControlLogic();
    renderDevices();
    drawWaterChart();
    showNotification("已模拟【突发污染事件】：低氧(2.4mg/L) & 高浊(28.5NTU)");
  });

  // 恢复优良水质
  $("#sim-recover-btn").addEventListener("click", () => {
    const cur = stations[currentStationId];
    cur.temp = 22.2;
    cur.ph = 7.35;
    cur.do = 7.2;
    cur.turb = 5.2;
    cur.level = 1.65;
    cur.ec = 390;
    renderRealtimeCards();
    checkThresholdsAndAlarm();
    if (controlMode === 'auto') runAutoControlLogic();
    renderDevices();
    drawWaterChart();
    showNotification("已恢复标准优良生态水质，告警解除");
  });

  // 图表参数选择变化
  $("#chart-metric-select").addEventListener("change", () => {
    drawWaterChart();
  });

  // 历史表格操作
  $("#add-snapshot-btn").addEventListener("click", () => {
    captureSnapshot(true);
  });

  $("#export-csv-btn").addEventListener("click", () => {
    exportHistoryToCSV();
  });

  $("#clear-history-btn").addEventListener("click", () => {
    // 权限检查：仅管理员可清空
    if (!currentUser || currentUser.role !== 'admin') {
      alert("权限限制：仅【系统超级管理员】拥有清空历史监测数据归档的权限！\n请先登录管理员账号 (admin / 123456)。");
      openLoginModal();
      return;
    }

    if (confirm("确定要清空当前的全部历史监测记录吗？此操作不可撤销！")) {
      historyRecords = [];
      renderHistoryTable();
      showNotification("历史记录已清空");
    }
  });

  $("#filter-status-select").addEventListener("change", () => {
    renderHistoryTable();
  });

  // 警报模态窗关闭与操作
  $("#alert-modal-close").addEventListener("click", () => {
    $("#alert-modal").style.display = "none";
  });

  $("#alert-action-mute").addEventListener("click", () => {
    isAudioEnabled = false;
    $("#toggle-audio-btn").textContent = "告警音效: 关";
    $("#toggle-audio-btn").className = "btn btn-sm btn-danger";
    $("#alert-modal").style.display = "none";
    showNotification("已临时静音告警蜂鸣");
  });

  $("#alert-action-resolve").addEventListener("click", () => {
    controlMode = 'auto';
    devices.aerator = true;
    devices.filter = true;
    devices.dosing = true;
    devices.gate = true;
    renderDevices();
    $("#alert-modal").style.display = "none";
    showNotification("已下发治理指令：增氧机、净化滤泵与闸门联动运行");
  });

  $("#banner-quick-link").addEventListener("click", () => {
    $("#alert-modal").style.display = "block";
    const realtimeSec = $("#section-realtime");
    if (realtimeSec) {
      const top = realtimeSec.getBoundingClientRect().top + window.pageYOffset - 65;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });

  // 表单提交与重置
  $("#threshold-config-form").addEventListener("submit", handleThresholdFormSubmit);
  $("#form-reset-btn").addEventListener("click", handleFormReset);

  // ================= 导航栏平滑滑动交互与滚动监听 (Smooth Scroll & Scrollspy) =================
  document.querySelectorAll<HTMLAnchorElement>('.nav-links a[href^="#"], .back-to-top, a[href="#section-top"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#' || href === 'javascript:void(0);') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const navHeight = 64;
        const targetTop = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
        window.scrollTo({
          top: targetTop,
          behavior: 'smooth'
        });
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        if (anchor.closest('.nav-links')) {
          anchor.classList.add('active');
        }
      }
    });
  });

  // 监听页面滚动，为导航栏高亮当前可见章节
  window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll<HTMLElement>('section[id], header[id]');
    let currentId = '';
    const scrollPos = window.pageYOffset + 120;
    sections.forEach(sec => {
      if (scrollPos >= sec.offsetTop && scrollPos < sec.offsetTop + sec.offsetHeight) {
        currentId = sec.getAttribute('id') || '';
      }
    });
    if (currentId) {
      document.querySelectorAll('.nav-links a').forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === `#${currentId}`);
      });
    }
  }, { passive: true });

  // ================= 现场照片替换与自定义上传处理 (FileReader) =================
  document.querySelectorAll<HTMLInputElement>('.station-photo-input').forEach(input => {
    input.addEventListener('change', () => {
      const targetImgId = input.getAttribute('data-target');
      if (!targetImgId || !input.files || !input.files[0]) return;
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const imgEl = document.getElementById(targetImgId) as HTMLImageElement;
        if (imgEl && ev.target?.result) {
          imgEl.src = ev.target.result as string;
          showNotification("已成功替换该站点现场照片！");
        }
      };
      reader.readAsDataURL(file);
    });
  });

  // 自定义现场照片上传插槽
  const customFileInput = document.getElementById('custom-photo-file-input') as HTMLInputElement;
  if (customFileInput) {
    customFileInput.addEventListener('change', () => {
      if (!customFileInput.files || !customFileInput.files[0]) return;
      const file = customFileInput.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const previewContainer = document.getElementById('custom-slot-preview');
        const previewImg = document.getElementById('img-custom-preview') as HTMLImageElement;
        if (previewContainer && previewImg && ev.target?.result) {
          previewImg.src = ev.target.result as string;
          previewContainer.style.display = 'block';
          showNotification("已成功上传并展示自定义现场照片！");
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // ================= 登录认证交互事件绑定 =================
  // 顶栏登录/退出按钮
  $("#auth-action-btn").addEventListener("click", () => {
    if (currentUser) {
      handleLogout();
    } else {
      openLoginModal();
    }
  });

  // 登录窗关闭
  $("#login-close-btn").addEventListener("click", closeLoginModal);

  // 点击遮罩外部背景关闭
  const loginOverlay = $("#login-modal-overlay");
  if (loginOverlay) {
    loginOverlay.addEventListener("click", (e) => {
      if (e.target === loginOverlay) {
        closeLoginModal();
      }
    });
  }

  // 验证码点击刷新
  const captchaDisplay = $("#captcha-display");
  if (captchaDisplay) {
    captchaDisplay.addEventListener("click", refreshCaptchaUI);
  }

  // 快捷填入测试账号 (仅保留管理员和访客)
  const quickAdmin = $("#quick-login-admin");
  if (quickAdmin) quickAdmin.addEventListener("click", () => fillQuickAccount('admin'));

  const quickGuest = $("#quick-login-guest");
  if (quickGuest) quickGuest.addEventListener("click", () => fillQuickAccount('guest'));

  // 登录表单提交
  const loginForm = $("#system-login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLoginFormSubmit);
  }

  // 忘记密码提示链接
  const loginHelpLink = $("#login-help-link");
  if (loginHelpLink) {
    loginHelpLink.addEventListener("click", () => {
      alert("预置系统写死用户账号：\n\n1. 超级管理员：\n   账号: admin  密码: 123456\n   权限: 全部控制、阈值配置、数据导出与清空\n\n2. 校园研学访客：\n   账号: guest  密码: 123456\n   权限: 仅查看实时数据看板与趋势图表");
    });
  }
}

// ================= 10. 辅助工具函数 =================
function updateClock() {
  const now = new Date();
  const timeStr = `${now.getFullYear()}年${(now.getMonth()+1).toString().padStart(2, '0')}月${now.getDate().toString().padStart(2, '0')}日 ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  const el = $("#current-time-text");
  if (el) el.textContent = timeStr;
}

// 页面操作轻提示通知 (纯原生DOM创建 - 清新浅色风格)
function showNotification(msg: string) {
  const toast = document.createElement("div");
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed;
    top: 76px;
    left: 50%;
    transform: translateX(-50%);
    background: #ffffff;
    border: 1.5px solid #0284c7;
    color: #0284c7;
    padding: 10px 22px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 4px 18px rgba(2, 132, 199, 0.18);
    z-index: 3000;
    transition: all 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

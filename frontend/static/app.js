(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const numberFormat = new Intl.NumberFormat();
  const fullDateFormat = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const shortDateFormat = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  const monthDateFormat = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  });
  const monthShortFormat = new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "2-digit",
  });
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const state = {
    controller: null,
    timelineController: null,
    monthController: null,
    fromTs: null,
    toTs: null,
    preset: "all",
    topTab: "artists",
    timelineChart: null,
    heatmapChart: null,
  };

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Cover art is served by the backend from the local Navidrome library. Items
  // the library does not have simply come back without an "art" id.
  function coverId(item) {
    const art = item && item.art;
    return typeof art === "string" && art ? art : null;
  }

  function rankArt(cover) {
    const img = document.createElement("img");
    img.className = "rank-art";
    img.src = `/api/art/${encodeURIComponent(cover)}?size=128`;
    img.alt = "";
    img.width = 40;
    img.height = 40;
    img.loading = "lazy";
    img.decoding = "async";
    // A missing or unreachable image falls back to the empty slot, not a broken
    // icon, and keeps the grid column intact.
    img.addEventListener("error", () => img.replaceWith(create("span", "rank-art")));
    return img;
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormat.format(number) : "0";
  }

  function plural(count, singular, pluralForm) {
    return count === 1 ? singular : pluralForm || `${singular}s`;
  }

  function formatMinutes(value) {
    const total = Math.round(Number(value) || 0);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (hours && minutes) return `${formatNumber(hours)}h\u00a0${minutes}m`;
    if (hours) return `${formatNumber(hours)}h`;
    return `${minutes}m`;
  }

  function parseLocalDate(value) {
    const parts = String(value).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function toDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDateFromTs(timestamp) {
    return fullDateFormat.format(new Date(timestamp * 1000));
  }

  function formatDateFromIso(value) {
    return fullDateFormat.format(parseLocalDate(value));
  }

  function formatShortFromIso(value) {
    return shortDateFormat.format(parseLocalDate(value));
  }

  function formatDateLabel(value, granularity) {
    if (granularity === "week") {
      const [year, week] = String(value).split("-W");
      return `Week ${week}, ${year}`;
    }
    if (granularity === "month") {
      const [year, month] = String(value).split("-").map(Number);
      return monthDateFormat.format(new Date(year, month - 1, 1));
    }
    return formatDateFromIso(value);
  }

  function chartPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      ink: styles.getPropertyValue("--ink").trim(),
      muted: styles.getPropertyValue("--muted").trim(),
      rule: styles.getPropertyValue("--rule").trim(),
      paper: styles.getPropertyValue("--paper").trim(),
      surface: styles.getPropertyValue("--surface").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
    };
  }

  function setLoading(active) {
    const main = byId("main");
    if (main) main.setAttribute("aria-busy", active ? "true" : "false");
  }

  function showError(message, retry) {
    const banner = byId("status-banner");
    if (!banner) return;
    clear(banner);
    banner.append(create("p", null, message));
    if (retry) {
      const button = create("button", "text-btn", "Retry");
      button.type = "button";
      button.addEventListener("click", retry);
      banner.append(button);
    }
    banner.hidden = false;
  }

  function hideError() {
    const banner = byId("status-banner");
    if (!banner) return;
    banner.hidden = true;
    clear(banner);
  }

  function showFragmentError(container, message, retry) {
    clear(container);
    container.append(create("p", "empty-state", message));
    if (retry) {
      const button = create("button", "text-btn", "Try again");
      button.type = "button";
      button.addEventListener("click", retry);
      container.append(button);
    }
  }

  async function getJson(url, signal) {
    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return response.json();
  }

  async function getText(url, signal) {
    const response = await fetch(url, {
      signal,
      headers: { Accept: "text/html" },
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return response.text();
  }

  function setPreset(value) {
    document.querySelectorAll(".range-btn").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        button.dataset.days === String(value) ? "true" : "false"
      );
    });
  }

  function setDateInputs(fromDate, toDate) {
    byId("from").value = fromDate ? toDateInput(fromDate) : "";
    byId("to").value = toDate ? toDateInput(toDate) : "";
  }

  function chooseGranularity(fromTs, toTs, range) {
    const start = fromTs ?? range.first_listen_ts;
    const end = toTs ?? range.last_listen_ts ?? Math.floor(Date.now() / 1000);
    if (!start || !end) return "day";
    const days = Math.max(1, Math.ceil((end - start) / 86400));
    if (days <= 45) return "day";
    if (days <= 400) return "week";
    return "month";
  }

  function rangeQuery(fromTs, toTs) {
    const params = new URLSearchParams();
    if (fromTs) params.set("from_", String(fromTs));
    if (toTs) params.set("to_", String(toTs));
    return params;
  }

  function rangeLabel(range) {
    const from = state.fromTs ?? range.first_listen_ts;
    const to = state.toTs ?? range.last_listen_ts;
    if (!from || !to) return null;
    const fromDate = new Date(from * 1000);
    const toDate = new Date(to * 1000);
    if (fromDate.toDateString() === toDate.toDateString()) {
      return `on ${fullDateFormat.format(fromDate)}`;
    }
    return `from ${fullDateFormat.format(fromDate)} to ${fullDateFormat.format(toDate)}`;
  }

  function renderRange(data) {
    const total = Number(data.total_listens) || 0;
    const label = rangeLabel(data);
    const summary = byId("range-summary");

    if (!total) {
      summary.textContent = label
        ? `No listens ${label}. Try a wider range.`
        : "No listens in this archive yet.";
    } else {
      summary.textContent = `${formatNumber(total)} ${plural(
        total,
        "listen"
      )} ${label}. ${formatMinutes(data.total_minutes)} across ${formatNumber(
        data.unique_artists
      )} ${plural(data.unique_artists || 0, "artist")}.`;
    }

    byId("stat-listens").textContent = formatNumber(total);
    byId("stat-time").textContent = formatMinutes(data.total_minutes);
    byId("stat-artists").textContent = formatNumber(data.unique_artists);

    const busiest = byId("stat-busiest");
    const busiestNote = byId("stat-busiest-note");
    if (data.busiest_day) {
      busiest.textContent = formatDateFromIso(data.busiest_day);
      const count = Number(data.busiest_day_listens) || 0;
      busiestNote.textContent = `${formatNumber(count)} ${plural(count, "listen")}`;
    } else {
      busiest.textContent = "None";
      busiestNote.textContent = "";
    }

    renderTopList("panel-artists", data.top_artists || [], "artists");
    renderTopList("panel-tracks", data.top_tracks || [], "tracks");
    renderTopList("panel-albums", data.top_albums || [], "albums");
    renderHeatmap(data);
  }

  function renderTopList(containerId, items, kind) {
    const container = byId(containerId);
    if (!container) return;
    clear(container);

    if (!items.length) {
      const label = kind === "artists" ? "artists" : kind;
      container.append(
        create(
          "p",
          "empty-state",
          `No ${label} in this range.`
        )
      );
      return;
    }

    const list = create("ol", "rank-list");
    const rows = items.slice(0, 10);
    // Reserve the thumbnail column only when at least one row has cover art.
    const withArt = rows.some((item) => coverId(item));
    if (withArt) list.classList.add("has-art");

    rows.forEach((item, index) => {
      let title = "";
      let meta = "";
      if (kind === "artists") {
        title = item.artist || "Unknown artist";
      } else if (kind === "tracks") {
        title = item.track || "Unknown track";
        meta = item.artist || "";
      } else {
        title = item.album || "Unknown album";
        meta = item.artist || "";
      }

      const count = Number(item.count) || 0;
      const row = create("li", "rank-item");
      if (withArt) {
        const cover = coverId(item);
        row.append(cover ? rankArt(cover) : create("span", "rank-art"));
      }
      row.append(create("span", "rank-number", String(index + 1)));

      const name = create("span", "rank-name");
      name.append(create("span", "rank-title", title));
      if (meta) name.append(create("span", "rank-meta", meta));
      row.append(name);
      row.append(
        create("span", "rank-count", `${formatNumber(count)} ${plural(count, "listen")}`)
      );
      list.append(row);
    });

    container.append(list);
  }

  function renderTimeline(data, granularity) {
    const series = data.series || [];
    const chartElement = byId("chart-timeline");
    const empty = byId("timeline-empty");
    const note = byId("timeline-note");
    const details = byId("timeline-data");
    const tableContainer = byId("timeline-table");

    if (!series.length) {
      note.textContent = "";
      empty.hidden = false;
      chartElement.hidden = true;
      details.hidden = true;
      details.open = false;
      if (state.timelineChart) state.timelineChart.clear();
      return;
    }

    empty.hidden = true;
    chartElement.hidden = false;
    details.hidden = false;

    const peak = series.reduce(
      (best, item) => (item.listens > best.listens ? item : best),
      series[0]
    );
    const total = series.reduce((sum, item) => sum + Number(item.listens || 0), 0);
    note.textContent = `Peak: ${formatNumber(peak.listens)} ${plural(
      peak.listens,
      "listen"
    )} on ${formatDateLabel(peak.date, granularity)}.`;
    chartElement.setAttribute(
      "aria-label",
      `Listening over time. ${formatNumber(total)} listens in ${series.length} points. Peak of ${formatNumber(
        peak.listens
      )} listens on ${formatDateLabel(peak.date, granularity)}.`
    );

    if (!state.timelineChart) {
      state.timelineChart = window.echarts.init(chartElement);
      window.addEventListener("resize", () => {
        if (state.timelineChart) state.timelineChart.resize();
      });
    }
    state.timelineChart.resize();

    const palette = chartPalette();
    const labels = series.map((item) => item.date);

    state.timelineChart.setOption(
      {
        animationDuration: reduceMotion ? 0 : 300,
        backgroundColor: "transparent",
        grid: { left: 44, right: 14, top: 24, bottom: 42 },
        tooltip: {
          trigger: "axis",
          backgroundColor: palette.surface,
          borderColor: palette.rule,
          borderWidth: 1,
          padding: [10, 12],
          textStyle: {
            color: palette.ink,
            fontFamily: "IBM Plex Sans, sans-serif",
            fontSize: 12,
          },
          formatter: (params) => {
            const item = series[params[0].dataIndex];
            return `<strong>${formatDateLabel(item.date, granularity)}</strong><br>${formatNumber(
              item.listens
            )} ${plural(item.listens, "listen")}<br>${formatMinutes(item.minutes)}`;
          },
        },
        xAxis: {
          type: "category",
          data: labels,
          boundaryGap: false,
          axisLine: { lineStyle: { color: palette.rule } },
          axisTick: { show: false },
          axisLabel: {
            color: palette.muted,
            fontSize: 11,
            hideOverlap: true,
            formatter: (value) => {
              if (granularity === "week") {
                return `W${String(value).split("-W")[1]}`;
              }
              if (granularity === "month") {
                const [year, month] = String(value).split("-").map(Number);
                return monthShortFormat.format(new Date(year, month - 1, 1));
              }
              return formatShortFromIso(value);
            },
          },
        },
        yAxis: {
          type: "value",
          minInterval: 1,
          splitLine: { lineStyle: { color: palette.rule } },
          axisLabel: { color: palette.muted, fontSize: 11 },
        },
        series: [
          {
            type: "line",
            data: series.map((item) => item.listens),
            symbol: "circle",
            symbolSize: 4,
            showSymbol: series.length <= 60,
            lineStyle: { color: palette.accent, width: 2 },
            itemStyle: { color: palette.accent },
            areaStyle: { color: palette.accent, opacity: 0.08 },
            emphasis: { focus: "series" },
          },
        ],
      },
      true
    );

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Date", "Listens", "Time"].forEach((label) => {
      headRow.append(create("th", null, label));
    });
    thead.append(headRow);

    const tbody = document.createElement("tbody");
    series.forEach((item) => {
      const row = document.createElement("tr");
      row.append(create("td", null, formatDateLabel(item.date, granularity)));
      row.append(create("td", null, formatNumber(item.listens)));
      row.append(create("td", null, formatMinutes(item.minutes)));
      tbody.append(row);
    });

    table.append(thead, tbody);
    clear(tableContainer);
    tableContainer.append(table);
  }

  function renderHeatmap(data) {
    const grid = data.weekday_hour_hist || [];
    const chartElement = byId("chart-heatmap");
    const empty = byId("heatmap-empty");
    const details = byId("heatmap-data");
    const tableContainer = byId("heatmap-table");

    const buckets = [];
    for (let hour = 0; hour < 24; hour += 2) {
      buckets.push({
        start: hour,
        label: `${String(hour).padStart(2, "0")}-${String(hour + 1).padStart(2, "0")}`,
      });
    }

    const cells = [];
    const peaks = [];
    let hasData = false;

    weekdayNames.forEach((day, dayIndex) => {
      buckets.forEach((bucket, bucketIndex) => {
        const row = grid[dayIndex] || [];
        const value =
          Number(row[bucket.start] || 0) + Number(row[bucket.start + 1] || 0);
        if (value > 0) {
          hasData = true;
          cells.push([bucketIndex, dayIndex, value]);
          peaks.push({ day, bucket: bucket.label, value });
        } else {
          cells.push([bucketIndex, dayIndex, 0]);
        }
      });
    });

    if (!hasData) {
      empty.hidden = false;
      chartElement.hidden = true;
      details.hidden = true;
      details.open = false;
      if (state.heatmapChart) state.heatmapChart.clear();
      return;
    }

    empty.hidden = true;
    chartElement.hidden = false;
    details.hidden = false;

    peaks.sort((a, b) => b.value - a.value);
    const topPeak = peaks[0];
    chartElement.setAttribute(
      "aria-label",
      `Listening heatmap by weekday and time of day. Peak block is ${topPeak.day} ${topPeak.bucket} with ${formatNumber(
        topPeak.value
      )} ${plural(topPeak.value, "listen")}.`
    );

    if (!state.heatmapChart) {
      state.heatmapChart = window.echarts.init(chartElement);
      window.addEventListener("resize", () => {
        if (state.heatmapChart) state.heatmapChart.resize();
      });
    }
    state.heatmapChart.resize();

    const palette = chartPalette();
    const max = Math.max(...peaks.map((item) => item.value), 1);

    state.heatmapChart.setOption(
      {
        animationDuration: reduceMotion ? 0 : 300,
        backgroundColor: "transparent",
        grid: { left: 44, right: 14, top: 20, bottom: 64 },
        tooltip: {
          backgroundColor: palette.surface,
          borderColor: palette.rule,
          borderWidth: 1,
          padding: [10, 12],
          textStyle: {
            color: palette.ink,
            fontFamily: "IBM Plex Sans, sans-serif",
            fontSize: 12,
          },
          formatter: (params) => {
            const [bucketIndex, dayIndex, value] = params.data;
            return `${weekdayNames[dayIndex]} ${
              buckets[bucketIndex].label
            }<br>${formatNumber(value)} ${plural(value, "listen")}`;
          },
        },
        xAxis: {
          type: "category",
          data: buckets.map((bucket) => bucket.label),
          axisLine: { lineStyle: { color: palette.rule } },
          axisTick: { show: false },
          axisLabel: {
            color: palette.muted,
            fontSize: 10,
            interval: window.innerWidth < 640 ? 1 : 0,
          },
          splitArea: { show: false },
        },
        yAxis: {
          type: "category",
          data: weekdayNames,
          inverse: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: palette.muted, fontSize: 11 },
          splitArea: { show: false },
        },
        visualMap: {
          min: 0,
          max,
          calculable: false,
          orient: "horizontal",
          left: "center",
          bottom: 0,
          itemWidth: 12,
          itemHeight: 100,
          text: ["More", "Fewer"],
          textStyle: { color: palette.muted, fontSize: 10 },
          inRange: { color: ["#e7dcc8", palette.accent] },
          outOfRange: { color: ["#f1e9dc"] },
        },
        series: [
          {
            type: "heatmap",
            data: cells,
            label: { show: false },
            itemStyle: {
              borderColor: palette.paper,
              borderWidth: 2,
            },
            emphasis: {
              itemStyle: {
                borderColor: palette.ink,
                borderWidth: 2,
              },
            },
          },
        ],
      },
      true
    );

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Day", "Time", "Listens"].forEach((label) => {
      headRow.append(create("th", null, label));
    });
    thead.append(headRow);

    const tbody = document.createElement("tbody");
    peaks.slice(0, 10).forEach((item) => {
      const row = document.createElement("tr");
      row.append(create("td", null, item.day));
      row.append(create("td", null, item.bucket));
      row.append(create("td", null, formatNumber(item.value)));
      tbody.append(row);
    });

    table.append(thead, tbody);
    clear(tableContainer);
    tableContainer.append(table);
  }

  async function loadRange({ fromTs, toTs, preset }) {
    if (state.controller) state.controller.abort();
    if (state.timelineController) state.timelineController.abort();

    const controller = new AbortController();
    state.controller = controller;
    state.fromTs = fromTs;
    state.toTs = toTs;
    state.preset = preset;

    hideError();
    byId("range-error").hidden = true;
    setLoading(true);
    byId("range-summary").textContent = "Loading your listening archive...";

    try {
      const params = rangeQuery(fromTs, toTs);
      const data = await getJson(`/api/range?${params.toString()}`, controller.signal);
      renderRange(data);

      const granularity = chooseGranularity(fromTs, toTs, data);
      const timelineParams = rangeQuery(fromTs, toTs);
      timelineParams.set("granularity", granularity);

      const timelineController = new AbortController();
      state.timelineController = timelineController;
      const timeline = await getJson(
        `/api/timeline?${timelineParams.toString()}`,
        timelineController.signal
      );
      renderTimeline(timeline, granularity);
    } catch (error) {
      if (error.name === "AbortError") return;
      byId("range-summary").textContent = "Could not load this range.";
      showError(
        "Could not load listening data. Check that the server is running and try again.",
        () => loadRange({ fromTs, toTs, preset })
      );
    } finally {
      if (state.controller === controller) setLoading(false);
    }
  }

  async function loadOnThisDay() {
    const container = byId("on-this-day");
    if (!container) return;
    container.replaceChildren(create("p", "loading", "Loading past years..."));

    try {
      const html = await getText("/api/on-this-day?years=5");
      container.innerHTML = html;
    } catch (error) {
      showFragmentError(
        container,
        "Could not load past years right now.",
        loadOnThisDay
      );
    }
  }

  function monthOptions() {
    const options = [];
    const today = new Date();
    for (let index = 0; index < 18; index += 1) {
      const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
      options.push({
        value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        label: monthDateFormat.format(date),
      });
    }
    return options;
  }

  async function loadMonthly(value) {
    const container = byId("monthly-recap");
    if (!container) return;
    const [year, month] = String(value).split("-").map(Number);
    container.replaceChildren(create("p", "loading", "Loading this month..."));

    if (state.monthController) state.monthController.abort();
    const controller = new AbortController();
    state.monthController = controller;

    try {
      const html = await getText(
        `/api/monthly/${year}/${month}`,
        controller.signal
      );
      container.innerHTML = html;
    } catch (error) {
      if (error.name === "AbortError") return;
      showFragmentError(
        container,
        "Could not load this month right now.",
        () => loadMonthly(value)
      );
    }
  }

  function initTabs() {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    if (!tabs.length) return;

    const panels = {
      artists: byId("panel-artists"),
      tracks: byId("panel-tracks"),
      albums: byId("panel-albums"),
    };

    function activate(name, focus) {
      tabs.forEach((tab) => {
        const selected = tab.dataset.tab === name;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focus) tab.focus();
      });
      Object.entries(panels).forEach(([key, panel]) => {
        if (panel) panel.hidden = key !== name;
      });
      state.topTab = name;
    }

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activate(tab.dataset.tab, false));
      tab.addEventListener("keydown", (event) => {
        const index = tabs.indexOf(tab);
        let next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          next = tabs[(index + 1) % tabs.length];
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          next = tabs[(index - 1 + tabs.length) % tabs.length];
        } else if (event.key === "Home") {
          next = tabs[0];
        } else if (event.key === "End") {
          next = tabs[tabs.length - 1];
        }
        if (next) {
          event.preventDefault();
          activate(next.dataset.tab, true);
        }
      });
    });

    activate(state.topTab, false);
  }

  function initRangeControls() {
    document.querySelectorAll(".range-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const days = button.dataset.days;
        if (days === "all") {
          setPreset("all");
          setDateInputs(null, null);
          loadRange({ fromTs: null, toTs: null, preset: "all" });
          return;
        }

        const count = Number(days);
        const end = new Date();
        const start = new Date(end.getTime() - count * 86400000);
        setPreset(days);
        setDateInputs(start, end);
        loadRange({
          fromTs: Math.floor(start.getTime() / 1000),
          toTs: Math.floor(end.getTime() / 1000),
          preset: days,
        });
      });
    });

    const form = byId("custom-range");
    if (!form) return;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const fromValue = byId("from").value;
      const toValue = byId("to").value;
      const error = byId("range-error");
      error.hidden = true;

      let fromTs = null;
      let toTs = null;

      if (fromValue) {
        const from = parseLocalDate(fromValue);
        fromTs = Math.floor(
          new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0).getTime() / 1000
        );
      }
      if (toValue) {
        const to = parseLocalDate(toValue);
        toTs = Math.floor(
          new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999).getTime() / 1000
        );
      }

      if (fromTs && toTs && fromTs > toTs) {
        error.textContent = "The start date must come before the end date.";
        error.hidden = false;
        return;
      }

      if (!fromValue && !toValue) {
        setPreset("all");
        loadRange({ fromTs: null, toTs: null, preset: "all" });
        return;
      }

      setPreset("custom");
      loadRange({ fromTs, toTs, preset: "custom" });
    });
  }

  function initMonthPicker() {
    const picker = byId("month-picker");
    if (!picker) return;

    const options = monthOptions();
    picker.replaceChildren(
      ...options.map((option) => new Option(option.label, option.value))
    );
    picker.value = options[0].value;
    picker.addEventListener("change", () => loadMonthly(picker.value));
    loadMonthly(picker.value);
  }

  function init() {
    initTabs();
    initRangeControls();
    initMonthPicker();
    loadOnThisDay();
    setPreset("all");
    loadRange({ fromTs: null, toTs: null, preset: "all" });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

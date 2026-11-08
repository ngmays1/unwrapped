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
  const timestampFormat = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const searchDelay = 250;

  const state = {
    searchController: null,
    detailController: null,
    searchTimer: null,
    selectedKey: null,
    monthChart: null,
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

  function trackKey(track, artist) {
    return `${track || ""}\u0000${artist || ""}`;
  }

  function coverId(item) {
    const art = item && item.art;
    return typeof art === "string" && art ? art : null;
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

  function formatDateFromTs(timestamp) {
    return fullDateFormat.format(new Date(timestamp * 1000));
  }

  function formatDayLabel(value) {
    return fullDateFormat.format(parseLocalDate(value));
  }

  function formatLastPlayed(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.getFullYear() === new Date().getFullYear()
      ? shortDateFormat.format(date)
      : fullDateFormat.format(date);
  }

  function formatRelative(timestamp) {
    const difference = timestamp * 1000 - Date.now();
    const absolute = Math.abs(difference);
    if (absolute < 3600000) {
      return relativeFormat.format(Math.round(difference / 60000), "minute");
    }
    if (absolute < 86400000) {
      return relativeFormat.format(Math.round(difference / 3600000), "hour");
    }
    if (absolute < 2592000000) {
      return relativeFormat.format(Math.round(difference / 86400000), "day");
    }
    if (absolute < 31536000000) {
      return relativeFormat.format(Math.round(difference / 2592000000), "month");
    }
    return relativeFormat.format(Math.round(difference / 31536000000), "year");
  }

  function formatMonth(value) {
    const [year, month] = String(value).split("-").map(Number);
    return monthDateFormat.format(new Date(year, month - 1, 1));
  }

  function formatMonthShort(value) {
    const [year, month] = String(value).split("-").map(Number);
    return monthShortFormat.format(new Date(year, month - 1, 1));
  }

  function formatWeekLabel(startValue, endValue) {
    const start = parseLocalDate(startValue);
    const end = parseLocalDate(endValue);
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    if (sameMonth) {
      return `${shortDateFormat.format(start)} to ${end.getDate()}, ${end.getFullYear()}`;
    }
    if (sameYear) {
      return `${shortDateFormat.format(start)} to ${shortDateFormat.format(end)}, ${end.getFullYear()}`;
    }
    return `${fullDateFormat.format(start)} to ${fullDateFormat.format(end)}`;
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

  async function getJson(url, signal) {
    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const error = new Error(`Request failed with ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function buildTable(headers, rows) {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headers.forEach((label) => headRow.append(create("th", null, label)));
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    rows.forEach((values) => {
      const row = document.createElement("tr");
      values.forEach((value) => row.append(create("td", null, value)));
      tbody.append(row);
    });
    table.append(thead, tbody);
    return table;
  }

  function buildDataDetails(summary, table) {
    const details = document.createElement("details");
    details.className = "chart-data";
    details.append(create("summary", null, summary));
    details.append(table);
    return details;
  }

  function resultArt(cover) {
    if (!cover) return create("span", "track-result-art");
    const img = document.createElement("img");
    img.className = "track-result-art";
    img.src = `/api/art/${encodeURIComponent(cover)}?size=64`;
    img.alt = "";
    img.width = 40;
    img.height = 40;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => img.replaceWith(create("span", "track-result-art")));
    return img;
  }

  function heroArt(cover) {
    if (!cover) return create("span", "track-hero-art");
    const img = document.createElement("img");
    img.className = "track-hero-art";
    img.src = `/api/art/${encodeURIComponent(cover)}?size=256`;
    img.alt = "";
    img.width = 140;
    img.height = 140;
    img.decoding = "async";
    img.addEventListener("error", () => img.replaceWith(create("span", "track-hero-art")));
    return img;
  }

  function updateUrlState(track, artist) {
    const params = new URLSearchParams();
    params.set("track", track);
    if (artist) params.set("artist", artist);
    window.history.replaceState(null, "", `/tracks?${params.toString()}`);
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    const track = params.get("track");
    if (!track) return null;
    return { track, artist: params.get("artist") || "" };
  }

  function markSelectedResult() {
    document.querySelectorAll(".track-result").forEach((button) => {
      const selected =
        trackKey(button.dataset.track, button.dataset.artist) === state.selectedKey;
      if (selected) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function setSearchLoading(active) {
    const container = byId("track-results");
    container.setAttribute("aria-busy", active ? "true" : "false");
    if (active && !container.firstChild) {
      container.replaceChildren(create("p", "loading", "Loading tracks..."));
    }
  }

  function showSearchError(message, retry) {
    const results = byId("track-results");
    if (results.querySelector(".loading")) results.replaceChildren();
    const box = byId("track-search-error");
    clear(box);
    box.append(create("p", null, message));
    if (retry) {
      const button = create("button", "text-btn", "Try again");
      button.type = "button";
      button.addEventListener("click", retry);
      box.append(button);
    }
    box.hidden = false;
  }

  function hideSearchError() {
    const box = byId("track-search-error");
    box.hidden = true;
    clear(box);
  }

  function renderSearchResults(data, query) {
    const container = byId("track-results");
    const status = byId("track-search-status");
    clear(container);

    const results = data.results || [];
    if (!results.length) {
      status.textContent = query ? "No matches" : "No listens yet";
      const message = query
        ? `No tracks match "${query}". Try the artist name or fewer words.`
        : "No listens in your archive yet. Tracks will appear here after the next sync.";
      container.append(create("p", "empty-state", message));
      return;
    }

    status.textContent = query
      ? `Showing ${results.length} ${plural(results.length, "match", "matches")} for "${query}"`
      : "Recently played";

    const list = create("ul", "track-result-list");
    const withArt = results.some((item) => coverId(item));
    if (!withArt) list.classList.add("no-art");

    results.forEach((item) => {
      const count = Number(item.plays) || 0;
      const row = create("li");
      const button = create("button", "track-result");
      button.type = "button";
      button.dataset.track = item.track || "";
      button.dataset.artist = item.artist || "";
      button.setAttribute(
        "aria-label",
        `${item.track || "Unknown track"} by ${item.artist || "Unknown artist"}. ${formatNumber(
          count
        )} ${plural(count, "play")}. Last played ${formatLastPlayed(item.last_listen_ts)}.`
      );
      if (withArt) button.append(resultArt(coverId(item)));

      const body = create("span", "track-result-body");
      body.append(create("span", "track-result-title", item.track || "Unknown track"));
      body.append(create("span", "track-result-meta", item.artist || "Unknown artist"));
      button.append(body);

      const side = create("span", "track-result-side");
      side.append(
        create("span", "track-result-count", `${formatNumber(count)} ${plural(count, "play")}`)
      );
      side.append(
        create("span", "track-result-last", `Last ${formatLastPlayed(item.last_listen_ts)}`)
      );
      button.append(side);

      button.addEventListener("click", (event) =>
        selectTrack(item.track || "", item.artist || "", event.detail === 0)
      );
      row.append(button);
      list.append(row);
    });

    container.append(list);
    markSelectedResult();
  }

  async function searchTracks(query) {
    if (state.searchController) state.searchController.abort();
    const controller = new AbortController();
    state.searchController = controller;

    hideSearchError();
    setSearchLoading(true);

    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("limit", "15");

    try {
      const data = await getJson(
        `/api/tracks/search?${params.toString()}`,
        controller.signal
      );
      renderSearchResults(data, query);
    } catch (error) {
      if (error.name === "AbortError") return;
      showSearchError("Could not search your tracks right now.", () => searchTracks(query));
    } finally {
      if (state.searchController === controller) {
        state.searchController = null;
        setSearchLoading(false);
      }
    }
  }

  function disposeCharts() {
    if (state.monthChart) {
      state.monthChart.dispose();
      state.monthChart = null;
    }
    if (state.heatmapChart) {
      state.heatmapChart.dispose();
      state.heatmapChart = null;
    }
  }

  function setDetailLoading() {
    const detail = byId("track-detail");
    disposeCharts();
    detail.setAttribute("aria-busy", "true");
    detail.replaceChildren(create("p", "loading", "Loading track history..."));
  }

  function showDetailError(message, retry) {
    const detail = byId("track-detail");
    disposeCharts();
    detail.setAttribute("aria-busy", "false");
    detail.replaceChildren();
    detail.append(create("p", "empty-state", message));
    if (retry) {
      const button = create("button", "text-btn", "Try again");
      button.type = "button";
      button.addEventListener("click", retry);
      detail.append(button);
    }
  }

  function factItem(label, value, note) {
    const group = create("div");
    group.append(create("dt", null, label));
    const description = create("dd", null, value);
    if (note) description.append(create("span", "track-fact-note", note));
    group.append(description);
    return group;
  }

  function buildHero(data) {
    const hero = create("header", "track-hero");
    hero.append(heroArt(coverId(data)));

    const text = create("div", "track-hero-text");
    const title = create("h2", null, data.track || "Unknown track");
    title.id = "track-detail-title";
    title.tabIndex = -1;
    text.append(title);
    text.append(create("p", "track-hero-artist", data.artist || "Unknown artist"));

    const plays = Number(data.total_listens) || 0;
    text.append(
      create(
        "p",
        "track-lede",
        `${formatNumber(plays)} ${plural(plays, "play")} since ${formatDateFromTs(
          data.first_listen_ts
        )}. Last heard ${formatRelative(data.last_listen_ts)}.`
      )
    );
    hero.append(text);
    return hero;
  }

  function buildFacts(data) {
    const facts = create("dl", "track-facts");
    const streak = data.longest_streak || {};
    const streakDays = Number(streak.days) || 0;
    let streakNote = "";
    if (streakDays > 1 && streak.start && streak.end) {
      streakNote = `${formatDayLabel(streak.start)} to ${formatDayLabel(streak.end)}`;
    }
    facts.append(
      factItem(
        "Total plays",
        `${formatNumber(data.total_listens)} ${plural(data.total_listens, "play")}`,
        `${formatNumber(data.average_per_active_day)} per listening day`
      ),
      factItem("Listening time", formatMinutes(data.total_minutes)),
      factItem("First played", formatDateFromTs(data.first_listen_ts)),
      factItem(
        "Last played",
        formatDateFromTs(data.last_listen_ts),
        formatRelative(data.last_listen_ts)
      ),
      factItem(
        "Days played",
        `${formatNumber(data.unique_days)} ${plural(data.unique_days, "day")}`
      ),
      factItem(
        "Longest streak",
        `${formatNumber(streakDays)} ${plural(streakDays, "day")}`,
        streakNote
      )
    );
    return facts;
  }

  function buildMonthlySection(data) {
    const section = create("section", "track-chapter");
    section.append(create("h3", null, "When it was in rotation"));

    const chart = create("div", "chart chart-track-months");
    chart.id = "chart-track-months";
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `Plays per month for ${data.track || "this track"}.`);
    section.append(chart);

    const rows = (data.monthly || []).map((item) => [
      formatMonth(item.month),
      formatNumber(item.listens),
      formatMinutes(item.minutes),
    ]);
    section.append(
      buildDataDetails(
        "View the data as a table",
        buildTable(["Month", "Plays", "Time"], rows)
      )
    );
    return section;
  }

  function heatmapZones(grid) {
    const buckets = [];
    for (let hour = 0; hour < 24; hour += 2) {
      buckets.push({
        start: hour,
        label: `${String(hour).padStart(2, "0")}-${String(hour + 1).padStart(2, "0")}`,
      });
    }

    const cells = [];
    const zones = [];
    let hasData = false;

    weekdayNames.forEach((day, dayIndex) => {
      buckets.forEach((bucket, bucketIndex) => {
        const row = grid[dayIndex] || [];
        const value =
          Number(row[bucket.start] || 0) + Number(row[bucket.start + 1] || 0);
        if (value > 0) {
          hasData = true;
          cells.push([bucketIndex, dayIndex, value]);
          zones.push({ day, bucket: bucket.label, value });
        } else {
          cells.push([bucketIndex, dayIndex, 0]);
        }
      });
    });

    zones.sort((a, b) => b.value - a.value);
    return { buckets, cells, zones, hasData };
  }

  function buildHeatmapSection(data) {
    const section = create("section", "track-chapter");
    section.append(create("h3", null, "Hours you return to"));

    const chart = create("div", "chart chart-heatmap");
    chart.id = "chart-track-heatmap";
    chart.setAttribute("role", "img");
    section.append(chart);

    const details = heatmapZones(data.weekday_hour_hist || []);
    if (!details.hasData) {
      chart.hidden = true;
      section.append(create("p", "empty-state", "No timing data for this track."));
      return section;
    }

    const peak = details.zones[0];
    const caption = create(
      "p",
      "chart-caption",
      `Peak block: ${peak.day} ${peak.bucket}, ${formatNumber(peak.value)} ${plural(
        peak.value,
        "play"
      )}.`
    );
    section.append(caption);
    chart.setAttribute(
      "aria-label",
      `Listening heatmap for ${data.track || "this track"}. Peak block is ${peak.day} ${
        peak.bucket
      } with ${formatNumber(peak.value)} ${plural(peak.value, "play")}.`
    );

    const rows = details.zones
      .slice(0, 10)
      .map((zone) => [zone.day, zone.bucket, formatNumber(zone.value)]);
    section.append(
      buildDataDetails(
        "View peak times as a table",
        buildTable(["Day", "Time", "Plays"], rows)
      )
    );
    return section;
  }

  function buildPeaksSection(data) {
    const section = create("section", "track-chapter");
    section.append(create("h3", null, "Busiest days and weeks"));

    const grid = create("div", "track-peaks");
    grid.append(
      buildPeakColumn(
        "Busiest days",
        data.top_days || [],
        (item) => formatDayLabel(item.date),
        (count, label) => `${formatNumber(count)} ${plural(count, "play")} on ${label}`
      )
    );
    grid.append(
      buildPeakColumn(
        "Busiest weeks",
        data.top_weeks || [],
        (item) => formatWeekLabel(item.start, item.end),
        (count, label) => `${formatNumber(count)} ${plural(count, "play")} in the week of ${label}`
      )
    );
    section.append(grid);
    return section;
  }

  function buildPeakColumn(title, items, labelFor, leadFor) {
    const column = create("div", "track-peak");
    column.append(create("h4", null, title));
    if (!items.length) {
      column.append(create("p", "empty-state", "No data for this track."));
      return column;
    }

    const top = items[0];
    column.append(create("p", "track-peak-lead", leadFor(top.listens, labelFor(top))));

    const rest = items.slice(1);
    if (rest.length) {
      const list = create("ol", "compact-list");
      rest.forEach((item) => {
        const row = create("li");
        const main = create("span", "compact-main");
        main.append(create("span", "compact-name", labelFor(item)));
        row.append(main);
        row.append(
          create(
            "span",
            "compact-count",
            `${formatNumber(item.listens)} ${plural(item.listens, "play")}`
          )
        );
        list.append(row);
      });
      column.append(list);
    }
    return column;
  }

  function buildRecentSection(data) {
    const section = create("section", "track-chapter");
    section.append(create("h3", null, "Recent plays"));
    const list = create("ol", "track-recent");
    (data.recent || []).forEach((item) => {
      const row = create("li");
      row.append(
        create(
          "span",
          "track-recent-date",
          timestampFormat.format(new Date(item.listened_at * 1000))
        )
      );
      row.append(
        create("span", "track-recent-album", item.album_name || "Unknown album")
      );
      list.append(row);
    });
    section.append(list);
    return section;
  }

  function renderMonthlyChart(data) {
    const element = byId("chart-track-months");
    if (!element) return;
    const monthly = data.monthly || [];
    if (!monthly.length) {
      element.hidden = true;
      return;
    }

    if (!state.monthChart) {
      state.monthChart = window.echarts.init(element);
    }
    state.monthChart.resize();

    const palette = chartPalette();
    state.monthChart.setOption(
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
            const item = monthly[params[0].dataIndex];
            return `<strong>${formatMonth(item.month)}</strong><br>${formatNumber(
              item.listens
            )} ${plural(item.listens, "play")}<br>${formatMinutes(item.minutes)}`;
          },
        },
        xAxis: {
          type: "category",
          data: monthly.map((item) => item.month),
          axisLine: { lineStyle: { color: palette.rule } },
          axisTick: { show: false },
          axisLabel: {
            color: palette.muted,
            fontSize: 10,
            hideOverlap: true,
            formatter: (value) => formatMonthShort(value),
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
            type: "bar",
            data: monthly.map((item) => item.listens),
            barMaxWidth: 24,
            itemStyle: { color: palette.accent, opacity: 0.78 },
            emphasis: { itemStyle: { opacity: 1 } },
          },
        ],
      },
      true
    );
  }

  function renderHeatmapChart(data) {
    const element = byId("chart-track-heatmap");
    if (!element) return;
    const details = heatmapZones(data.weekday_hour_hist || []);
    if (!details.hasData) return;

    if (!state.heatmapChart) {
      state.heatmapChart = window.echarts.init(element);
    }
    state.heatmapChart.resize();

    const palette = chartPalette();
    const max = Math.max(...details.zones.map((zone) => zone.value), 1);

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
              details.buckets[bucketIndex].label
            }<br>${formatNumber(value)} ${plural(value, "play")}`;
          },
        },
        xAxis: {
          type: "category",
          data: details.buckets.map((bucket) => bucket.label),
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
            data: details.cells,
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
  }

  function renderDetail(data) {
    disposeCharts();
    const detail = byId("track-detail");
    detail.setAttribute("aria-busy", "false");
    detail.replaceChildren(
      buildHero(data),
      buildFacts(data),
      buildMonthlySection(data),
      buildHeatmapSection(data),
      buildPeaksSection(data),
      buildRecentSection(data)
    );
    renderMonthlyChart(data);
    renderHeatmapChart(data);
  }

  async function loadDetail(track, artist, focusHeading) {
    if (state.detailController) state.detailController.abort();
    const controller = new AbortController();
    state.detailController = controller;
    setDetailLoading();

    const params = new URLSearchParams();
    params.set("track", track);
    if (artist) params.set("artist", artist);

    try {
      const data = await getJson(
        `/api/tracks/detail?${params.toString()}`,
        controller.signal
      );
      renderDetail(data);
      if (focusHeading) {
        const heading = byId("track-detail-title");
        if (heading) heading.focus({ preventScroll: false });
      } else if (window.matchMedia("(max-width: 900px)").matches) {
        byId("track-detail").scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      if (error.status === 404) {
        showDetailError(
          "No plays found for this track. It may have dropped out of the archive."
        );
      } else {
        showDetailError("Could not load track history.", () =>
          loadDetail(track, artist, focusHeading)
        );
      }
    } finally {
      if (state.detailController === controller) {
        state.detailController = null;
        byId("track-detail").setAttribute("aria-busy", "false");
      }
    }
  }

  function selectTrack(track, artist, focusHeading) {
    state.selectedKey = trackKey(track, artist);
    markSelectedResult();
    updateUrlState(track, artist);
    loadDetail(track, artist, focusHeading);
  }

  function initSearch() {
    const input = byId("track-query");
    const form = byId("track-search-form");
    if (!input || !form) return;

    input.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      const query = input.value.trim();
      state.searchTimer = setTimeout(() => searchTracks(query), searchDelay);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      clearTimeout(state.searchTimer);
      searchTracks(input.value.trim());
    });
  }

  function init() {
    initSearch();
    window.addEventListener("resize", () => {
      if (state.monthChart) state.monthChart.resize();
      if (state.heatmapChart) state.heatmapChart.resize();
    });

    const initial = readUrlState();
    if (initial) {
      byId("track-query").value = initial.track;
      state.selectedKey = trackKey(initial.track, initial.artist);
      searchTracks(initial.track);
      loadDetail(initial.track, initial.artist, false);
    } else {
      searchTracks("");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

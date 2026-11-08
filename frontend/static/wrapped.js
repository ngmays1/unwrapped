(() => {
  "use strict";

  const container = document.getElementById("wrapped");
  if (!container) return;

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
  const svgNS = "http://www.w3.org/2000/svg";
  const currentYear = new Date().getFullYear();
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const weekdayNames = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
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

  function formatDaysOfMusic(value) {
    const days = Math.round((Number(value) || 0) / 1440);
    if (days < 1) return null;
    return `${formatNumber(days)} ${plural(days, "day")} of music`;
  }

  function parseLocalDate(value) {
    const parts = String(value).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatDate(value) {
    return fullDateFormat.format(parseLocalDate(value));
  }

  function formatTimestamp(value) {
    return shortDateFormat.format(new Date(Number(value) * 1000));
  }

  function formatDateRange(firstTs, lastTs) {
    if (!firstTs || !lastTs) return null;
    const first = formatTimestamp(firstTs);
    const last = formatTimestamp(lastTs);
    return first === last ? `on ${first}` : `between ${first} and ${last}`;
  }

  function hourLabel(hour) {
    const suffix = hour < 12 ? "am" : "pm";
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display}${suffix}`;
  }

  function shortHourLabel(hour) {
    const suffix = hour < 12 ? "a" : "p";
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display}${suffix}`;
  }

  function initials(name) {
    const words = String(name || "?")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  function dataTable(headers, rows) {
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

  function details(summary, rows, headers) {
    const wrapper = create("details", "chart-data");
    wrapper.append(create("summary", null, summary));
    wrapper.append(dataTable(headers, rows));
    return wrapper;
  }

  function printTile(title, meta, variant) {
    const tile = create("div", `sleeve-print sleeve-print--${variant || "full"}`);
    if (variant === "monogram") {
      tile.append(create("span", "sleeve-monogram", initials(title)));
      return tile;
    }
    tile.append(create("span", "sleeve-catalog", "unwrapped"));
    const titleNode = create("span", "sleeve-print-title", title || "Unknown");
    if (String(title || "").length > 34) titleNode.classList.add("is-long");
    tile.append(titleNode);
    if (meta) tile.append(create("span", "sleeve-print-artist", meta));
    return tile;
  }

  function sleeve(options) {
    const {
      cover,
      title,
      meta,
      rank,
      size = 256,
      eager = false,
      compact = false,
      variant = "full",
      className = "",
      footnote,
      decorative = false,
    } = options;

    const figure = create("figure", `sleeve ${className}`.trim());
    const frame = create("div", "sleeve-frame");

    if (cover) {
      const img = document.createElement("img");
      img.className = "sleeve-art";
      img.src = `/api/art/${encodeURIComponent(cover)}?size=${size}`;
      img.alt = decorative ? "" : `${title || "Unknown"}${meta ? ` by ${meta}` : ""}`;
      img.width = size;
      img.height = size;
      img.loading = eager ? "eager" : "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        const tile = printTile(title, meta, variant);
        if (decorative) tile.setAttribute("aria-hidden", "true");
        img.replaceWith(tile);
      });
      frame.append(img);
    } else {
      const tile = printTile(title, meta, variant);
      if (decorative) tile.setAttribute("aria-hidden", "true");
      frame.append(tile);
    }

    if (rank) frame.append(create("span", "sleeve-rank", rank));
    figure.append(frame);

    if (!compact) {
      const caption = create("figcaption", "sleeve-meta");
      caption.append(create("span", "sleeve-name", title || "Unknown"));
      if (meta) caption.append(create("span", "sleeve-byline", meta));
      if (footnote) caption.append(create("span", "sleeve-count", footnote));
      figure.append(caption);
    }

    return figure;
  }

  function yearNav(year) {
    const nav = create("nav", "wrapped-year-nav");
    nav.setAttribute("aria-label", "Year navigation");

    const previous = create("a", "wrapped-year-link");
    previous.href = `/wrapped/${year - 1}`;
    previous.setAttribute("aria-label", `Previous year, ${year - 1}`);
    previous.append(
      create("span", "year-link-dir", "\u2190"),
      create("span", "year-link-year", String(year - 1))
    );

    const current = create("span", "wrapped-year-current", `${year} in review`);

    const next = create(
      year >= currentYear ? "span" : "a",
      "wrapped-year-link"
    );
    next.append(
      create("span", "year-link-year", String(year + 1)),
      create("span", "year-link-dir", "\u2192")
    );
    if (year >= currentYear) {
      next.setAttribute("aria-disabled", "true");
    } else {
      next.href = `/wrapped/${year + 1}`;
      next.setAttribute("aria-label", `Next year, ${year + 1}`);
    }

    nav.append(previous, current, next);
    return nav;
  }

  function chapter(number, title) {
    const section = create("section", "wrapped-chapter reveal");
    const heading = create("h2", "chapter-head");
    const folio = create("span", "chapter-num", number);
    folio.setAttribute("aria-hidden", "true");
    heading.append(folio, create("span", "chapter-title", title));
    section.append(heading);
    return section;
  }

  function numberItem(label, value, note, className) {
    const item = create("div", `number-item ${className || ""}`.trim());
    item.append(create("dt", null, label));
    const description = create("dd", null, value);
    if (note) description.append(create("span", "number-note", note));
    item.append(description);
    return item;
  }

  function longestStreak(daily) {
    if (!daily || !daily.length) return 0;
    const days = daily
      .map((entry) => Date.parse(`${entry.date}T00:00:00Z`))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    let best = days.length ? 1 : 0;
    let run = best;
    for (let index = 1; index < days.length; index += 1) {
      run = days[index] - days[index - 1] === 86400000 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return best;
  }

  function dailyValues(year, daily) {
    const map = new Map();
    (daily || []).forEach((entry) => {
      map.set(entry.date, Number(entry.listens) || 0);
    });

    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const totalDays = isLeap ? 366 : 365;
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const values = [];
    for (let index = 0; index < totalDays; index += 1) {
      const date = new Date(year, 0, index + 1);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(date.getDate()).padStart(2, "0")}`;
      values.push({
        date,
        iso,
        listens: map.get(iso) || 0,
        future: date > todayStart,
      });
    }
    return values;
  }

  function renderCover(year, data) {
    const section = create("section", "wrapped-cover");
    const copy = create("div", "wrapped-cover-copy");

    copy.append(
      create(
        "p",
        "kicker",
        year === currentYear ? "A year in listening, so far" : "A year in listening"
      )
    );

    const heading = create("h1", "wrapped-year", year);
    copy.append(heading);

    const total = Number(data.total_listens) || 0;
    const artists = Number(data.unique_artists) || 0;
    const lede = create(
      "p",
      "wrapped-lede",
      `${formatNumber(total)} ${plural(total, "listen")}. ${formatMinutes(
        data.total_minutes
      )}. ${formatNumber(artists)} ${plural(artists, "artist")}.`
    );
    copy.append(lede);

    const notes = [];
    const days = formatDaysOfMusic(data.total_minutes);
    if (days) notes.push(days);
    const range = formatDateRange(data.first_listen_ts, data.last_listen_ts);
    if (range) notes.push(range);
    if (notes.length) {
      copy.append(create("p", "wrapped-lede-note", `${notes.join(", ")}.`));
    }

    section.append(copy);

    const albums = (data.top_albums || []).slice(0, 3);
    if (albums.length) {
      const stack = create("div", "sleeve-stack");
      albums.forEach((album, index) => {
        stack.append(
          sleeve({
            cover: coverId(album),
            title: album.album || "Unknown album",
            meta: album.artist || "",
            rank: String(index + 1).padStart(2, "0"),
            size: 256,
            eager: index === 0,
            compact: true,
            className: "sleeve--stack",
          })
        );
      });
      section.append(stack);
    }

    return section;
  }

  function renderNumbers(data) {
    const total = Number(data.total_listens) || 0;
    const daily = Array.isArray(data.daily) ? data.daily : null;
    const listeningDays = daily ? daily.length : 0;
    const streak = daily ? longestStreak(daily) : 0;

    const section = chapter("01", "The numbers");
    const ledger = create("dl", "wrapped-numbers");

    ledger.append(numberItem("Listens", formatNumber(total), null, "primary"));
    ledger.append(
      numberItem(
        "Listening time",
        formatMinutes(data.total_minutes),
        formatDaysOfMusic(data.total_minutes)
      )
    );
    ledger.append(
      numberItem("Artists", formatNumber(data.unique_artists || 0))
    );
    ledger.append(numberItem("Tracks", formatNumber(data.unique_tracks || 0)));
    ledger.append(numberItem("Albums", formatNumber(data.unique_albums || 0)));

    if (daily) {
      ledger.append(
        numberItem(
          "Listening days",
          formatNumber(listeningDays),
          streak > 1 ? `Longest streak: ${formatNumber(streak)} days` : null
        )
      );
    }

    section.append(ledger);
    return section;
  }

  function renderHeadliner(data) {
    const artists = data.top_artists || [];
    if (!artists.length) return null;

    const top = artists[0];
    const count = Number(top.count) || 0;
    const total = Number(data.total_listens) || 0;
    const share = total ? Math.round((count / total) * 100) : 0;

    const section = chapter("02", "The headliner");
    const feature = create("div", "headliner");

    feature.append(
      sleeve({
        cover: coverId(top),
        title: top.artist || "Unknown artist",
        size: 512,
        className: "sleeve--portrait headliner-art",
      })
    );

    const copy = create("div", "headliner-copy");
    copy.append(create("p", "kicker", "Most played artist"));
    copy.append(
      create("h3", "headliner-name", top.artist || "Unknown artist")
    );

    const countLine = create("p", "headliner-count");
    countLine.append(create("strong", null, formatNumber(count)));
    countLine.append(
      document.createTextNode(` ${plural(count, "listen")} this year`)
    );
    copy.append(countLine);

    if (share >= 1 && share < 100) {
      copy.append(
        create(
          "p",
          "headliner-note",
          `${share}% of everything you played.`
        )
      );
    }

    feature.append(copy);
    section.append(feature);

    const rotation = artists.slice(1, 5);
    if (rotation.length) {
      const block = create("div", "rotation");
      block.append(create("p", "rotation-label", "Also in rotation"));

      const list = create("ol", "rotation-list");
      rotation.forEach((item, index) => {
        const row = create("li", "rotation-item");
        const art = create("div", "rotation-art");
        art.append(
          sleeve({
            cover: coverId(item),
            title: item.artist || "Unknown artist",
            size: 128,
            compact: true,
            variant: "monogram",
            decorative: true,
          })
        );

        const rowCopy = create("div", "rotation-copy");
        rowCopy.append(
          create("span", "rotation-rank", String(index + 2).padStart(2, "0"))
        );
        rowCopy.append(
          create("span", "rotation-name", item.artist || "Unknown artist")
        );
        const itemCount = Number(item.count) || 0;
        rowCopy.append(
          create(
            "span",
            "rotation-count",
            `${formatNumber(itemCount)} ${plural(itemCount, "listen")}`
          )
        );

        row.append(art, rowCopy);
        list.append(row);
      });

      block.append(list);
      section.append(block);
    }

    return section;
  }

  function highlightModule(label, item, kind) {
    const article = create("article", "highlight");
    article.append(create("p", "highlight-label", label));

    const body = create("div", "highlight-body");
    const title = kind === "track" ? item.track : item.album;
    const cover = coverId(item);
    body.append(
      sleeve({
        cover,
        title: title || (kind === "track" ? "Unknown track" : "Unknown album"),
        meta: item.artist || "",
        size: 256,
        compact: true,
        variant: "wall",
        decorative: true,
        className: "sleeve--highlight",
      })
    );

    const copy = create("div", "highlight-copy");
    copy.append(
      create(
        "h3",
        "highlight-title",
        title || (kind === "track" ? "Unknown track" : "Unknown album")
      )
    );
    if (item.artist) copy.append(create("p", "highlight-meta", item.artist));
    const count = Number(item.count) || 0;
    copy.append(
      create(
        "p",
        "highlight-count",
        `${formatNumber(count)} ${plural(count, "listen")}`
      )
    );
    body.append(copy);
    article.append(body);
    return article;
  }

  function renderHighlights(data) {
    const track = (data.top_tracks || [])[0];
    const album = (data.top_albums || [])[0];
    const hasDay = Boolean(data.busiest_day);
    if (!track && !album && !hasDay) return null;

    const section = chapter("03", "The highlights");
    const grid = create("div", "wrapped-highlights");

    if (track) grid.append(highlightModule("Top track", track, "track"));
    if (album) grid.append(highlightModule("Top album", album, "album"));

    if (hasDay) {
      const parts = String(data.busiest_day).split("-").map(Number);
      const day = create("article", "highlight highlight-day");
      day.append(create("p", "highlight-label", "Busiest day"));
      day.append(
        create("p", "day-num", String(parts[2] || "").padStart(2, "0"))
      );
      day.append(
        create(
          "p",
          "day-month",
          `${monthNames[parts[1] - 1] || ""} ${parts[0] || ""}`
        )
      );
      const count = Number(data.busiest_day_listens) || 0;
      day.append(
        create(
          "p",
          "day-count",
          `${formatNumber(count)} ${plural(count, "listen")}`
        )
      );
      grid.append(day);
    }

    section.append(grid);
    return section;
  }

  function renderMonths(section, year, data) {
    const block = create("div", "rhythm-block");
    const head = create("div", "rhythm-head");
    head.append(create("h3", null, "Month by month"));

    const monthlyMap = new Map();
    (data.monthly || []).forEach((item) => {
      monthlyMap.set(item.month, Number(item.listens) || 0);
    });

    const values = [];
    for (let month = 1; month <= 12; month += 1) {
      values.push(monthlyMap.get(`${year}-${String(month).padStart(2, "0")}`) || 0);
    }
    const max = Math.max(...values, 1);
    const peak = values.indexOf(max);

    if (values.some((value) => value > 0)) {
      head.append(
        create(
          "p",
          "rhythm-note",
          `Peak: ${monthNames[peak]}, ${formatNumber(max)} ${plural(max, "listen")}.`
        )
      );
    }
    block.append(head);

    const bars = create("div", "month-bars-large");
    bars.setAttribute("role", "img");
    bars.setAttribute(
      "aria-label",
      `Monthly listens in ${year}. Peak month: ${
        monthNames[peak] || "none"
      } with ${formatNumber(max)} listens.`
    );

    values.forEach((value, index) => {
      const bar = create("span", "month-bar-large");
      bar.style.height = `${value ? Math.max(3, Math.round((value / max) * 100)) : 0}%`;
      bar.style.transitionDelay = `${index * 18}ms`;
      if (index === peak && max > 0) bar.classList.add("is-peak");
      bar.title = `${monthNames[index]}: ${formatNumber(value)} ${plural(
        value,
        "listen"
      )}`;
      bar.append(create("span", null, monthNames[index].slice(0, 3)));
      bars.append(bar);
    });

    block.append(bars);
    block.append(
      details(
        "Monthly listens as a table",
        values.map((value, index) => [monthNames[index], formatNumber(value)]),
        ["Month", "Listens"]
      )
    );

    section.append(block);
  }

  function renderWave(section, year, data) {
    if (!Array.isArray(data.daily) || !data.daily.length) return;

    const days = dailyValues(year, data.daily);
    const max = Math.max(...days.map((day) => day.listens), 1);
    const listeningDays = days.filter((day) => day.listens > 0).length;
    const streak = longestStreak(data.daily);

    const block = create("div", "rhythm-block");
    const head = create("div", "rhythm-head");
    head.append(create("h3", null, "The year, day by day"));

    const notes = [
      `${formatNumber(listeningDays)} ${plural(listeningDays, "listening day")}`,
    ];
    if (streak > 1) notes.push(`${formatNumber(streak)}-day streak`);
    head.append(create("p", "rhythm-note", `${notes.join(". ")}.`));
    block.append(head);

    const wave = document.createElementNS(svgNS, "svg");
    wave.setAttribute("class", "year-wave");
    wave.setAttribute("viewBox", `0 0 ${days.length} 100`);
    wave.setAttribute("preserveAspectRatio", "none");
    wave.setAttribute("role", "img");
    wave.setAttribute(
      "aria-label",
      `Daily listens in ${year}. ${formatNumber(
        listeningDays
      )} days with listens. Longest streak ${formatNumber(streak)} days.`
    );

    days.forEach((day, index) => {
      const bar = document.createElementNS(svgNS, "rect");
      const ratio = day.listens / max;
      const height = day.listens ? Math.max(4, ratio * 100) : 1.5;
      bar.setAttribute("class", "wave-bar");
      bar.setAttribute("x", String(index));
      bar.setAttribute("y", String(100 - height));
      bar.setAttribute("width", "0.82");
      bar.setAttribute("height", String(height));
      if (day.listens) {
        bar.classList.add("has-listens");
        bar.style.opacity = String(0.25 + 0.75 * ratio);
      } else {
        bar.style.opacity = "0.18";
      }
      if (day.future) {
        bar.classList.add("is-future");
        bar.style.opacity = "0.3";
      } else if (day.listens === max && day.listens > 0) bar.classList.add("is-peak");
      const title = document.createElementNS(svgNS, "title");
      title.textContent = `${fullDateFormat.format(day.date)}: ${formatNumber(
        day.listens
      )} ${plural(day.listens, "listen")}`;
      bar.append(title);
      wave.append(bar);
    });

    block.append(wave);

    const axis = create("div", "year-wave-axis");
    let elapsed = 0;
    for (let month = 0; month < 12; month += 1) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const left = (elapsed / days.length) * 100;
      const label = create("span", null, monthNames[month].slice(0, 3));
      label.style.left = `${left}%`;
      axis.append(label);
      elapsed += daysInMonth;
    }
    block.append(axis);

    const busiest = [...data.daily]
      .sort((a, b) => (Number(b.listens) || 0) - (Number(a.listens) || 0))
      .slice(0, 10);
    block.append(
      details(
        "Busiest days as a table",
        busiest.map((day) => [
          formatDate(day.date),
          formatNumber(day.listens),
        ]),
        ["Date", "Listens"]
      )
    );

    section.append(block);
  }

  function renderClock(section, data) {
    const hours = Array.isArray(data.hour_hist) ? data.hour_hist : null;
    const weekdays = Array.isArray(data.weekday_hist)
      ? data.weekday_hist
      : null;
    if (!hours && !weekdays) return;

    const block = create("div", "rhythm-block rhythm-split");

    if (hours) {
      const hourMax = Math.max(...hours, 1);
      const peakHour = hours.indexOf(hourMax);
      const hourBlock = create("div", "rhythm-clock");

      const head = create("div", "rhythm-head");
      head.append(create("h3", null, "By the hour"));
      if (hourMax > 0) {
        head.append(
          create(
            "p",
            "rhythm-note",
            `Peak: ${hourLabel(peakHour)}, ${formatNumber(hourMax)} ${plural(
              hourMax,
              "listen"
            )}.`
          )
        );
      }
      hourBlock.append(head);

      const bars = create("div", "clock-bars");
      bars.setAttribute("role", "img");
      bars.setAttribute(
        "aria-label",
        `Listens by hour of day. Peak at ${hourLabel(
          peakHour
        )} with ${formatNumber(hourMax)} listens.`
      );
      hours.forEach((value, index) => {
        const bar = create("span", "clock-bar");
        bar.style.height = `${value ? Math.max(3, Math.round((value / hourMax) * 100)) : 0}%`;
        bar.style.transitionDelay = `${index * 8}ms`;
        if (index === peakHour && hourMax > 0) bar.classList.add("is-peak");
        bar.title = `${hourLabel(index)}: ${formatNumber(value)} ${plural(
          value,
          "listen"
        )}`;
        bars.append(bar);
      });
      hourBlock.append(bars);

      const axis = create("div", "clock-axis");
      [0, 6, 12, 18, 23].forEach((hour) => {
        axis.append(create("span", null, shortHourLabel(hour)));
      });
      hourBlock.append(axis);

      hourBlock.append(
        details(
          "Hourly listens as a table",
          hours.map((value, index) => [hourLabel(index), formatNumber(value)]),
          ["Hour", "Listens"]
        )
      );

      block.append(hourBlock);
    }

    if (weekdays) {
      const dayMax = Math.max(...weekdays, 1);
      const peakDay = weekdays.indexOf(dayMax);
      const dayBlock = create("div", "rhythm-weekday");

      const head = create("div", "rhythm-head");
      head.append(create("h3", null, "By the day"));
      if (dayMax > 0) {
        head.append(
          create(
            "p",
            "rhythm-note",
            `Peak: ${weekdayNames[peakDay]}, ${formatNumber(dayMax)} ${plural(
              dayMax,
              "listen"
            )}.`
          )
        );
      }
      dayBlock.append(head);

      const bars = create("div", "weekday-bars");
      bars.setAttribute("role", "img");
      bars.setAttribute(
        "aria-label",
        `Listens by weekday. Peak on ${weekdayNames[peakDay]} with ${formatNumber(
          dayMax
        )} listens.`
      );
      weekdays.forEach((value, index) => {
        const bar = create("span", "weekday-bar");
        bar.style.height = `${value ? Math.max(3, Math.round((value / dayMax) * 100)) : 0}%`;
        bar.style.transitionDelay = `${index * 24}ms`;
        if (index === peakDay && dayMax > 0) bar.classList.add("is-peak");
        bar.title = `${weekdayNames[index]}: ${formatNumber(value)} ${plural(
          value,
          "listen"
        )}`;
        bar.append(create("span", null, weekdayNames[index].slice(0, 3)));
        bars.append(bar);
      });
      dayBlock.append(bars);

      dayBlock.append(
        details(
          "Weekday listens as a table",
          weekdays.map((value, index) => [
            weekdayNames[index],
            formatNumber(value),
          ]),
          ["Day", "Listens"]
        )
      );

      block.append(dayBlock);
    }

    section.append(block);
  }

  function renderRhythm(year, data) {
    const section = chapter("04", "The shape of the year");
    renderMonths(section, year, data);
    renderWave(section, year, data);
    renderClock(section, data);
    return section;
  }

  function renderCatalog(data) {
    const albums = (data.top_albums || []).slice(0, 8);
    const tracks = (data.top_tracks || []).slice(0, 8);
    if (!albums.length && !tracks.length) return null;

    const section = chapter("05", "The catalog");
    const grid = create("div", "catalog-grid");

    if (albums.length) {
      const block = create("div", "catalog-block");
      block.append(create("h3", null, "The records"));
      const wall = create("ol", "cover-wall");
      albums.forEach((item, index) => {
        const row = create("li", "wall-item");
        const count = Number(item.count) || 0;
        row.append(
          sleeve({
            cover: coverId(item),
            title: item.album || "Unknown album",
            meta: item.artist || "",
            rank: String(index + 1).padStart(2, "0"),
            size: 256,
            variant: "wall",
            decorative: true,
            footnote: `${formatNumber(count)} ${plural(count, "listen")}`,
          })
        );
        wall.append(row);
      });
      block.append(wall);
      grid.append(block);
    }

    if (tracks.length) {
      const block = create("div", "catalog-block");
      block.append(create("h3", null, "The tracks"));
      const list = create("ol", "wrapped-track-list");
      tracks.forEach((item, index) => {
        const count = Number(item.count) || 0;
        const row = create("li", "wrapped-track-item");
        row.append(
          create("span", "track-rank", String(index + 1).padStart(2, "0"))
        );

        const art = create("div", "track-art");
        art.append(
          sleeve({
            cover: coverId(item),
            title: item.track || "Unknown track",
            size: 128,
            compact: true,
            variant: "monogram",
            decorative: true,
          })
        );

        const copy = create("div", "track-copy");
        copy.append(
          create("span", "track-name", item.track || "Unknown track")
        );
        if (item.artist) {
          copy.append(create("span", "track-artist", item.artist));
        }

        row.append(
          art,
          copy,
          create(
            "span",
            "track-count",
            `${formatNumber(count)} ${plural(count, "listen")}`
          )
        );
        list.append(row);
      });
      block.append(list);
      grid.append(block);
    }

    section.append(grid);
    return section;
  }

  function renderColophon(year, data) {
    const section = create("section", "wrapped-colophon");
    section.append(
      create(
        "p",
        "kicker",
        year === currentYear ? `${year}, so far` : `That was ${year}`
      )
    );

    const first = data.first_listen_ts;
    const last = data.last_listen_ts;
    let title = "Every listen, kept.";
    if (first && last) {
      title = `From ${formatTimestamp(first)} to ${formatTimestamp(last)}.`;
    }
    section.append(create("p", "colophon-title", title));

    const total = Number(data.total_listens) || 0;
    section.append(
      create(
        "p",
        "colophon-meta",
        `${formatNumber(total)} ${plural(total, "listen")}, ${formatNumber(
          data.unique_artists || 0
        )} ${plural(data.unique_artists || 0, "artist")}, ${formatNumber(
          data.unique_albums || 0
        )} ${plural(data.unique_albums || 0, "album")}. Built from your ListenBrainz history.`
      )
    );

    const link = create("a", "action-link", "Open the listening archive");
    link.href = "/";
    section.append(link);
    return section;
  }

  function emptyState(year) {
    const section = create("section", "wrapped-empty");
    section.append(create("p", "kicker", "Year in review"));
    section.append(create("h1", "empty-year", year));
    section.append(
      create(
        "p",
        null,
        year === currentYear
          ? `No listens recorded in ${year} yet.`
          : `No listens recorded in ${year}.`
      )
    );
    section.append(
      create(
        "p",
        "empty-note",
        "Your archive begins with the first listen you scrobble. Try another year above, or open the listening archive."
      )
    );
    const link = create("a", "action-link", "Open the listening archive");
    link.href = "/";
    section.append(link);
    return section;
  }

  function revealSections(root) {
    const targets = Array.from(root.querySelectorAll(".reveal"));
    if (!targets.length) return;
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      targets.forEach((target) => target.classList.add("is-revealed"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    targets.forEach((target) => observer.observe(target));
  }

  function render(data, year) {
    clear(container);
    container.append(yearNav(year));

    if (!data || !Number(data.total_listens)) {
      container.append(emptyState(year));
      return;
    }

    container.append(renderCover(year, data));
    container.append(renderNumbers(data));

    const headliner = renderHeadliner(data);
    if (headliner) container.append(headliner);

    const highlights = renderHighlights(data);
    if (highlights) container.append(highlights);

    container.append(renderRhythm(year, data));

    const catalog = renderCatalog(data);
    if (catalog) container.append(catalog);

    container.append(renderColophon(year, data));
    revealSections(container);
  }

  function loadingState(year) {
    clear(container);
    container.append(yearNav(year));
    const section = create("section", "wrapped-loading");
    section.setAttribute("role", "status");
    section.append(create("p", "kicker", "A year in listening"));
    section.append(create("p", "loading-year", year));
    section.append(create("p", "loading", `Gathering ${year}...`));
    container.append(section);
  }

  function errorState(year) {
    clear(container);
    container.append(yearNav(year));
    const section = create("section", "wrapped-empty");
    section.append(create("p", "kicker", "Year in review"));
    section.append(create("h1", "empty-year", year));
    section.append(create("p", null, "Could not load this year right now."));
    section.append(
      create(
        "p",
        "empty-note",
        "Try again in a moment."
      )
    );
    const retry = create("button", "text-btn", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => load(year));
    section.append(retry);
    container.append(section);
  }

  async function load(year) {
    loadingState(year);
    try {
      const response = await fetch(`/api/wrapped/${year}?source=local`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      const data = await response.json();
      document.title = `unwrapped: ${year} in review`;
      render(data, year);
    } catch (error) {
      document.title = `unwrapped: ${year} in review`;
      errorState(year);
    }
  }

  const year = Number(container.dataset.year);
  load(year);
})();

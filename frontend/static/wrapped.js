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

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
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

  function formatDate(value) {
    const parts = String(value).split("-").map(Number);
    return fullDateFormat.format(new Date(parts[0], parts[1] - 1, parts[2]));
  }

  function yearNav(year) {
    const today = new Date().getFullYear();
    const nav = create("div", "wrapped-year-nav");

    const previous = create("a", "wrapped-year-link", "Previous year");
    previous.href = `/wrapped/${year - 1}`;

    const current = create("span", "wrapped-year-current", `${year} in review`);

    const next =
      year >= today
        ? create("span", "wrapped-year-link", "Next year")
        : create("a", "wrapped-year-link", "Next year");
    if (year >= today) {
      next.setAttribute("aria-disabled", "true");
    } else {
      next.href = `/wrapped/${year + 1}`;
    }

    nav.append(previous, current, next);
    return nav;
  }

  function emptyState(year) {
    const section = create("section", "wrapped-empty");
    section.append(create("p", "kicker", "Year in review"));
    section.append(create("h1", null, year));
    section.append(
      create(
        "p",
        null,
        `No listens recorded in ${year} yet.`
      )
    );
    const link = create("a", "action-link", "Explore the listening archive");
    link.href = "/";
    section.append(link);
    return section;
  }

  function fact(label, value, meta) {
    const wrapper = create("div", "wrapped-fact");
    wrapper.append(create("dt", null, label));
    const description = create("dd", null, value || "No data");
    if (meta) description.append(create("span", "fact-meta", meta));
    wrapper.append(description);
    return wrapper;
  }

  function render(data, year) {
    clear(container);
    container.append(yearNav(year));

    if (!data || !Number(data.total_listens)) {
      container.append(emptyState(year));
      return;
    }

    const total = Number(data.total_listens) || 0;
    const topArtists = data.top_artists || [];
    const topTracks = data.top_tracks || [];
    const topAlbums = data.top_albums || [];
    const topArtist = topArtists[0];
    const topTrack = topTracks[0];
    const topAlbum = topAlbums[0];

    const masthead = create("section", "wrapped-masthead");
    masthead.append(create("p", "kicker", "A year in listening"));
    masthead.append(create("h1", "wrapped-year", year));
    masthead.append(
      create(
        "p",
        "wrapped-lede",
        `${formatNumber(total)} ${plural(total, "listen")}. ${formatMinutes(
          data.total_minutes
        )} across ${formatNumber(data.unique_artists)} ${plural(
          data.unique_artists || 0,
          "artist"
        )}.`
      )
    );
    container.append(masthead);

    if (topArtist) {
      const feature = create("section", "wrapped-feature");
      feature.append(create("p", "kicker", "Most played artist"));
      feature.append(create("p", "wrapped-artist", topArtist.artist || "Unknown artist"));
      const count = Number(topArtist.count) || 0;
      feature.append(
        create(
          "p",
          "wrapped-count",
          `${formatNumber(count)} ${plural(count, "listen")}`
        )
      );
      container.append(feature);
    }

    const facts = create("dl", "wrapped-facts");
    if (topTrack) {
      const trackCount = Number(topTrack.count) || 0;
      facts.append(
        fact(
          "Top track",
          topTrack.track || "Unknown track",
          `${topTrack.artist || "Unknown artist"}, ${formatNumber(trackCount)} ${plural(
            trackCount,
            "listen"
          )}`
        )
      );
    }
    if (topAlbum) {
      const albumCount = Number(topAlbum.count) || 0;
      facts.append(
        fact(
          "Top album",
          topAlbum.album || "Unknown album",
          `${topAlbum.artist || "Unknown artist"}, ${formatNumber(albumCount)} ${plural(
            albumCount,
            "listen"
          )}`
        )
      );
    }
    if (data.busiest_day) {
      const busiestCount = Number(data.busiest_day_listens) || 0;
      facts.append(
        fact(
          "Busiest day",
          formatDate(data.busiest_day),
          `${formatNumber(busiestCount)} ${plural(busiestCount, "listen")}`
        )
      );
    }
    if (facts.childElementCount) container.append(facts);

    const monthlySection = create("section", "wrapped-section");

    const monthlyMap = new Map();
    (data.monthly || []).forEach((item) => {
      monthlyMap.set(item.month, Number(item.listens) || 0);
    });

    const values = [];
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      values.push(monthlyMap.get(key) || 0);
    }
    const max = Math.max(...values, 1);
    const peakIndex = values.indexOf(max);

    const monthlyHead = create("div", "wrapped-section-head");
    monthlyHead.append(create("h2", null, "Month by month"));
    if (max > 0) {
      monthlyHead.append(
        create(
          "p",
          "wrapped-section-note",
          `Peak: ${formatNumber(max)} ${plural(max, "listen")} in ${monthNames[peakIndex]}.`
        )
      );
    }
    monthlySection.append(monthlyHead);

    const bars = create("div", "month-bars-large");
    bars.setAttribute("role", "img");
    bars.setAttribute(
      "aria-label",
      `Monthly listens in ${year}. Peak month: ${
        monthNames[peakIndex] || "none"
      } with ${formatNumber(max)} listens.`
    );

    values.forEach((value, index) => {
      const bar = create("span", "month-bar-large");
      bar.style.height = `${value ? Math.max(2, Math.round((value / max) * 100)) : 0}%`;
      bar.title = `${monthNames[index]}: ${formatNumber(value)} ${plural(
        value,
        "listen"
      )}`;
      bar.append(create("span", null, monthNames[index].slice(0, 3)));
      bars.append(bar);
    });

    monthlySection.append(bars);
    container.append(monthlySection);

    if (topArtists.length) {
      const artistsSection = create("section", "wrapped-section");
      artistsSection.append(create("h2", null, "Most played artists"));

      const list = create("ol", "rank-list");

      topArtists.slice(0, 5).forEach((item, index) => {
        const count = Number(item.count) || 0;
        const row = create("li", "rank-item");
        row.append(create("span", "rank-number", String(index + 1)));

        const name = create("span", "rank-name");
        name.append(create("span", "rank-title", item.artist || "Unknown artist"));
        row.append(name);
        row.append(
          create(
            "span",
            "rank-count",
            `${formatNumber(count)} ${plural(count, "listen")}`
          )
        );
        list.append(row);
      });

      artistsSection.append(list);
      container.append(artistsSection);
    }

    const actions = create("div", "wrapped-actions");
    const explore = create("a", "action-link", "Explore the listening archive");
    explore.href = "/";
    actions.append(explore);
    container.append(actions);
  }

  function errorState(year) {
    clear(container);
    container.append(yearNav(year));
    const section = create("section", "wrapped-empty");
    section.append(create("p", "kicker", "Year in review"));
    section.append(create("h1", null, year));
    section.append(create("p", null, "Could not load this year right now."));
    const retry = create("button", "text-btn", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => load(year));
    section.append(retry);
    container.append(section);
  }

  async function load(year) {
    clear(container);
    container.append(create("p", "loading", `Loading ${year}...`));

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

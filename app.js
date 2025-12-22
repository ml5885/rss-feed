const LOCAL_CORS_PROXY = "http://localhost:8787/proxy?url=";

const CORS_PROXIES = [
	(u) => `${LOCAL_CORS_PROXY}${encodeURIComponent(u)}`,
	(u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

const STORAGE_KEY = "morning-pages-feeds";
const FILTER_STORAGE_KEY = "morning-pages-time-filter";
const SOURCE_FILTER_STORAGE_KEY = "morning-pages-source-filter";
const THEME_STORAGE_KEY = "morning-pages-theme-index";
const THEME_COUNT = 6;

const FETCH_TIMEOUT_MS = 25000;
const MAX_ITEMS_PER_FEED = 25;

let feeds = [];
let allItems = [];
let visibleItems = [];
let feedSourceByUrl = {};
let enabledSources = null;
let timeFilter = { type: "all" };

const feedList = document.getElementById("feed-list");
const loading = document.getElementById("loading");
const emptyState = document.getElementById("empty-state");
const footer = document.getElementById("footer");
const sourceCount = document.getElementById("source-count");
const currentDate = document.getElementById("current-date");
const modalOverlay = document.getElementById("modal-overlay");
const feedListSettings = document.getElementById("feed-list-settings");
const newFeedUrl = document.getElementById("new-feed-url");
const filterBtn = document.getElementById("filter-btn");
const filterModalOverlay = document.getElementById("filter-modal-overlay");
const filterFrom = document.getElementById("filter-from");
const filterTo = document.getElementById("filter-to");
const activeFilter = document.getElementById("active-filter");
const sourceFilterList = document.getElementById("source-filter-list");
const activeSourceFilter = document.getElementById("active-source-filter");

document.addEventListener("DOMContentLoaded", () => {
	cycleBackgroundTheme();
	setCurrentDate();
	loadTimeFilter();
	loadSourceFilter();
	loadFeeds();
	setupEventListeners();
	updateActiveFilterUI();
	updateActiveSourceFilterUI();
});

function cycleBackgroundTheme() {
	const lastIndex = parseInt(
		localStorage.getItem(THEME_STORAGE_KEY) || "0",
		10
	);
	const nextIndex = (lastIndex + 1) % THEME_COUNT;
	document.documentElement.setAttribute("data-theme", nextIndex.toString());
	localStorage.setItem(THEME_STORAGE_KEY, nextIndex.toString());
}

function setCurrentDate() {
	currentDate.textContent = new Date().toLocaleDateString("en-US", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

function setupEventListeners() {
	document.getElementById("settings-btn").addEventListener("click", openModal);
	document.getElementById("modal-close").addEventListener("click", closeModal);
	modalOverlay.addEventListener(
		"click",
		(e) => e.target === modalOverlay && closeModal()
	);

	filterBtn?.addEventListener("click", openFilterModal);
	document
		.getElementById("filter-modal-close")
		?.addEventListener("click", closeFilterModal);
	filterModalOverlay?.addEventListener(
		"click",
		(e) => e.target === filterModalOverlay && closeFilterModal()
	);

	document.querySelectorAll(".filter-pill").forEach((btn) => {
		btn.addEventListener("click", () => selectFilterPreset(btn.dataset.preset));
	});

	document
		.getElementById("filter-apply")
		?.addEventListener("click", applyCombinedFilterFromUI);
	document
		.getElementById("filter-reset")
		?.addEventListener("click", resetFilterUI);
	document
		.getElementById("active-filter-clear")
		?.addEventListener("click", () => {
			setTimeFilter({ type: "all" });
			applyTimeFilterAndRender();
		});

	document
		.getElementById("source-filter-select-all")
		?.addEventListener("click", selectAllSources);
	document
		.getElementById("source-filter-deselect-all")
		?.addEventListener("click", deselectAllSources);

	document
		.getElementById("active-source-filter-clear")
		?.addEventListener("click", () => {
			enabledSources = null;
			saveSourceFilter();
			updateActiveSourceFilterUI();
			applyTimeFilterAndRender();
		});

	document.getElementById("add-feeds-btn").addEventListener("click", openModal);
	document
		.getElementById("add-feed-btn")
		.addEventListener("click", addFeedFromInput);
	newFeedUrl.addEventListener(
		"keypress",
		(e) => e.key === "Enter" && addFeedFromInput()
	);

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			closeModal();
			closeFilterModal();
		}
	});
}

function openModal() {
	modalOverlay.classList.add("active");
	renderFeedSettings();
	newFeedUrl.focus();
}

function closeModal() {
	modalOverlay.classList.remove("active");
}

function openFilterModal() {
	hydrateFilterModalFromState();
	renderSourceFilterList();
	filterModalOverlay?.classList.add("active");
}

function closeFilterModal() {
	filterModalOverlay?.classList.remove("active");
}

function loadTimeFilter() {
	try {
		const stored = localStorage.getItem(FILTER_STORAGE_KEY);
		if (stored) timeFilter = normalizeTimeFilter(JSON.parse(stored));
	} catch {}
}

function normalizeTimeFilter(filter) {
	if (filter.type === "preset" && ["24h", "7d", "30d"].includes(filter.preset))
		return filter;
	if (filter.type === "range" && (filter.from || filter.to)) return filter;
	return { type: "all" };
}

function setTimeFilter(next) {
	timeFilter = normalizeTimeFilter(next);
	localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(timeFilter));
	updateActiveFilterUI();
}

function updateActiveFilterUI() {
	const labelElement = document.getElementById("active-filter-label");
	const label = describeTimeFilter(timeFilter);

	if (!label) {
		activeFilter.style.display = "none";
		filterBtn?.classList.remove("is-active");
	} else {
		labelElement.textContent = label;
		activeFilter.style.display = "flex";
		filterBtn?.classList.add("is-active");
	}
}

function describeTimeFilter(filter) {
	if (filter.type === "preset") {
		const map = {
			"24h": "Last 24 hours",
			"7d": "Last 7 days",
			"30d": "Last 30 days",
		};
		return map[filter.preset] || "";
	}
	if (filter.type === "range") {
		if (filter.from && filter.to)
			return `${formatISODateShort(filter.from)} → ${formatISODateShort(
				filter.to
			)}`;
		if (filter.from) return `From ${formatISODateShort(filter.from)}`;
		if (filter.to) return `Until ${formatISODateShort(filter.to)}`;
	}
	return "";
}

function formatISODateShort(isoDate) {
	const d = new Date(isoDate + "T00:00:00");
	return Number.isNaN(d.getTime())
		? isoDate
		: d.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
		  });
}

function hydrateFilterModalFromState() {
	document.querySelectorAll(".filter-pill").forEach((btn) => {
		btn.classList.toggle(
			"selected",
			(timeFilter.type === "all" && btn.dataset.preset === "all") ||
				(timeFilter.type === "preset" &&
					btn.dataset.preset === timeFilter.preset)
		);
	});
	if (filterFrom && filterTo) {
		filterFrom.value = timeFilter.from || "";
		filterTo.value = timeFilter.to || "";
	}
}

function selectFilterPreset(preset) {
	if (filterFrom) filterFrom.value = "";
	if (filterTo) filterTo.value = "";
	document.querySelectorAll(".filter-pill").forEach((btn) => {
		btn.classList.toggle("selected", btn.dataset.preset === preset);
	});
}

function resetFilterUI() {
	setTimeFilter({ type: "all" });
	enabledSources = null;
	saveSourceFilter();
	applyTimeFilterAndRender();
	closeFilterModal();
}

function applyCombinedFilterFromUI() {
	const from = filterFrom?.value;
	const to = filterTo?.value;
	const preset = document.querySelector(".filter-pill.selected")?.dataset
		.preset;

	if (from || to)
		setTimeFilter({ type: "range", from: from || null, to: to || null });
	else if (["24h", "7d", "30d"].includes(preset))
		setTimeFilter({ type: "preset", preset });
	else setTimeFilter({ type: "all" });

	const allSources = getAllSources();
	if (sourceFilterList && allSources.length > 0) {
		const checked = Array.from(
			sourceFilterList.querySelectorAll(".source-filter-checkbox:checked")
		);
		if (checked.length === allSources.length) enabledSources = null;
		else enabledSources = new Set(checked.map((cb) => cb.dataset.source));
		saveSourceFilter();
	}

	applyTimeFilterAndRender();
	closeFilterModal();
}

function loadSourceFilter() {
	try {
		const stored = localStorage.getItem(SOURCE_FILTER_STORAGE_KEY);
		if (stored) enabledSources = new Set(JSON.parse(stored));
	} catch {}
}

function getSourceLabelFromFeedUrl(feedUrl) {
	try {
		const u = new URL(feedUrl);
		return (u.hostname || feedUrl).replace(/^www\./i, "");
	} catch {
		return feedUrl;
	}
}

function saveSourceFilter() {
	if (enabledSources === null)
		localStorage.removeItem(SOURCE_FILTER_STORAGE_KEY);
	else
		localStorage.setItem(
			SOURCE_FILTER_STORAGE_KEY,
			JSON.stringify([...enabledSources])
		);
}

function getAllSources() {
	const sources = new Set(allItems.map((i) => i.source).filter(Boolean));
	for (const url of feeds) {
		const label = feedSourceByUrl[url] || getSourceLabelFromFeedUrl(url);
		if (label) sources.add(label);
	}
	return [...sources].sort((a, b) => a.localeCompare(b));
}

function normalizeEnabledSourcesToAvailable() {
	if (enabledSources === null) return;
	const available = new Set(getAllSources());
	enabledSources = new Set([...enabledSources].filter((s) => available.has(s)));
	if (enabledSources.size === available.size) enabledSources = null;
	saveSourceFilter();
}

function renderSourceFilterList() {
	if (!sourceFilterList) return;
	const sources = getAllSources();
	if (sources.length === 0) {
		sourceFilterList.innerHTML =
			'<li class="source-filter-empty">No sources available</li>';
		return;
	}

	sourceFilterList.innerHTML = sources
		.map(
			(source) => `
        <li class="source-filter-item">
            <label class="source-filter-label">
                <input type="checkbox" class="source-filter-checkbox" data-source="${source}" 
                    ${
											enabledSources === null || enabledSources.has(source)
												? "checked"
												: ""
										}>
                <span class="source-filter-checkmark"></span>
                <span class="source-filter-name">${source}</span>
            </label>
        </li>
    `
		)
		.join("");
}

function selectAllSources() {
	sourceFilterList
		?.querySelectorAll(".source-filter-checkbox")
		.forEach((cb) => (cb.checked = true));
}

function deselectAllSources() {
	sourceFilterList
		?.querySelectorAll(".source-filter-checkbox")
		.forEach((cb) => (cb.checked = false));
}

function updateActiveSourceFilterUI() {
	const allSources = getAllSources();
	if (enabledSources === null || enabledSources.size === allSources.length) {
		activeSourceFilter.style.display = "none";
		filterBtn?.classList.remove("is-active");
		return;
	}

	const label =
		enabledSources.size === 0
			? "No sources"
			: enabledSources.size === 1
			? [...enabledSources][0].substring(0, 22) +
			  (enabledSources.size > 22 ? "..." : "")
			: `${enabledSources.size} sources`;

	document.getElementById("active-source-filter-label").textContent = label;
	activeSourceFilter.style.display = "flex";
	filterBtn?.classList.add("is-active");
}

function loadFeeds() {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored) feeds = JSON.parse(stored);

	if (feeds.length === 0) {
		loading.style.display = "none";
		emptyState.style.display = "block";
	} else {
		initFeedLoading();
	}
}

function addFeedFromInput() {
	const url = newFeedUrl.value.trim();
	try {
		new URL(url);
		if (!feeds.includes(url)) {
			feeds.push(url);
			localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
			renderFeedSettings();
			initFeedLoading();
			newFeedUrl.value = "";
		}
	} catch {}
}

function removeFeed(url) {
	feeds = feeds.filter((f) => f !== url);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
	renderFeedSettings();
	initFeedLoading();
}

function renderFeedSettings() {
	feedListSettings.innerHTML = feeds
		.map(
			(url) => `
        <li>
            <span class="feed-url">${url}</span>
            <button class="remove-btn" onclick="removeFeed('${url}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </li>
    `
		)
		.join("");
}

function fetchWithTimeout(url, timeoutMs) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	return fetch(url, {
		signal: controller.signal,
		cache: "no-store",
		redirect: "follow",
		headers: {
			accept:
				"application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
		},
	}).finally(() => clearTimeout(timeoutId));
}

function looksLikeFeed(text) {
	const t = (text || "").trim();
	if (!t) return false;
	if (t.startsWith("<!DOCTYPE html")) return false;
	if (t.includes("<rss")) return true;
	if (t.includes("<feed")) return true;
	if (t.includes("<rdf:RDF")) return true;
	return false;
}

async function fetchFeedText(feedUrl) {
	let lastErr = null;

	for (const build of CORS_PROXIES) {
		const target = build(feedUrl);
		try {
			const res = await fetchWithTimeout(target, FETCH_TIMEOUT_MS);
			if (!res.ok) {
				lastErr = new Error(`HTTP ${res.status}`);
				continue;
			}
			const text = await res.text();
			if (!looksLikeFeed(text)) {
				lastErr = new Error("Not a feed");
				continue;
			}
			return text;
		} catch (e) {
			lastErr = e;
		}
	}

	throw lastErr || new Error("All proxies failed");
}

async function fetchFeed(url) {
	try {
		const text = await fetchFeedText(url);
		const items = parseFeed(text, url) || [];

		// Keep only the newest N items per feed (some feeds may have fewer).
		return items
			.slice()
			.sort((a, b) => (b?.date?.getTime?.() || 0) - (a?.date?.getTime?.() || 0))
			.slice(0, MAX_ITEMS_PER_FEED);
	} catch (e) {
		console.warn(`Failed to fetch ${url}`, e);
		return null;
	}
}

async function initFeedLoading() {
	loading.style.display = "block";
	emptyState.style.display = "none";
	feedList.innerHTML = "";
	allItems = [];
	sourceCount.textContent = feeds.length;
	footer.style.display = "none";

	const progressBar = document.getElementById("progress-bar");
	const progressText = document.getElementById("progress-text");

	if (feeds.length === 0) {
		loading.style.display = "none";
		emptyState.style.display = "block";
		return;
	}

	let loadedCount = 0;
	const totalFeeds = feeds.length;

	progressBar.style.width = "0%";
	progressText.textContent = `0 / ${totalFeeds} feeds`;

	for (const url of feeds) {
		const items = await fetchFeed(url);
		loadedCount++;
		progressBar.style.width = `${(loadedCount / totalFeeds) * 100}%`;
		progressText.textContent = `${loadedCount} / ${totalFeeds} feeds`;
		if (items) allItems.push(...items);
	}

	allItems.sort((a, b) => b.date - a.date);

	loading.style.display = "none";
	footer.style.display = "block";
	normalizeEnabledSourcesToAvailable();
	applyTimeFilterAndRender();
}

function applyTimeFilterAndRender() {
	let result = allItems;

	if (timeFilter.type === "preset") {
		const ms = { "24h": 864e5, "7d": 6048e5, "30d": 2592e6 }[timeFilter.preset];
		const cutoff = new Date(Date.now() - ms);
		result = result.filter((i) => i.date >= cutoff);
	} else if (timeFilter.type === "range") {
		const from = timeFilter.from ? new Date(timeFilter.from) : null;
		const to = timeFilter.to ? new Date(timeFilter.to) : null;
		if (to) to.setDate(to.getDate() + 1);
		result = result.filter(
			(i) => (!from || i.date >= from) && (!to || i.date < to)
		);
	}

	if (enabledSources !== null) {
		result = result.filter((i) => enabledSources.has(i.source));
	}

	visibleItems = result;

	renderAllItems();
	updateActiveFilterUI();
	updateActiveSourceFilterUI();
}

function parseFeed(xmlText, feedUrl) {
	const parser = new DOMParser();
	const xml = parser.parseFromString(xmlText, "text/xml");

	const isAtom = xml.getElementsByTagName("entry").length > 0;
	const items = isAtom
		? xml.getElementsByTagName("entry")
		: xml.getElementsByTagName("item");

	const channel = isAtom
		? xml.querySelector("feed")
		: xml.querySelector("channel");
	const channelLink = isAtom
		? (
				channel?.querySelector("link[rel='alternate']") ||
				channel?.querySelector("link")
		  )?.getAttribute("href")
		: channel?.querySelector("link")?.textContent;

	let baseUrl;
	try {
		baseUrl = channelLink
			? new URL(channelLink, feedUrl).href
			: new URL(feedUrl).origin;
	} catch {
		baseUrl = feedUrl;
	}

	const feedTitle = channel?.querySelector("title")?.textContent || feedUrl;
	const sourceName = feedTitle
		.replace(/\s*[-–—|]\s*(RSS|Feed|Blog).*$/i, "")
		.replace(/\s*RSS.*$/i, "")
		.trim();
	feedSourceByUrl[feedUrl] = sourceName || getSourceLabelFromFeedUrl(feedUrl);

	return Array.from(items).map((item) => {
		const title = item.querySelector("title")?.textContent;
		const link = isAtom
			? (
					item.querySelector("link[rel='alternate']") ||
					item.querySelector("link")
			  )?.getAttribute("href")
			: item.querySelector("link")?.textContent;

		const desc =
			item.querySelector("description")?.textContent ||
			item.querySelector("content")?.textContent ||
			item.querySelector("summary")?.textContent;

		const pubDate =
			item.querySelector("published")?.textContent ||
			item.querySelector("updated")?.textContent ||
			item.querySelector("pubDate")?.textContent;

		return {
			title: (title || "Untitled").trim(),
			link,
			description: cleanDescription(desc),
			date: pubDate ? new Date(pubDate) : new Date(),
			source: sourceName,
			thumbnail: extractThumbnail(item, desc, baseUrl),
		};
	});
}

function cleanDescription(html) {
	if (!html) return "";
	const temp = document.createElement("div");
	temp.innerHTML = html;
	let text = (temp.textContent || temp.innerText || "")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > 200 ? text.substring(0, 200).trim() + "..." : text;
}

function extractThumbnail(item, description, baseUrl) {
	let url = null;

	const media =
		item.getElementsByTagName("media:content")[0] ||
		item.getElementsByTagName("media:thumbnail")[0];
	if (media) url = media.getAttribute("url");

	if (!url) {
		const enclosure = item.querySelector('enclosure[type^="image"]');
		if (enclosure) url = enclosure.getAttribute("url");
	}

	if (!url && description) {
		const match = description.match(/<img[^>]+src=["']([^"']+)["']/i);
		if (match) url = match[1];
	}

	if (!url) return null;

	try {
		return new URL(url, baseUrl).href;
	} catch {
		return null;
	}
}

function renderAllItems() {
	const base =
		visibleItems.length > 0
			? visibleItems
			: feeds.length > 0 && allItems.length === 0
			? []
			: allItems;

	if (base.length === 0) {
		feedList.innerHTML = `<li class="feed-item"><div class="feed-content"><p style="color:var(--text-tertiary);font-style:italic;">No stories found.</p></div></li>`;
		return;
	}

	feedList.innerHTML = base
		.map(
			(item) => `
        <li class="feed-item ${item.thumbnail ? "has-thumbnail" : ""}">
            <div class="feed-content">
                <div class="feed-header">
                    <span class="feed-source">${item.source}</span>
                    <span class="feed-time">${formatDate(item.date)}</span>
                </div>
                <h2 class="feed-title"><a href="${
									item.link
								}" target="_blank" rel="noopener">${item.title}</a></h2>
                <p class="feed-excerpt">${item.description}</p>
            </div>
            ${
							item.thumbnail
								? `<img class="feed-thumbnail" src="${item.thumbnail}" onerror="this.style.display='none'">`
								: ""
						}
        </li>
    `
		)
		.join("");
}

function formatDate(date) {
	const diff = (new Date() - date) / 1000;
	if (diff < 86400) {
		if (diff < 3600) return Math.floor(diff / 60) + "m ago";
		return Math.floor(diff / 3600) + "h ago";
	}
	return diff < 604800
		? Math.floor(diff / 86400) + "d ago"
		: date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

window.removeFeed = removeFeed;

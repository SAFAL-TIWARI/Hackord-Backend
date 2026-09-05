const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const Hackathon = require("../models/Hackathon");

const FILE_PATH = path.join(__dirname, "../data/scraped_hackathons.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Ensure data directory exists
function ensureDataDirExists() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Validates if a target URL exists and responds without 404 / broken error.
 * Trusted platform domains are verified authentic by default.
 */
async function checkUrlExists(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return false;

  const trustedDomains = [
    "devfolio.co",
    "mlh.io",
    "events.mlh.io",
    "lu.ma",
    "luma.com",
    "devpost.com",
    "unstop.com",
    "gdg.community.dev",
    "google.com",
    "hackerearth.com",
    "github.com",
  ];

  try {
    const parsed = new URL(url);
    if (trustedDomains.some((d) => parsed.hostname.endsWith(d))) {
      return true;
    }
  } catch {
    return false;
  }

  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
    // If 404 or 410, link is definitely dead
    if (res.status === 404 || res.status === 410) {
      return false;
    }
    return true;
  } catch (err) {
    // If timeout or network handshake failed, do not immediately discard valid events
    return true;
  }
}

// ─── 1. Live Devpost Scraper ────────────────────────────────────────────────
async function scrapeDevpost() {
  try {
    const res = await axios.get("https://devpost.com/api/hackathons?page=1", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });

    const rawList = res.data?.hackathons || [];
    const results = [];

    for (const h of rawList.slice(0, 15)) {
      const isOnline = h.displayed_location?.location?.toLowerCase().includes("online");
      const prizeText = h.prize_amount ? h.prize_amount.replace(/<[^>]*>/g, "").trim() : "$10,000+";

      let prizeUSD = 10000;
      const matchUSD = prizeText.replace(/,/g, "").match(/\$?\s*(\d+)/);
      if (matchUSD && matchUSD[1]) {
        prizeUSD = parseInt(matchUSD[1], 10);
      }

      const platformUrl = h.url || "https://devpost.com";
      const banner = h.thumbnail_url
        ? h.thumbnail_url.startsWith("//")
          ? "https:" + h.thumbnail_url
          : h.thumbnail_url
        : "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80";

      results.push({
        name: h.title || "Devpost Hackathon",
        organizer: h.organization_name || "Devpost Sponsor",
        banner,
        prizePool: prizeText,
        prizePoolUSD: prizeUSD,
        mode: isOnline ? "Online" : "Offline",
        level: isOnline ? "Global" : "National",
        registrationDeadline: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 28 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 35 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: (h.themes || []).map((t) => t.name).concat(["Devpost", isOnline ? "Global" : "National"]).filter(Boolean),
        platform: "Devpost",
        platformUrl,
        description: `${h.title} hosted by ${h.organization_name || "Devpost"}. Join this live challenge directly on Devpost.`,
      });
    }
    return results;
  } catch (err) {
    console.error("[ScraperService] Devpost error:", err.message);
    return [];
  }
}

// ─── 2. Live Unstop Scraper ─────────────────────────────────────────────────
async function scrapeUnstop() {
  try {
    const res = await axios.get(
      "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&per_page=15",
      {
        headers: { "User-Agent": USER_AGENT },
        timeout: 10000,
      }
    );

    const rawList = res.data?.data?.data || [];
    const results = [];

    for (const h of rawList.slice(0, 15)) {
      const bannerUrl =
        h.banner_mobile?.image_url ||
        h.logoUrl2 ||
        h.banner_desktop?.image_url ||
        "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80";

      const isOnline = h.filters?.some((f) => f.name?.toLowerCase().includes("online"));
      const platformUrl = "https://unstop.com/" + (h.public_url || "hackathons");

      results.push({
        name: h.title,
        organizer: h.organisation?.name || h.company_name || "Unstop Partner",
        banner: bannerUrl,
        prizePool: h.prizes_count ? `₹${h.prizes_count * 50}k+ & Certificates` : "Prizes & Certificates",
        prizePoolUSD: 1500,
        mode: isOnline ? "Online" : "Offline",
        level: "National",
        registrationDeadline: h.regnRequirements?.end_regn_dt
          ? h.regnRequirements.end_regn_dt.split("T")[0]
          : new Date(Date.now() + 10 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 20 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 25 * 86400000).toISOString().split("T")[0],
        teamSize: { min: h.min_team_size || 1, max: h.max_team_size || 4 },
        tags: [h.category || "Hackathon", "Unstop", "National Level"].filter(Boolean),
        platform: "Unstop",
        platformUrl,
        description: `${h.title} hosted by ${h.organisation?.name || "Unstop"}. Official live competition registered on Unstop.`,
      });
    }
    return results;
  } catch (err) {
    console.error("[ScraperService] Unstop error:", err.message);
    return [];
  }
}

// ─── 3. Live MLH Scraper (From https://mlh.io/events) ──────────────────────
async function scrapeMLH() {
  try {
    const res = await axios.get("https://mlh.io/events", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 12000,
    });

    const $ = cheerio.load(res.data);
    const results = [];
    const seenUrls = new Set();

    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      if (
        (href.includes("utm_campaign=events") || href.includes("events.mlh.io/events/") || href.includes("utm_source=mlh")) &&
        !seenUrls.has(href.split("?")[0])
      ) {
        const card = $(el);
        const cleanUrl = href.split("?")[0];
        seenUrls.add(cleanUrl);

        // Extract name from utm_content or headings
        const utmMatch = href.match(/utm_content=([^&]+)/);
        let name = utmMatch ? decodeURIComponent(utmMatch[1]).replace(/\+/g, " ") : "";
        if (!name || name.length < 3) {
          name = card.find("h3, h4, h5").first().text().trim();
        }
        if (!name || name.length < 2) return;

        const img =
          card.find("img").attr("src") ||
          "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80";

        const text = card.text().trim();
        const isOnline =
          text.toLowerCase().includes("digital") ||
          text.toLowerCase().includes("online") ||
          cleanUrl.includes("global-hack-week");

        let regDays = 14;
        let subDays = 24;

        results.push({
          name,
          organizer: "Major League Hacking (MLH)",
          banner: img,
          prizePool: "$10,000 in Swag & Grants",
          prizePoolUSD: 10000,
          mode: isOnline ? "Online" : "Offline",
          level: "Global",
          registrationDeadline: new Date(Date.now() + regDays * 86400000).toISOString().split("T")[0],
          submissionDeadline: new Date(Date.now() + subDays * 86400000).toISOString().split("T")[0],
          resultDate: new Date(Date.now() + (subDays + 3) * 86400000).toISOString().split("T")[0],
          teamSize: { min: 1, max: 4 },
          tags: ["MLH", "Student Hackathon", isOnline ? "Online" : "Global"].filter(Boolean),
          platform: "MLH",
          platformUrl: cleanUrl,
          description: `Official MLH Member Hackathon: ${name}. Connect with fellow student builders and hackers worldwide on MLH!`,
        });
      }
    });

    return results.slice(0, 15);
  } catch (err) {
    console.error("[ScraperService] MLH error:", err.message);
    return [];
  }
}

// ─── 4. Live Devfolio Scraper (From https://devfolio.co/hackathons) ────────
async function scrapeDevfolio() {
  try {
    const res = await axios.get("https://devfolio.co/hackathons", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 12000,
    });

    const nextDataMatch = res.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      console.warn("[ScraperService] Devfolio __NEXT_DATA__ not found");
      return [];
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const queries = nextData.props?.pageProps?.dehydratedState?.queries || [];
    const queryData = queries.find(
      (q) => q.queryKey === "fetchAllHackathonTypes" || q.state?.data?.open_hackathons
    )?.state?.data;

    if (!queryData) {
      console.warn("[ScraperService] Devfolio queryData not found");
      return [];
    }

    const rawList = [
      ...(queryData.open_hackathons || []),
      ...(queryData.upcoming_hackathons || []),
      ...(queryData.featured_hackathons || []),
    ];

    const results = [];
    const seenSlugs = new Set();

    for (const h of rawList) {
      if (!h.slug || seenSlugs.has(h.slug)) continue;
      seenSlugs.add(h.slug);

      const name = h.name || "Devfolio Hackathon";
      const platformUrl = `https://${h.slug}.devfolio.co`;
      const banner =
        h.settings?.featured_cover_img_v2 ||
        h.settings?.featured_cover_img ||
        "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&q=80";

      const regDeadline = h.settings?.reg_ends_at
        ? h.settings.reg_ends_at.split("T")[0]
        : h.ends_at
        ? h.ends_at.split("T")[0]
        : new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

      const subDeadline = h.ends_at
        ? h.ends_at.split("T")[0]
        : new Date(Date.now() + 25 * 86400000).toISOString().split("T")[0];

      const resDate = new Date(new Date(subDeadline).getTime() + 5 * 86400000).toISOString().split("T")[0];

      const themes = (h.themes || [])
        .map((t) => (typeof t === "string" ? t : t.theme?.name))
        .filter(Boolean);

      results.push({
        name,
        organizer: "Devfolio Community",
        banner,
        prizePool: "₹2,50,000+ & Grants",
        prizePoolUSD: 3000,
        mode: h.is_online ? "Online" : "Offline",
        level: "National",
        registrationDeadline: regDeadline,
        submissionDeadline: subDeadline,
        resultDate: resDate,
        teamSize: { min: 1, max: 4 },
        tags: ["Devfolio", ...themes, h.is_online ? "Online" : "Offline"].slice(0, 5),
        platform: "Devfolio",
        platformUrl,
        description: `${name} on Devfolio. Experience premier developer hackathons and build innovative web3, AI, and software apps.`,
      });
    }

    return results.slice(0, 15);
  } catch (err) {
    console.error("[ScraperService] Devfolio error:", err.message);
    return [];
  }
}

// ─── 5. Live Luma Scraper (From https://api.lu.ma/discover/get-paginated-events)
async function scrapeLuma() {
  try {
    const res = await axios.get("https://api.lu.ma/discover/get-paginated-events?query=hackathon", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });

    const entries = res.data?.entries || [];
    const results = [];
    const seenUrls = new Set();

    for (const item of entries) {
      const ev = item.event;
      if (!ev || !ev.name) continue;

      const urlSlug = ev.url || ev.api_id;
      const platformUrl = `https://lu.ma/${urlSlug}`;
      if (seenUrls.has(platformUrl)) continue;
      seenUrls.add(platformUrl);

      const isOnline = !ev.geo_address_json || ev.geo_address_json?.type === "online";
      const banner =
        ev.cover_url ||
        item.calendar?.avatar_url ||
        "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800&q=80";

      const startAt = ev.start_at
        ? ev.start_at.split("T")[0]
        : new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

      const endAt = ev.end_at
        ? ev.end_at.split("T")[0]
        : new Date(new Date(startAt).getTime() + 2 * 86400000).toISOString().split("T")[0];

      const resDate = new Date(new Date(endAt).getTime() + 2 * 86400000).toISOString().split("T")[0];

      results.push({
        name: ev.name,
        organizer: item.calendar?.name || "Luma Tech Community",
        banner,
        prizePool: "$5,000+ Swag & Perks",
        prizePoolUSD: 5000,
        mode: isOnline ? "Online" : "Offline",
        level: "Global",
        registrationDeadline: startAt,
        submissionDeadline: endAt,
        resultDate: resDate,
        teamSize: { min: 1, max: 4 },
        tags: ["Luma", "Global Tech", isOnline ? "Online" : "In-Person", "Hackathon"],
        platform: "Luma",
        platformUrl,
        description: `${ev.name} hosted on Luma (${platformUrl}). Join builders, explore ideas, and demo projects live on Luma.`,
      });
    }

    return results.slice(0, 15);
  } catch (err) {
    console.error("[ScraperService] Luma error:", err.message);
    return [];
  }
}

// ─── 6. Live GDG Scraper ────────────────────────────────────────────────────
async function scrapeGDG() {
  try {
    const gdgEventsPage = "https://gdg.community.dev/events/";
    const res = await axios.get("https://gdg.community.dev/api/search/event?q=hackathon", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });

    const rawItems = res.data?.results || [];
    const results = [];

    for (const item of rawItems.slice(0, 15)) {
      if (!item.title) continue;
      const itemUrl = item.url || (item.slug ? `https://gdg.community.dev/events/details/${item.slug}/` : gdgEventsPage);
      const chapter = item.chapter_name || "Google Developer Groups";

      const bannerUrl =
        item.banner?.url ||
        item.cropped_banner_url ||
        item.picture_url ||
        item.picture?.url ||
        "https://images.unsplash.com/photo-1573164713988-8665fc963095?w=800&q=80";

      results.push({
        name: item.title,
        organizer: `GDG (${chapter})`,
        banner: bannerUrl,
        prizePool: "$30,000 Google Cloud & Mentorship",
        prizePoolUSD: 30000,
        mode: item.event_type_title?.toLowerCase().includes("virtual") ? "Online" : "Hybrid",
        level: "Global",
        registrationDeadline: item.start_date
          ? item.start_date.split("T")[0]
          : new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 35 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 45 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: ["GDG", "Google Cloud", "Solution Challenge", "Flutter"],
        platform: "GDG",
        platformUrl: itemUrl,
        description: `${item.title} hosted on GDG Events. Official Google Developer Groups hackathon for solving real-world challenges.`,
      });
    }

    return results.slice(0, 15);
  } catch (err) {
    console.error("[ScraperService] GDG error:", err.message);
    return [];
  }
}

// ─── Main Aggregator & File Storage Engine ──────────────────────────────────
async function scrapeHackathonsToFile(options = {}) {
  console.log("[ScraperService] 🚀 Starting live web scraping across Devpost, Unstop, MLH, Devfolio, Luma, and GDG...");

  const [devpost, unstop, mlh, devfolio, luma, gdg] = await Promise.all([
    scrapeDevpost(),
    scrapeUnstop(),
    scrapeMLH(),
    scrapeDevfolio(),
    scrapeLuma(),
    scrapeGDG(),
  ]);

  const rawAll = [...devpost, ...unstop, ...mlh, ...devfolio, ...luma, ...gdg];
  console.log(`[ScraperService] Fetched ${rawAll.length} raw scraped hackathon items across all platforms.`);

  const validHackathons = [];
  const todayStr = new Date().toISOString().split("T")[0];
  const todayTime = new Date(todayStr).getTime();

  for (const item of rawAll) {
    if (!item.name || item.name.trim().length < 3 || !item.organizer) continue;

    // 1. Skip past hosted events where deadlines are significantly in the past (> 2 days ago)
    if (item.submissionDeadline) {
      const subTime = new Date(item.submissionDeadline).getTime();
      if (!isNaN(subTime) && subTime < todayTime - 2 * 86400000) {
        continue;
      }
    }

    // 2. Validate URL exists
    const isUrlAlive = await checkUrlExists(item.platformUrl);
    if (!isUrlAlive) {
      console.warn(`[ScraperService] ⚠️ Skipping item "${item.name}" due to 404/invalid URL: ${item.platformUrl}`);
      continue;
    }

    validHackathons.push({
      ...item,
      id: item.platformUrl || `${item.name}-${Date.now()}`,
      scrapedAt: new Date().toISOString(),
    });
  }

  ensureDataDirExists();

  const fileData = {
    updatedAt: new Date().toISOString(),
    totalCount: validHackathons.length,
    status: "pending_admin_approval",
    hackathons: validHackathons,
  };

  fs.writeFileSync(FILE_PATH, JSON.stringify(fileData, null, 2), "utf-8");
  console.log(`[ScraperService] 💾 Saved ${validHackathons.length} valid hackathons to file: ${FILE_PATH}`);

  let mergeResult = null;
  if (options.autoFeedToDb) {
    console.log("[ScraperService] ⚡ Auto-feed requested: merging scraped hackathons into MongoDB immediately...");
    mergeResult = await mergeScrapedFileToDb();
  }

  return {
    success: true,
    totalScraped: validHackathons.length,
    filePath: FILE_PATH,
    timestamp: fileData.updatedAt,
    merged: mergeResult,
  };
}

/**
 * Gets status and pending items from the scraped file
 */
function getScrapedFileStatus() {
  ensureDataDirExists();
  if (!fs.existsSync(FILE_PATH)) {
    return {
      exists: false,
      totalCount: 0,
      updatedAt: null,
      hackathons: [],
    };
  }

  try {
    const content = fs.readFileSync(FILE_PATH, "utf-8");
    const data = JSON.parse(content);
    return {
      exists: true,
      totalCount: data.totalCount || 0,
      updatedAt: data.updatedAt,
      hackathons: data.hackathons || [],
    };
  } catch (err) {
    return {
      exists: false,
      totalCount: 0,
      updatedAt: null,
      hackathons: [],
      error: err.message,
    };
  }
}

/**
 * Admin / Explorer action: Ingests/merges stored hackathons from JSON file into MongoDB
 */
async function mergeScrapedFileToDb() {
  const status = getScrapedFileStatus();
  if (!status.exists || status.hackathons.length === 0) {
    return { success: false, message: "No scraped data available in file to merge." };
  }

  let insertedCount = 0;
  let updatedCount = 0;

  for (const item of status.hackathons) {
    try {
      const existing = await Hackathon.findOne({
        $or: [
          { platformUrl: item.platformUrl },
          { name: item.name, organizer: item.organizer },
        ],
      });

      if (existing) {
        existing.banner = item.banner;
        existing.prizePool = item.prizePool;
        existing.prizePoolUSD = item.prizePoolUSD;
        existing.mode = item.mode;
        existing.level = item.level;
        existing.registrationDeadline = item.registrationDeadline;
        existing.submissionDeadline = item.submissionDeadline;
        existing.resultDate = item.resultDate;
        existing.platform = item.platform;
        existing.platformUrl = item.platformUrl;
        existing.description = item.description;
        existing.tags = Array.from(new Set([...(existing.tags || []), ...(item.tags || [])]));
        await existing.save();
        updatedCount++;
      } else {
        await Hackathon.create({
          name: item.name,
          organizer: item.organizer,
          banner: item.banner,
          prizePool: item.prizePool,
          prizePoolUSD: item.prizePoolUSD,
          mode: item.mode,
          level: item.level,
          registrationDeadline: item.registrationDeadline,
          submissionDeadline: item.submissionDeadline,
          resultDate: item.resultDate,
          teamSize: item.teamSize,
          tags: item.tags,
          platform: item.platform,
          platformUrl: item.platformUrl,
          description: item.description,
          createdBy: "scraped-file-ingest",
        });
        insertedCount++;
      }
    } catch (err) {
      console.error(`[ScraperService] Error ingesting item "${item.name}":`, err.message);
    }
  }

  console.log(`[ScraperService] ✅ Merged ${insertedCount} new and ${updatedCount} updated hackathons into MongoDB!`);
  return {
    success: true,
    insertedCount,
    updatedCount,
    totalProcessed: status.hackathons.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Admin action: Rejects & removes a single scraped item from JSON file
 */
/**
 * Admin action: Clears and removes all scraped items from JSON file
 */
function clearAllScrapedItemsFromFile() {
  ensureDataDirExists();
  const fileData = {
    updatedAt: new Date().toISOString(),
    totalCount: 0,
    status: "cleared_by_admin",
    hackathons: [],
  };

  fs.writeFileSync(FILE_PATH, JSON.stringify(fileData, null, 2), "utf-8");
  return {
    success: true,
    message: "All scraped hackathons have been deleted from storage.",
    totalCount: 0,
  };
}

function rejectScrapedItemFromFile(itemId) {
  const status = getScrapedFileStatus();
  if (!status.exists || !status.hackathons.length) {
    return { success: false, message: "No scraped file data found." };
  }

  const initialCount = status.hackathons.length;
  const updatedList = status.hackathons.filter(
    (h) => h.id !== itemId && h.platformUrl !== itemId
  );

  if (updatedList.length === initialCount) {
    return { success: false, message: "Item not found in scraped file." };
  }

  const fileData = {
    updatedAt: new Date().toISOString(),
    totalCount: updatedList.length,
    status: "pending_admin_approval",
    hackathons: updatedList,
  };

  ensureDataDirExists();
  fs.writeFileSync(FILE_PATH, JSON.stringify(fileData, null, 2), "utf-8");
  return {
    success: true,
    message: "Scraped hackathon rejected and removed from file.",
    totalCount: updatedList.length,
  };
}

module.exports = {
  scrapeHackathonsToFile,
  getScrapedFileStatus,
  mergeScrapedFileToDb,
  rejectScrapedItemFromFile,
  clearAllScrapedItemsFromFile,
  scrapeDevpost,
  scrapeUnstop,
  scrapeMLH,
  scrapeDevfolio,
  scrapeLuma,
  scrapeGDG,
};

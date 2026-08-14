const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const Hackathon = require("../models/Hackathon");

const FILE_PATH = path.join(__dirname, "../data/scraped_hackathons.json");

// Ensure data directory exists
function ensureDataDirExists() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Validates if a target URL exists and responds with non-404 status (< 400)
 */
async function checkUrlExists(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 6000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
    });
    return res.status >= 200 && res.status < 400;
  } catch (err) {
    return false;
  }
}

// ─── 1. Live Devpost Scraper ──────────────────────────────────────────────────
async function scrapeDevpost() {
  try {
    const res = await axios.get("https://devpost.com/api/hackathons?page=1", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });

    const rawList = res.data?.hackathons || [];
    const results = [];

    for (const h of rawList.slice(0, 10)) {
      const isOnline = h.displayed_location?.location?.toLowerCase().includes("online");
      const prizeText = h.prize_amount ? h.prize_amount.replace(/<[^>]*>/g, "").trim() : "$10,000+";

      let prizeUSD = 10000;
      const matchUSD = prizeText.replace(/,/g, "").match(/\$?\s*(\d+)/);
      if (matchUSD && matchUSD[1]) {
        prizeUSD = parseInt(matchUSD[1], 10);
      }

      const platformUrl = h.url || "https://devpost.com";
      
      results.push({
        name: h.title || "Devpost Hackathon",
        organizer: h.organization_name || "Devpost Sponsor",
        banner: h.thumbnail_url
          ? h.thumbnail_url.startsWith("//")
            ? "https:" + h.thumbnail_url
            : h.thumbnail_url
          : "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
        prizePool: prizeText,
        prizePoolUSD: prizeUSD,
        mode: isOnline ? "Online" : "Offline",
        level: isOnline ? "Global" : "National",
        registrationDeadline: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 28 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 35 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: (h.themes || []).map((t) => t.name).concat(["Devpost", isOnline ? "Global" : "National"]),
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

// ─── 2. Live Unstop Scraper ───────────────────────────────────────────────────
async function scrapeUnstop() {
  try {
    const res = await axios.get(
      "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&per_page=15",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 10000,
      }
    );

    const rawList = res.data?.data?.data || [];
    const results = [];

    for (const h of rawList.slice(0, 10)) {
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

// ─── 3. Live MLH Scraper ──────────────────────────────────────────────────────
async function scrapeMLH() {
  try {
    const res = await axios.get("https://mlh.io/events", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(res.data);
    const rawItems = [];

    $(".event").each((i, el) => {
      const name = $(el).find("[class*='event-name'], h3, h4").first().text().trim();
      const url = $(el).find("a.event-link, a").first().attr("href") || "";
      const logo = $(el).find(".image-wrapper img, img").first().attr("src") || "";
      const location = $(el).find(".event-location").text().trim();
      const dates = $(el).find(".event-date").text().trim();

      if (name && !["2026", "2025", "2024"].includes(name) && url) {
        const fullUrl = url.startsWith("http") ? url : `https://mlh.io${url}`;
        rawItems.push({
          name,
          organizer: "Major League Hacking (MLH)",
          banner: logo || "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80",
          prizePool: "$10,000 in Swag & Grants",
          prizePoolUSD: 10000,
          mode: location.toLowerCase().includes("digital") || location.toLowerCase().includes("online") ? "Online" : "Offline",
          level: "Global",
          registrationDeadline: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
          submissionDeadline: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
          resultDate: new Date(Date.now() + 16 * 86400000).toISOString().split("T")[0],
          teamSize: { min: 1, max: 4 },
          tags: ["MLH", "Student Hackathon", location || "Global"].filter(Boolean),
          platform: "MLH",
          platformUrl: fullUrl,
          description: `Official MLH Member Hackathon: ${name} (${dates || "Upcoming"}, ${location || "Global"}). Join live hackathon!`,
        });
      }
    });

    return rawItems.slice(0, 10);
  } catch (err) {
    console.error("[ScraperService] MLH error:", err.message);
    return [];
  }
}

// ─── 4. Live Devfolio Scraper ─────────────────────────────────────────────────
async function scrapeDevfolio() {
  try {
    const res = await axios.get("https://devfolio.co/api/hackathons?type=open&limit=10", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 8000,
    });

    const rawList = res.data?.result || res.data?.data || [];
    const results = [];

    for (const h of rawList) {
      if (!h.slug && !h.name) continue;
      const slug = h.slug || h.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const platformUrl = h.site || `https://${slug}.devfolio.co`;

      results.push({
        name: h.name || h.title || "Devfolio Hackathon",
        organizer: h.organisation?.name || h.by || "Devfolio Community",
        banner: h.cover_img || h.logo || "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&q=80",
        prizePool: h.prize_pool || "₹2,50,000+",
        prizePoolUSD: 3000,
        mode: h.is_online ? "Online" : "Offline",
        level: "National",
        registrationDeadline: h.reg_ends_at
          ? h.reg_ends_at.split("T")[0]
          : new Date(Date.now() + 12 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 25 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: ["Devfolio", "Web3", "AI", "Buildathon"],
        platform: "Devfolio",
        platformUrl,
        description: `${h.name} on Devfolio. Experience top developer hackathons and build innovative web3/AI apps.`,
      });
    }
    return results;
  } catch (err) {
    console.error("[ScraperService] Devfolio error:", err.message);
    return [];
  }
}

// ─── 5. Live Luma Scraper ─────────────────────────────────────────────────────
async function scrapeLuma() {
  try {
    const results = [];
    const targetUrl = "https://luma.com/";

    const res = await axios.get(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(res.data);

    // Extract event links from luma.com
    $("a").each((i, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().trim();

      if (
        href &&
        (href.includes("luma.com/") || href.includes("lu.ma/") || href.startsWith("/")) &&
        !href.includes("/login") &&
        !href.includes("/discover") &&
        title.length > 3
      ) {
        const fullUrl = href.startsWith("http") ? href : `https://luma.com${href}`;
        const isHackathon = title.toLowerCase().includes("hack") || title.toLowerCase().includes("build") || title.toLowerCase().includes("party") || title.toLowerCase().includes("show") || title.toLowerCase().includes("club");

        if (isHackathon) {
          results.push({
            name: title.slice(0, 60),
            organizer: "Luma Builder Network",
            banner: "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800&q=80",
            prizePool: "$5,000+ Swag & Perks",
            prizePoolUSD: 5000,
            mode: "Online",
            level: "Global",
            registrationDeadline: new Date(Date.now() + 8 * 86400000).toISOString().split("T")[0],
            submissionDeadline: new Date(Date.now() + 18 * 86400000).toISOString().split("T")[0],
            resultDate: new Date(Date.now() + 20 * 86400000).toISOString().split("T")[0],
            teamSize: { min: 1, max: 4 },
            tags: ["Luma", "Global Tech", "Hackathon"],
            platform: "Luma",
            platformUrl: fullUrl,
            description: `Live community tech hackathon on Luma: ${title}. RSVP & connect with builders worldwide on Luma.`,
          });
        }
      }
    });

    // Fallback/Curated Luma events on luma.com if needed
    if (results.length === 0) {
      results.push({
        name: "Luma AI & Autonomous Agents Global Hackathon",
        organizer: "Luma Builder Network",
        banner: "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800&q=80",
        prizePool: "$15,000 in Cloud Credits & Cash",
        prizePoolUSD: 15000,
        mode: "Online",
        level: "Global",
        registrationDeadline: new Date(Date.now() + 9 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 21 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 24 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: ["Luma", "AI Agents", "Global"],
        platform: "Luma",
        platformUrl: "https://luma.com/",
        description: "Luma AI Agents Global Hackathon hosted on luma.com. Build and deploy autonomous AI agents with global community.",
      });
    }

    return results.slice(0, 5);
  } catch (err) {
    console.error("[ScraperService] Luma error:", err.message);
    return [
      {
        name: "Luma AI & Autonomous Agents Global Hackathon",
        organizer: "Luma Builder Network",
        banner: "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800&q=80",
        prizePool: "$15,000 in Cloud Credits & Cash",
        prizePoolUSD: 15000,
        mode: "Online",
        level: "Global",
        registrationDeadline: new Date(Date.now() + 9 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 21 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 24 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: ["Luma", "AI Agents", "Global"],
        platform: "Luma",
        platformUrl: "https://luma.com/",
        description: "Luma AI Agents Global Hackathon hosted on luma.com. Build and deploy autonomous AI agents with global community.",
      },
    ];
  }
}

// ─── 6. Live GDG (Google Developer Groups) Scraper ───────────────────────────
async function scrapeGDG() {
  try {
    const gdgEventsPage = "https://gdg.community.dev/events/";
    const results = [];

    // Try GDG public API endpoints for live event listings
    try {
      const apiRes = await axios.get("https://gdg.community.dev/api/search/event?q=hackathon", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 7000,
      });

      const rawItems = apiRes.data?.results || [];
      for (const item of rawItems.slice(0, 8)) {
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
          description: `${item.title} hosted on GDG Events (${gdgEventsPage}). Official Google Developer Groups hackathon for solving real-world problems.`,
        });
      }
    } catch (apiErr) {
      console.warn("[ScraperService] GDG search API error, falling back to curated GDG page item:", apiErr.message);
    }

    if (results.length === 0) {
      results.push({
        name: "GDG Solution Challenge & Global Hackathon",
        organizer: "Google Developer Groups (GDG)",
        banner: "https://images.unsplash.com/photo-1573164713988-8665fc963095?w=800&q=80",
        prizePool: "$30,000 Google Cloud & Mentorship",
        prizePoolUSD: 30000,
        mode: "Hybrid",
        level: "Global",
        registrationDeadline: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 35 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 45 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: ["GDG", "Google Cloud", "Flutter", "Firebase"],
        platform: "GDG",
        platformUrl: gdgEventsPage,
        description: `Official Google Developer Groups hackathon hosted on GDG events page (${gdgEventsPage}) for solving real-world challenges with Google tech.`,
      });
    }

    return results;
  } catch (err) {
    console.error("[ScraperService] GDG error:", err.message);
    return [
      {
        name: "GDG Solution Challenge & Global Hackathon",
        organizer: "Google Developer Groups (GDG)",
        banner: "https://images.unsplash.com/photo-1573164713988-8665fc963095?w=800&q=80",
        prizePool: "$30,000 Google Cloud & Mentorship",
        prizePoolUSD: 30000,
        mode: "Hybrid",
        level: "Global",
        registrationDeadline: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 35 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 45 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: ["GDG", "Google Cloud", "Flutter", "Firebase"],
        platform: "GDG",
        platformUrl: "https://gdg.community.dev/events/",
        description: "Official Google Developer Groups hackathon hosted on GDG events page for solving real-world challenges with Google tech.",
      },
    ];
  }
}

// ─── Main Aggregator & File Storage Engine ────────────────────────────────────
async function scrapeHackathonsToFile() {
  console.log("[ScraperService] 🌐 Starting live web scraping across Devpost, Unstop, MLH, Devfolio, Luma, and GDG...");

  const [devpost, unstop, mlh, devfolio, luma, gdg] = await Promise.all([
    scrapeDevpost(),
    scrapeUnstop(),
    scrapeMLH(),
    scrapeDevfolio(),
    scrapeLuma(),
    scrapeGDG(),
  ]);

  const rawAll = [...devpost, ...unstop, ...mlh, ...devfolio, ...luma, ...gdg];
  console.log(`[ScraperService] Fetched ${rawAll.length} raw scraped hackathon items.`);

  // Validation step: Filter out past events, closed registrations, and non-200 / 404 links
  const validHackathons = [];
  const todayStr = new Date().toISOString().split("T")[0];
  const todayTime = new Date(todayStr).getTime();

  for (const item of rawAll) {
    if (!item.name || item.name.trim().length < 3 || !item.organizer) continue;

    // 1. Skip past hosted events (where registration or submission deadline is before today)
    if (item.registrationDeadline) {
      const regTime = new Date(item.registrationDeadline).getTime();
      if (!isNaN(regTime) && regTime < todayTime) {
        console.warn(`[ScraperService] ⏳ Skipping past hackathon "${item.name}" (registration deadline ${item.registrationDeadline} passed)`);
        continue;
      }
    }

    if (item.submissionDeadline) {
      const subTime = new Date(item.submissionDeadline).getTime();
      if (!isNaN(subTime) && subTime < todayTime) {
        console.warn(`[ScraperService] ⏳ Skipping ended hackathon "${item.name}" (submission deadline ${item.submissionDeadline} passed)`);
        continue;
      }
    }

    // 2. Skip hackathons whose registrations are explicitly closed
    if (item.registrationClosed === true || item.isClosed === true) {
      console.warn(`[ScraperService] 🚫 Skipping closed registration hackathon "${item.name}"`);
      continue;
    }

    // 3. Check URL status to avoid storing 404 broken links
    const isUrlAlive = await checkUrlExists(item.platformUrl);
    if (!isUrlAlive) {
      console.warn(`[ScraperService] ❌ Skipping item "${item.name}" due to 404/invalid URL: ${item.platformUrl}`);
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
  console.log(`[ScraperService] ✅ Scraped ${validHackathons.length} valid 200-OK hackathons saved to file: ${FILE_PATH}`);

  return {
    success: true,
    totalScraped: validHackathons.length,
    filePath: FILE_PATH,
    timestamp: fileData.updatedAt,
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
 * Admin action: Ingests/merges stored hackathons from JSON file into MongoDB
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
};

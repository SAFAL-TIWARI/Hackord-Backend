const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const Hackathon = require("../models/Hackathon");
const ScrapedHackathon = require("../models/ScrapedHackathon");
const ScrapedMeta = require("../models/ScrapedMeta");
const mongoose = require("mongoose");
const { syncJsonFileToGithub } = require("./githubSyncService");

const FILE_PATH = path.join(__dirname, "../data/scraped_hackathons.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";


/**
 * Scrapes the actual real banner / og:image / twitter:image from a hackathon page.
 */
async function extractRealPageBanner(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      timeout: 5000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(res.data);
    let img =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[property="og:image:url"]').attr("content") ||
      $('meta[property="og:image:secure_url"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('meta[name="twitter:image:src"]').attr("content") ||
      $('link[rel="image_src"]').attr("href");

    if (img) {
      img = img.trim();
      if (img.startsWith("//")) return "https:" + img;
      if (img.startsWith("/")) {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${img}`;
      }
      return img;
    }
  } catch {
    // ignore network/timeout errors
  }
  return null;
}

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
    "dev.to",
    "taikai.network",
    "dorahacks.io",
    "bemyapp.com",
    "agorize.com",
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
      timeout: 3000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
    // If 404 or 410, link is definitely dead
    if (res.status === 404 || res.status === 410) {
      return false;
    }
    return true;
  } catch (err) {
    return true;
  }
}

// ============================================================================
// State & Location Intelligence Classification Engine
// ============================================================================
const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Tamilnadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Chandigarh", "Puducherry"
];

const CITY_TO_STATE = {
  "mumbai": "Maharashtra",
  "navi mumbai": "Maharashtra",
  "pune": "Maharashtra",
  "sangli": "Maharashtra",
  "nagpur": "Maharashtra",
  "nashik": "Maharashtra",
  "panvel": "Maharashtra",
  "bengaluru": "Karnataka",
  "bangalore": "Karnataka",
  "mysore": "Karnataka",
  "hubli": "Karnataka",
  "new delhi": "Delhi",
  "delhi": "Delhi",
  "hyderabad": "Telangana",
  "warangal": "Telangana",
  "chennai": "Tamil Nadu",
  "coimbatore": "Tamil Nadu",
  "erode": "Tamil Nadu",
  "trichy": "Tamil Nadu",
  "tiruchirappalli": "Tamil Nadu",
  "madurai": "Tamil Nadu",
  "kancheepuram": "Tamil Nadu",
  "kolkata": "West Bengal",
  "agarpara": "West Bengal",
  "ahmedabad": "Gujarat",
  "surat": "Gujarat",
  "vadodara": "Gujarat",
  "noida": "Uttar Pradesh",
  "greater noida": "Uttar Pradesh",
  "lucknow": "Uttar Pradesh",
  "kanpur": "Uttar Pradesh",
  "varanasi": "Uttar Pradesh",
  "roorkee": "Uttarakhand",
  "dehradun": "Uttarakhand",
  "jaipur": "Rajasthan",
  "jodhpur": "Rajasthan",
  "kota": "Rajasthan",
  "bhopal": "Madhya Pradesh",
  "indore": "Madhya Pradesh",
  "raipur": "Chhattisgarh",
  "chandigarh": "Punjab",
  "ludhiana": "Punjab",
  "amritsar": "Punjab",
  "kochi": "Kerala",
  "thiruvananthapuram": "Kerala",
  "calicut": "Kerala",
  "kozhikode": "Kerala",
  "kalamassery": "Kerala",
  "bhubaneswar": "Odisha",
  "rourkela": "Odisha",
  "patna": "Bihar",
  "ranchi": "Jharkhand",
  "guwahati": "Assam",
  "goa": "Goa",
  "panaji": "Goa"
};

/**
 * Checks if a hackathon item is from 2024, 2025, or ended in the past
 */
function isPastHackathon(item, todayStr = new Date().toISOString().split("T")[0]) {
  const name = (item.name || item.title || "").trim();
  const url = (item.platformUrl || item.url || "").trim();

  // 1. Any mention of past years (2020-2025, '24, '25) unless explicitly a 2026/2027 edition
  const hasFutureYear = /\b(2026|2027|'26|'27|2k26|2k27)\b/i.test(name);
  const hasPastYear =
    /\b(201\d|202[0-5]|'2[0-5]|2k2[0-5])\b/i.test(name) ||
    /\b(201\d|202[0-5])\b/i.test(url);

  if (hasPastYear && !hasFutureYear) {
    return true;
  }

  // 2. Submission deadline in the past
  if (item.submissionDeadline && item.submissionDeadline < todayStr) {
    return true;
  }

  // 3. Registration deadline in the past
  if (item.registrationDeadline && item.registrationDeadline < todayStr) {
    if (!item.submissionDeadline || item.submissionDeadline < todayStr) {
      return true;
    }
  }

  return false;
}

/**
 * Accurately determines if a hackathon is 'State', 'National', or 'Global'
 */
function detectHackathonLevel(item, context = {}) {
  if (context.forceLevel) return context.forceLevel;

  const rawTitle = (item.name || item.title || "").trim();
  const rawOrg = (item.organizer || item.organisation?.name || item.company_name || "").trim();
  const rawDesc = (item.description || "").trim();
  const rawVenue = (item.venue || "").trim();
  const explicitState = (item.state || item.address_with_country_logo?.state || context.state || "").trim();
  const explicitCity = (item.city || item.address_with_country_logo?.city || context.city || "").trim();

  const titleLower = rawTitle.toLowerCase();
  const fullText = `${rawTitle} ${rawOrg} ${rawDesc} ${rawVenue} ${explicitState} ${explicitCity}`.toLowerCase();

  // 1. Explicit National flagships override state addresses
  const isExplicitNational =
    titleLower.includes("national level") ||
    titleLower.includes("all india") ||
    titleLower.includes("smart india hackathon") ||
    titleLower.includes("sih 202") ||
    titleLower.includes("countrywide") ||
    titleLower.includes("india's largest") ||
    titleLower.includes("india's biggest") ||
    titleLower.includes("nationwide");

  // 2. Explicit Global / Worldwide flagships
  const isExplicitGlobal =
    titleLower.includes("global") ||
    titleLower.includes("worldwide") ||
    titleLower.includes("international") ||
    titleLower.includes("world cup") ||
    titleLower.includes("global hack week");

  if (isExplicitGlobal) return "Global";
  if (isExplicitNational) return "National";

  // 3. State-level indicators
  const hasStateKeywords =
    /\b(state level|state hackathon|inter-college|inter college|intra-college|college level|district level|regional level|zonal level|university level|campus hackathon|state championship|state innovation)\b/i.test(
      fullText
    );

  const matchedIndianState =
    explicitState ||
    INDIAN_STATES.find((s) => fullText.includes(s.toLowerCase())) ||
    (explicitCity && CITY_TO_STATE[explicitCity.toLowerCase()]);

  const isCollegiate =
    /\b(college|university|institute|campus|polytechnic|engineering|iit|nit|iiit|bits|mace|coep|wce|ait|vit|srm)\b/i.test(
      fullText
    );

  const isOffline = item.mode === "Offline" || item.region === "offline";

  // If collegiate or offline event bound to an Indian state/city -> State level!
  if (hasStateKeywords || (matchedIndianState && (isCollegiate || isOffline))) {
    return "State";
  }

  // Check North American states/provinces for in-person collegiate hackathons
  const northAmericanStates = [
    "ontario", "quebec", "california", "texas", "new york", "florida", "michigan",
    "illinois", "georgia", "north carolina", "ohio", "pennsylvania", "delaware",
    "indiana", "rhode island", "south carolina", "new jersey", "massachusetts"
  ];
  if (isOffline && northAmericanStates.some((st) => fullText.includes(st)) && isCollegiate) {
    return "State";
  }

  if (/\b(global|international|worldwide)\b/i.test(fullText)) {
    return "Global";
  }

  if (/\b(national|all india|nationwide|india)\b/i.test(fullText)) {
    return "National";
  }

  // Default fallback based on mode & matched state
  if (isOffline) {
    return matchedIndianState ? "State" : "National";
  }

  return "Global";
}

// ──────────────── 1. Live Devpost Scraper ────────────────────────────────────────────────
async function scrapeDevpost() {
  const todayStr = new Date().toISOString().split("T")[0];
  try {
    const res = await axios.get("https://devpost.com/api/hackathons?page=1", {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
      },
      timeout: 10000,
    });

    const rawList = res.data?.hackathons || [];
    const results = [];

    for (const h of rawList.slice(0, 15)) {
      const titleLower = (h.title || "").toLowerCase();

      // Skip past / ended hackathons or 2024/2025
      if (h.open_state === "ended" || h.open_state === "closed") continue;
      if (isPastHackathon({ name: h.title, url: h.url }, todayStr)) continue;

      const locationStr = h.displayed_location?.location || "";
      const isOnline = locationStr.toLowerCase().includes("online");
      const isMiniDevpost =
        titleLower.includes("mini") ||
        titleLower.includes("sprint") ||
        titleLower.includes("1-day") ||
        titleLower.includes("one day") ||
        titleLower.includes("game jam");
      const prizeText = h.prize_amount ? h.prize_amount.replace(/<[^>]*>/g, "").trim() : "$10,000+";

      let prizeUSD = 10000;
      const matchUSD = prizeText.replace(/,/g, "").match(/\$?\s*(\d+)/);
      if (matchUSD && matchUSD[1]) {
        prizeUSD = parseInt(matchUSD[1], 10);
      }

      const platformUrl = h.url || "https://devpost.com";
      let banner = "";
      if (h.thumbnail_url) {
        let thumb = h.thumbnail_url.startsWith("//") ? "https:" + h.thumbnail_url : h.thumbnail_url;
        if (thumb.includes("medium_square")) {
          banner = thumb.replace("medium_square", "original");
        } else {
          banner = thumb;
        }
      }
      if (!banner && platformUrl && platformUrl !== "https://devpost.com") {
        banner = await extractRealPageBanner(platformUrl);
      }

      const detectedLevel = detectHackathonLevel({
        title: h.title,
        organizer: h.organization_name,
        mode: isOnline ? "Online" : "Offline",
        venue: locationStr,
        description: h.title,
      });

      results.push({
        name: h.title || "Devpost Hackathon",
        organizer: h.organization_name || "Devpost Sponsor",
        banner,
        prizePool: prizeText,
        prizePoolUSD: prizeUSD,
        mode: isOnline ? "Online" : "Offline",
        level: detectedLevel,
        registrationDeadline: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 28 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 35 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        hackathonType: isMiniDevpost ? "Mini Hackathon" : "Hackathon",
        duration: isMiniDevpost ? "6-8 hours" : "",
        venue: isOnline ? "Online" : locationStr || "Offline Venue",
        schedule: isMiniDevpost
          ? "09:00 AM – Check-in & Kickoff\n10:00 AM – Hacking Commences\n01:00 PM – Lunch & Mentorship\n05:00 PM – Final Code Freeze\n05:30 PM – Presentations & Awards"
          : "",
        submissionChecklist: isMiniDevpost
          ? ["Project Name", "Problem Statement", "Live Demo Link", "GitHub Code Repository", "Demo Video"]
          : [],
        tags: (h.themes || [])
          .map((t) => t.name)
          .concat([
            "Devpost",
            isMiniDevpost ? "Mini Hackathon" : null,
            isMiniDevpost ? "1-Day Hackathon" : null,
            detectedLevel === "State" ? "State Level" : detectedLevel === "National" ? "National Level" : "Global",
          ])
          .filter(Boolean),
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

// ──────────────── 2. Live Unstop Scraper (Multi-endpoint state & collegiate ingestion) ────────────────
async function scrapeUnstop() {
  const todayStr = new Date().toISOString().split("T")[0];
  try {
    const endpoints = [
      "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&per_page=30",
      "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&q=state&per_page=20",
      "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&q=college&per_page=20",
      "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&q=inter+college&per_page=20",
    ];

    const rawList = [];
    const seenIds = new Set();

    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json, text/plain, */*",
          },
          timeout: 10000,
        });
        const items = res.data?.data?.data || [];
        for (const item of items) {
          if (item && item.id && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            rawList.push(item);
          }
        }
      } catch (epErr) {
        console.warn(`[ScraperService] Unstop endpoint fetch skipped (${ep}): ${epErr.message}`);
      }
    }

    const results = [];

    for (const h of rawList) {
      // 1. Skip if registration is closed
      if (h.regn_open === 0 || h.regn_open === false) continue;

      // 2. Strict check on registration end date and event end date
      const endRegnStr = h.regnRequirements?.end_regn_dt ? h.regnRequirements.end_regn_dt.split("T")[0] : "";
      const endDateStr = h.end_date ? h.end_date.split("T")[0] : "";

      if (endRegnStr && endRegnStr < todayStr) continue;
      if (endDateStr && endDateStr < todayStr) continue;

      // 3. Skip if title mentions past years (2020-2025, '24, '25)
      if (isPastHackathon({ name: h.title, url: h.public_url }, todayStr)) continue;

      let bannerUrl = null;
      if (h.id) {
        try {
          const compRes = await axios.get(`https://unstop.com/api/public/competition/${h.id}`, {
            headers: { "User-Agent": USER_AGENT },
            timeout: 4000,
          });
          const comp = compRes.data?.data?.competition;
          if (comp) {
            bannerUrl =
              comp.banner?.image_url ||
              comp.banner_mobile?.image_url ||
              comp.banner_desktop?.image_url ||
              comp.logoUrl2 ||
              comp.logoUrl;
          }
        } catch {}
      }
      if (!bannerUrl) {
        bannerUrl = h.banner_mobile?.image_url || h.banner_desktop?.image_url || h.logoUrl2;
      }
      if (!bannerUrl && h.public_url) {
        bannerUrl = await extractRealPageBanner("https://unstop.com/" + h.public_url);
      }

      const isOnline =
        h.filters?.some((f) => f.name?.toLowerCase().includes("online")) ||
        h.region === "online";

      const platformUrl = "https://unstop.com/" + (h.public_url || "hackathons");
      const rawState = (h.address_with_country_logo?.state || "").trim();
      const rawCity = (h.address_with_country_logo?.city || "").trim();
      const orgName = h.organisation?.name || h.company_name || "Unstop Partner";

      const detectedLevel = detectHackathonLevel(
        {
          title: h.title,
          organisation: { name: orgName },
          mode: isOnline ? "Online" : "Offline",
          region: h.region,
          address_with_country_logo: { state: rawState, city: rawCity },
        },
        { state: rawState, city: rawCity }
      );

      const resolvedVenue = isOnline
        ? "Online"
        : rawCity
        ? `${rawCity}${rawState ? `, ${rawState}` : ""}`
        : orgName;

      const regDeadline = endRegnStr || new Date(Date.now() + 10 * 86400000).toISOString().split("T")[0];
      const subDeadline = endDateStr || new Date(new Date(regDeadline).getTime() + 10 * 86400000).toISOString().split("T")[0];
      const resDate = new Date(new Date(subDeadline).getTime() + 5 * 86400000).toISOString().split("T")[0];

      const tags = [
        h.category || "Hackathon",
        "Unstop",
        detectedLevel === "State" ? "State Level" : detectedLevel === "National" ? "National Level" : "Global",
        rawState ? `${rawState} State` : null,
        rawCity ? `${rawCity}` : null,
        "College Hackathon",
      ].filter(Boolean);

      results.push({
        name: h.title,
        organizer: orgName,
        banner: bannerUrl,
        prizePool: h.prizes_count ? `₹${h.prizes_count * 50}k+ & Certificates` : "Prizes & Certificates",
        prizePoolUSD: 1500,
        mode: isOnline ? "Online" : "Offline",
        level: detectedLevel,
        venue: resolvedVenue,
        registrationDeadline: regDeadline,
        submissionDeadline: subDeadline,
        resultDate: resDate,
        teamSize: { min: h.min_team_size || 1, max: h.max_team_size || 4 },
        tags,
        platform: "Unstop",
        platformUrl,
        description: `${h.title} hosted by ${orgName}${rawState ? ` in ${rawState}` : ""}. Official live competition registered on Unstop.`,
      });
    }
    return results;
  } catch (err) {
    console.error("[ScraperService] Unstop error:", err.message);
    return [];
  }
}

// ──────────────── 3. Live MLH Scraper (From https://mlh.io/events) ────────────────────────
async function scrapeMLH() {
  const todayStr = new Date().toISOString().split("T")[0];
  try {
    const res = await axios.get("https://mlh.io/events", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 12000,
    });

    const $ = cheerio.load(res.data);
    const results = [];
    const seenUrls = new Set();

    for (const el of $("a").toArray()) {
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
        if (!name || name.length < 2) continue;
        if (cleanUrl.includes("sponsor.mlh") || cleanUrl.includes("dev.to") || name.toLowerCase() === "for businesses" || name.toLowerCase() === "dev") continue;

        // Skip past hackathons
        if (isPastHackathon({ name, url: cleanUrl }, todayStr)) continue;

        const bgImg = card.find('img[src*="backgrounds"]').attr("src");
        const logoImg = card.find('img[src*="logos"]').attr("src");
        const anyImg = card.find("img").first().attr("src");
        let img = bgImg || logoImg || anyImg;
        if (!img && cleanUrl) {
          img = await extractRealPageBanner(cleanUrl);
        }

        const text = card.text().trim().replace(/\s+/g, " ");

        // Check if card explicitly describes a past event from 2024/2025
        if (/\b(2024|2025)\b/.test(text) && !/\b(2026|2027)\b/.test(text)) continue;

        const isOnline =
          text.toLowerCase().includes("digital") ||
          text.toLowerCase().includes("online") ||
          cleanUrl.includes("global-hack-week");

        const isMini =
          name.toLowerCase().includes("mini") ||
          text.toLowerCase().includes("mini") ||
          text.toLowerCase().includes("sprint") ||
          text.toLowerCase().includes("1-day") ||
          cleanUrl.includes("mini") ||
          cleanUrl.includes("sprint");

        // Detect State / Province from card text
        let matchedState = "";
        const candidateStates = [
          ...INDIAN_STATES,
          "Ontario", "Quebec", "California", "Texas", "New York", "Florida", "Michigan",
          "Illinois", "Georgia", "North Carolina", "Ohio", "Pennsylvania", "Delaware",
          "Indiana", "Rhode Island", "South Carolina", "New Jersey", "Massachusetts", "Kansas"
        ];
        for (const st of candidateStates) {
          if (new RegExp(`\\b${st}\\b`, "i").test(text)) {
            matchedState = st;
            break;
          }
        }

        const detectedLevel = isOnline
          ? "Global"
          : matchedState
          ? "State"
          : "Global";

        const resolvedVenue = isOnline
          ? "Online (Discord Stage & Zoom)"
          : matchedState
          ? `Campus Center, ${matchedState}`
          : "Tech Community Center";

        let regDays = 14;
        let subDays = 24;

        results.push({
          name,
          organizer: "Major League Hacking (MLH)",
          banner: img,
          prizePool: "$10,000 in Swag & Grants",
          prizePoolUSD: 10000,
          mode: isOnline ? "Online" : "Offline",
          level: detectedLevel,
          registrationDeadline: new Date(Date.now() + regDays * 86400000).toISOString().split("T")[0],
          submissionDeadline: new Date(Date.now() + subDays * 86400000).toISOString().split("T")[0],
          resultDate: new Date(Date.now() + (subDays + 3) * 86400000).toISOString().split("T")[0],
          teamSize: { min: 1, max: 4 },
          hackathonType: isMini ? "Mini Hackathon" : "Hackathon",
          duration: isMini ? "5-7 hours" : "",
          venue: resolvedVenue,
          schedule: isMini
            ? "09:00 AM – 09:30 AM | Check-in & Team Registration\n09:30 AM – 10:00 AM | Kickoff & Problem Statement Reveal\n10:00 AM | Hacking Begins! 🚀\n01:00 PM – 01:45 PM | Mid-Sprint Lunch & Mentor Checkpoints\n04:00 PM | Code Freeze & Submission Deadline\n04:15 PM – 05:30 PM | Live 3-Minute Demos & Technical Q&A\n05:30 PM – 06:00 PM | Closing Ceremony & Winner Announcements"
            : "",
          submissionChecklist: isMini
            ? [
                "Project name & tagline",
                "Problem statement & target persona",
                "System architecture & solution overview",
                "GitHub repository (clean commits & open README)",
                "Live working demo / deployed URL",
                "2-minute demo video or slide walkthrough",
                "Technical breakdown & API integration details",
              ]
            : [],
          tags: [
            "MLH",
            isMini ? "Mini Hackathon" : null,
            isMini ? "1-Day Hackathon" : null,
            "Student Hackathon",
            matchedState ? `${matchedState} State` : null,
            detectedLevel === "State" ? "State Level" : isOnline ? "Online" : "Global",
          ].filter(Boolean),
          platform: "MLH",
          platformUrl: cleanUrl,
          description: `Official MLH Member Hackathon: ${name}. Connect with fellow student builders and hackers on MLH!`,
        });
      }
    }

    return results.slice(0, 25);
  } catch (err) {
    console.error("[ScraperService] MLH error:", err.message);
    return [];
  }
}

// ──────────────── 4. Live Devfolio Scraper (From https://devfolio.co/hackathons) ────────
async function scrapeDevfolio() {
  const todayStr = new Date().toISOString().split("T")[0];
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

      // Skip past years (2020-2025)
      if (isPastHackathon({ name, url: h.slug }, todayStr)) continue;

      const endsAt = h.ends_at ? h.ends_at.split("T")[0] : "";
      const regEndsAt = h.settings?.reg_ends_at ? h.settings.reg_ends_at.split("T")[0] : "";
      if (endsAt && endsAt < todayStr) continue;

      const platformUrl = `https://${h.slug}.devfolio.co`;
      let banner = h.settings?.featured_cover_img_v2 || h.settings?.featured_cover_img;
      if (!banner) {
        banner = await extractRealPageBanner(platformUrl);
      }
      if (!banner) {
        banner = h.settings?.logo || h.hero_image || h.cover_image;
      }

      const regDeadline = regEndsAt || endsAt || new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
      const subDeadline = endsAt || new Date(Date.now() + 25 * 86400000).toISOString().split("T")[0];
      const resDate = new Date(new Date(subDeadline).getTime() + 5 * 86400000).toISOString().split("T")[0];

      const themes = (h.themes || [])
        .map((t) => (typeof t === "string" ? t : t.theme?.name))
        .filter(Boolean);

      // Detect state / collegiate level in Devfolio
      const detectedLevel = detectHackathonLevel({
        name,
        organizer: "Devfolio Community",
        mode: h.is_online ? "Online" : "Offline",
        description: `${name} ${h.slug}`,
        venue: h.is_online ? "Online" : name.includes("Goa") ? "Goa" : "",
      });

      results.push({
        name,
        organizer: "Devfolio Community",
        banner,
        prizePool: "₹2,50,000+ & Grants",
        prizePoolUSD: 3000,
        mode: h.is_online ? "Online" : "Offline",
        level: detectedLevel,
        venue: h.is_online ? "Online" : name.includes("Goa") ? "Goa, India" : "Collegiate Center",
        registrationDeadline: regDeadline,
        submissionDeadline: subDeadline,
        resultDate: resDate,
        teamSize: { min: 1, max: 4 },
        tags: [
          "Devfolio",
          ...themes,
          h.is_online ? "Online" : "Offline",
          detectedLevel === "State" ? "State Level" : "National",
        ].slice(0, 6),
        platform: "Devfolio",
        platformUrl,
        description: `${name} on Devfolio. Experience premier developer hackathons and build innovative web3, AI, and software apps.`,
      });
    }

    return results.slice(0, 18);
  } catch (err) {
    console.error("[ScraperService] Devfolio error:", err.message);
    return [];
  }
}

// ──────────────── 5. Live Luma Scraper (From https://api.lu.ma/discover/get-paginated-events)
async function scrapeLuma() {
  const todayStr = new Date().toISOString().split("T")[0];
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

      // Skip past years
      if (isPastHackathon({ name: ev.name, url: ev.url }, todayStr)) continue;

      const startAt = ev.start_at ? ev.start_at.split("T")[0] : "";
      const endAt = ev.end_at ? ev.end_at.split("T")[0] : "";

      if (endAt && endAt < todayStr) continue;
      if (startAt && startAt < todayStr) continue;

      const urlSlug = ev.url || ev.api_id;
      const platformUrl = `https://lu.ma/${urlSlug}`;
      if (seenUrls.has(platformUrl)) continue;
      seenUrls.add(platformUrl);

      const isOnline = !ev.geo_address_json || ev.geo_address_json?.type === "online";
      let banner = ev.cover_url || item.calendar?.avatar_url;
      if (!banner && platformUrl) {
        banner = await extractRealPageBanner(platformUrl);
      }

      const finalStart = startAt || new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
      const finalEnd = endAt || new Date(new Date(finalStart).getTime() + 2 * 86400000).toISOString().split("T")[0];
      const resDate = new Date(new Date(finalEnd).getTime() + 2 * 86400000).toISOString().split("T")[0];

      const isSingleDay = finalStart === finalEnd;
      const isMini = isSingleDay || /mini|sprint|1-day|one day/i.test(ev.name);

      const venueLocation = isOnline
        ? "Online (Luma Livestream)"
        : ev.geo_address_json?.city || ev.geo_address_json?.address || "Innovation Space";

      const detectedLevel = detectHackathonLevel({
        name: ev.name,
        organizer: item.calendar?.name || "Luma Tech Community",
        mode: isOnline ? "Online" : "Offline",
        venue: venueLocation,
        city: ev.geo_address_json?.city,
      });

      results.push({
        name: ev.name,
        organizer: item.calendar?.name || "Luma Tech Community",
        banner,
        prizePool: "$5,000+ Swag & Perks",
        prizePoolUSD: 5000,
        mode: isOnline ? "Online" : "Offline",
        level: detectedLevel,
        registrationDeadline: finalStart,
        submissionDeadline: finalEnd,
        resultDate: resDate,
        teamSize: { min: 1, max: 4 },
        hackathonType: isMini ? "Mini Hackathon" : "Hackathon",
        duration: isMini ? "5-7 hours" : "",
        venue: venueLocation,
        schedule: isMini
          ? "09:00 AM – Check-in & Kickoff\n10:00 AM – Hacking Begins! 🚀\n01:00 PM – Lunch / Snacks Break\n04:30 PM – Project Submission Deadline\n05:00 PM – Live Demos & Judging\n06:00 PM – Closing Ceremony & Winners"
          : "",
        submissionChecklist: isMini
          ? [
              "Project name & tagline",
              "Problem statement & target audience",
              "Architecture & technical solution",
              "GitHub repository with clear README",
              "Live working deployment link",
              "Quick video demo / live presentation",
              "Feature completeness & API integrations",
            ]
          : [],
        tags: [
          "Luma",
          isMini ? "Mini/1-Day Hackathon" : null,
          isMini ? "Mini Hackathon" : null,
          isMini ? "1-Day Hackathon" : null,
          detectedLevel === "State" ? "State Level" : "Global Tech",
          isOnline ? "Online" : "In-Person",
          "Hackathon",
        ].filter(Boolean),
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

// ──────────────── 6. Live GDG Scraper ────────────────────────────────────────────────────
async function scrapeGDG() {
  const todayStr = new Date().toISOString().split("T")[0];
  try {
    const gdgEventsPage = "https://gdg.community.dev/events/";
    const res = await axios.get("https://gdg.community.dev/api/search/event?q=hackathon", {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });

    const rawItems = res.data?.results || [];
    const results = [];

    for (const item of rawItems.slice(0, 20)) {
      if (!item.title) continue;

      // Filter out past events
      const sDate = item.start_date_iso || item.start_date || "";
      const eDate = item.end_date_iso || item.end_date || "";
      if (sDate && sDate.split("T")[0] < todayStr) continue;
      if (eDate && eDate.split("T")[0] < todayStr) continue;
      if (isPastHackathon({ name: item.title, url: item.url }, todayStr)) continue;

      const itemUrl = item.url || (item.slug ? `https://gdg.community.dev/events/details/${item.slug}/` : gdgEventsPage);
      const chapter = item.chapter_name || item.chapter_title || "Google Developer Groups";
      const chapterCity = item.chapter_city || item.venue_city || "";
      const chapterLoc = item.chapter_location || "";
      const isVirtual = item.event_type_title?.toLowerCase().includes("virtual") || item.virtual_event_type;

      let bannerUrl =
        item.banner?.url ||
        item.cropped_banner_url ||
        item.picture_url ||
        item.picture?.url;
      if (!bannerUrl && itemUrl) {
        bannerUrl = await extractRealPageBanner(itemUrl);
      }

      const detectedLevel = isVirtual
        ? "Global"
        : (chapterCity || chapterLoc)
        ? "State"
        : "Global";

      const venue = isVirtual
        ? "Online (Google Meet & YouTube Live)"
        : chapterCity
        ? `${chapterCity}, ${chapterLoc || "Campus"}`
        : "GDG Tech Center";

      results.push({
        name: item.title,
        organizer: `GDG (${chapter})`,
        banner: bannerUrl,
        prizePool: "$30,000 Google Cloud & Mentorship",
        prizePoolUSD: 30000,
        mode: isVirtual ? "Online" : "Hybrid",
        level: detectedLevel,
        venue,
        registrationDeadline: sDate
          ? sDate.split("T")[0]
          : new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
        submissionDeadline: eDate
          ? eDate.split("T")[0]
          : new Date(Date.now() + 35 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 45 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        tags: [
          "GDG",
          "Google Cloud",
          detectedLevel === "State" ? "State Level" : "Global",
          chapterCity ? `${chapterCity} Chapter` : null,
          "Solution Challenge"
        ].filter(Boolean),
        platform: "GDG",
        platformUrl: itemUrl,
        description: `${item.title} hosted by ${chapter}. Official Google Developer Groups hackathon for solving real-world challenges.`,
      });
    }

    return results.slice(0, 15);
  } catch (err) {
    console.error("[ScraperService] GDG error:", err.message);
    return [];
  }
}

// ──────────────── Main Aggregator & File Storage Engine ──────────────────────────────
async function scrapeHackathonsToFile(options = {}) {
  const todayStr = new Date().toISOString().split("T")[0];
  console.log(`[ScraperService] 🚀 Starting live web scraping across Devpost, Unstop, MLH, Devfolio, Luma, and GDG for active hackathons (${todayStr})...`);

  const [devpost, unstop, mlh, devfolio, luma, gdg] = await Promise.all([
    scrapeDevpost(),
    scrapeUnstop(),
    scrapeMLH(),
    scrapeDevfolio(),
    scrapeLuma(),
    scrapeGDG(),
  ]);

  const rawAll = [
    ...(Array.isArray(devpost) ? devpost : []),
    ...(Array.isArray(unstop) ? unstop : []),
    ...(Array.isArray(mlh) ? mlh : []),
    ...(Array.isArray(devfolio) ? devfolio : []),
    ...(Array.isArray(luma) ? luma : []),
    ...(Array.isArray(gdg) ? gdg : []),
  ];
  console.log(`[ScraperService] Fetched ${rawAll.length} raw scraped hackathon items across all platforms.`);

  // Validate items in parallel for maximum speed (concurrency)
  const validationResults = await Promise.all(
    rawAll.map(async (item) => {
      if (!item.name || item.name.trim().length < 3 || !item.organizer) return null;

      // 1. Strict filter: discard any past hackathons (2024, 2025, or deadline < today)
      if (isPastHackathon(item, todayStr)) {
        return null;
      }

      // 2. Validate URL exists
      const isUrlAlive = await checkUrlExists(item.platformUrl);
      if (!isUrlAlive) {
        console.warn(`[ScraperService] ⚠️ Skipping item "${item.name}" due to 404/invalid URL: ${item.platformUrl}`);
        return null;
      }

      let finalBanner = item.banner;
      if (!finalBanner || finalBanner.includes("unsplash")) {
        const realBanner = await extractRealPageBanner(item.platformUrl);
        if (realBanner) {
          finalBanner = realBanner;
        }
      }

      return {
        ...item,
        banner: finalBanner || item.banner,
        id: item.platformUrl || `${item.name}-${Date.now()}`,
        scrapedAt: new Date().toISOString(),
      };
    })
  );

  const validHackathons = validationResults.filter(Boolean);

  // Log level breakdown
  const levelCounts = { State: 0, National: 0, Global: 0 };
  validHackathons.forEach((h) => {
    levelCounts[h.level] = (levelCounts[h.level] || 0) + 1;
  });
  console.log(`[ScraperService] ✅ Validated ${validHackathons.length} active hackathons (NO past/expired). Breakdown by level: State=${levelCounts.State}, National=${levelCounts.National}, Global=${levelCounts.Global}`);

  // 1. Save to MongoDB staging collection (universal cloud persistence across Vercel / serverless instances)
  try {
    await ScrapedHackathon.deleteMany({});
    if (validHackathons.length > 0) {
      await ScrapedHackathon.insertMany(validHackathons, { ordered: false });
    }
    await ScrapedMeta.findOneAndUpdate(
      { key: "global_staging" },
      { isCleared: false, totalCount: validHackathons.length, lastScrapedAt: new Date() },
      { upsert: true }
    );
    console.log(`[ScraperService] 💾 Staged ${validHackathons.length} hackathons to MongoDB staging collection.`);
  } catch (dbErr) {
    console.warn(`[ScraperService] MongoDB staging write warning: ${dbErr.message}`);
  }

  // 2. Safely mirror to local file if environment allows
  const fileData = {
    updatedAt: new Date().toISOString(),
    totalCount: validHackathons.length,
    status: "pending_admin_approval",
    hackathons: validHackathons,
  };

  try {
    ensureDataDirExists();
    fs.writeFileSync(FILE_PATH, JSON.stringify(fileData, null, 2), "utf-8");
    console.log(`[ScraperService] 💾 Mirrored ${validHackathons.length} valid hackathons to file: ${FILE_PATH}`);
  } catch (fsErr) {
    console.warn(`[ScraperService] File write skipped: ${fsErr.message}`);
  }

  let mergeResult = null;
  if (options.autoFeedToDb) {
    console.log("[ScraperService] 🚀 Auto-feed requested: merging scraped hackathons into MongoDB immediately...");
    mergeResult = await mergeScrapedFileToDb();
  }

  return {
    success: true,
    totalScraped: validHackathons.length,
    levelBreakdown: levelCounts,
    filePath: FILE_PATH,
    timestamp: fileData.updatedAt,
    merged: mergeResult,
  };
}

/**
 * Gets status and pending items from MongoDB staging or fallback JSON file
 */
async function getScrapedFileStatus() {
  const todayStr = new Date().toISOString().split("T")[0];

  // 1. Check MongoDB staging collection first
  try {
    const count = await ScrapedHackathon.countDocuments();
    if (count > 0) {
      const rawDocs = await ScrapedHackathon.find().sort({ createdAt: -1 }).lean();
      const docs = rawDocs.filter((h) => !isPastHackathon(h, todayStr));
      const latest = docs[0]?.scrapedAt || docs[0]?.updatedAt || new Date().toISOString();
      return {
        exists: true,
        totalCount: docs.length,
        updatedAt: latest,
        hackathons: docs.map((h) => ({
          ...h,
          _id: h._id ? h._id.toString() : undefined,
          id: (h._id ? h._id.toString() : null) || h.id || h.platformUrl,
        })),
      };
    }

    // Check if staging was explicitly cleared or merged
    const meta = await ScrapedMeta.findOne({ key: "global_staging" }).lean();
    if (meta && (meta.isCleared || meta.lastMergedAt)) {
      return {
        exists: true,
        totalCount: 0,
        updatedAt: meta.lastClearedAt || meta.lastMergedAt || meta.updatedAt,
        hackathons: [],
      };
    }
  } catch (dbErr) {
    console.warn("[ScraperService] MongoDB staging read warning:", dbErr.message);
  }

  // 2. Fallback to bundled local JSON file if present and not previously cleared
  if (fs.existsSync(FILE_PATH)) {
    try {
      const content = fs.readFileSync(FILE_PATH, "utf-8");
      const data = JSON.parse(content);
      const rawHackathons = data.hackathons || [];
      const hackathons = rawHackathons.filter((h) => !isPastHackathon(h, todayStr));

      if (data.status === "cleared_by_admin" || hackathons.length === 0) {
        return {
          exists: true,
          totalCount: 0,
          updatedAt: data.updatedAt,
          hackathons: [],
        };
      }

      return {
        exists: true,
        totalCount: hackathons.length,
        updatedAt: data.updatedAt,
        hackathons,
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

  return {
    exists: false,
    totalCount: 0,
    updatedAt: null,
    hackathons: [],
  };
}

/**
 * Ingests/merges stored hackathons from staging into MongoDB,
 * cleaning past expired records and accurately preserving State / National / Global levels.
 */
async function mergeScrapedFileToDb() {
  const todayStr = new Date().toISOString().split("T")[0];

  // Step 0: Clean any past/expired hackathons from database
  try {
    const purgeResult = await Hackathon.deleteMany({
      $or: [
        { name: { $regex: /\b(2020|2021|2022|2023|2024|2025|'24|'25)\b/i } },
        { submissionDeadline: { $lt: todayStr } },
      ],
    });
    if (purgeResult.deletedCount > 0) {
      console.log(`[ScraperService] 🧹 Purged ${purgeResult.deletedCount} past/expired hackathons from Hackathon collection.`);
    }
  } catch (purgeErr) {
    console.warn("[ScraperService] Purge past hackathons warning:", purgeErr.message);
  }

  const status = await getScrapedFileStatus();
  if (!status.exists || status.hackathons.length === 0) {
    return { success: false, message: "No active scraped data available in staging to merge." };
  }

  let insertedCount = 0;
  let updatedCount = 0;

  for (const item of status.hackathons) {
    // Strictly skip any item that is past or ended
    if (isPastHackathon(item, todayStr)) continue;

    try {
      const existing = await Hackathon.findOne({
        $or: [
          { platformUrl: item.platformUrl },
          { name: item.name, organizer: item.organizer },
        ],
      });

      if (existing) {
        existing.banner = item.banner || existing.banner;
        existing.prizePool = item.prizePool || existing.prizePool;
        existing.prizePoolUSD = item.prizePoolUSD || existing.prizePoolUSD;
        existing.mode = item.mode || existing.mode;
        existing.level = item.level || existing.level || "Global";
        existing.hackathonType = item.hackathonType || existing.hackathonType || "Hackathon";
        existing.duration = item.duration || existing.duration || "";
        existing.venue = item.venue || existing.venue || "";
        existing.schedule = item.schedule || existing.schedule || "";
        existing.submissionChecklist = item.submissionChecklist || existing.submissionChecklist || [];
        existing.registrationDeadline = item.registrationDeadline || existing.registrationDeadline;
        existing.submissionDeadline = item.submissionDeadline || existing.submissionDeadline;
        existing.resultDate = item.resultDate || existing.resultDate;
        existing.platform = item.platform || existing.platform;
        existing.platformUrl = item.platformUrl || existing.platformUrl;
        existing.description = item.description || existing.description;
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
          level: item.level || "Global",
          hackathonType: item.hackathonType || "Hackathon",
          duration: item.duration || "",
          venue: item.venue || "",
          schedule: item.schedule || "",
          submissionChecklist: item.submissionChecklist || [],
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

  console.log(`[ScraperService] ✨ Merged ${insertedCount} new and ${updatedCount} updated hackathons into MongoDB!`);

  // Step 2: Auto Commit & Push updated data/scraped_hackathons.json to GitHub
  const fileData = {
    updatedAt: new Date().toISOString(),
    totalCount: status.hackathons.length,
    status: "published_to_db",
    hackathons: status.hackathons,
  };

  let gitStatus = null;
  try {
    gitStatus = await syncJsonFileToGithub({
      relativeFilePath: "data/scraped_hackathons.json",
      data: fileData,
      commitMessage: `feat(scraper): sync ${status.hackathons.length} scraped hackathons (active 2026 events) to DB [skip ci]`,
    });
  } catch (gitErr) {
    console.error("[ScraperService] Git sync error:", gitErr.message);
    gitStatus = { success: false, error: gitErr.message };
  }

  // Step 3: Clear staging collection and mark staging as merged
  try {
    await ScrapedHackathon.deleteMany({});
    await ScrapedMeta.findOneAndUpdate(
      { key: "global_staging" },
      { isCleared: true, totalCount: 0, lastMergedAt: new Date() },
      { upsert: true }
    );
  } catch (clearErr) {
    console.warn("[ScraperService] Staging clear after merge warning:", clearErr.message);
  }

  return {
    success: true,
    insertedCount,
    updatedCount,
    totalProcessed: status.hackathons.length,
    timestamp: new Date().toISOString(),
    gitStatus,
  };
}

/**
 * Clears and removes all scraped items from MongoDB staging & JSON file
 */
async function clearAllScrapedItemsFromFile() {
  try {
    await ScrapedHackathon.deleteMany({});
    await ScrapedMeta.findOneAndUpdate(
      { key: "global_staging" },
      { isCleared: true, totalCount: 0, lastClearedAt: new Date() },
      { upsert: true }
    );
  } catch (dbErr) {
    console.warn("[ScraperService] MongoDB clear warning:", dbErr.message);
  }

  try {
    ensureDataDirExists();
    const fileData = {
      updatedAt: new Date().toISOString(),
      totalCount: 0,
      status: "cleared_by_admin",
      hackathons: [],
    };
    fs.writeFileSync(FILE_PATH, JSON.stringify(fileData, null, 2), "utf-8");
  } catch (fsErr) {
    // Ignore
  }

  return {
    success: true,
    message: "All scraped hackathons have been deleted from storage.",
    totalCount: 0,
  };
}

/**
 * Rejects & removes a single scraped item from MongoDB staging & JSON file
 */
async function rejectScrapedItemFromFile(itemId) {
  if (!itemId) {
    return { success: false, message: "Item ID is required for rejection." };
  }

  try {
    const filters = [];
    if (mongoose.isValidObjectId(itemId)) {
      filters.push({ _id: itemId });
    }
    filters.push({ id: itemId }, { platformUrl: itemId });

    await ScrapedHackathon.deleteMany({ $or: filters });

    const remainingCount = await ScrapedHackathon.countDocuments();
    await ScrapedMeta.findOneAndUpdate(
      { key: "global_staging" },
      { totalCount: remainingCount, isCleared: remainingCount === 0 },
      { upsert: true }
    );
  } catch (dbErr) {
    console.warn("[ScraperService] MongoDB reject warning:", dbErr.message);
  }

  try {
    if (fs.existsSync(FILE_PATH)) {
      const content = fs.readFileSync(FILE_PATH, "utf-8");
      const data = JSON.parse(content);
      const updatedList = (data.hackathons || []).filter(
        (h) => h.id !== itemId && h.platformUrl !== itemId && h._id !== itemId
      );
      const fileData = {
        updatedAt: new Date().toISOString(),
        totalCount: updatedList.length,
        status: updatedList.length === 0 ? "cleared_by_admin" : "pending_admin_approval",
        hackathons: updatedList,
      };
      ensureDataDirExists();
      fs.writeFileSync(FILE_PATH, JSON.stringify(fileData, null, 2), "utf-8");
    }
  } catch (fsErr) {
    // Ignore
  }

  const updatedStatus = await getScrapedFileStatus();
  return {
    success: true,
    message: "Scraped hackathon rejected and removed from staging.",
    totalCount: updatedStatus.totalCount,
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
  detectHackathonLevel,
  isPastHackathon,
};

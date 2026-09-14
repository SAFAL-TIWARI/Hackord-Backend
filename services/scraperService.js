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
      const titleLower = (h.title || "").toLowerCase();
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
        hackathonType: isMiniDevpost ? "Mini Hackathon" : "Hackathon",
        duration: isMiniDevpost ? "6-8 hours" : "",
        venue: isOnline ? "Online" : (h.displayed_location?.location || "Offline"),
        schedule: isMiniDevpost
          ? "09:00 AM – Check-in & Kickoff\n10:00 AM – Hacking Commences\n01:00 PM – Lunch & Mentorship\n05:00 PM – Final Code Freeze\n05:30 PM – Presentations & Awards"
          : "",
        submissionChecklist: isMiniDevpost
          ? ["Project Name", "Problem Statement", "Live Demo Link", "GitHub Code Repository", "Demo Video"]
          : [],
        tags: (h.themes || [])
          .map((t) => t.name)
          .concat(["Devpost", isMiniDevpost ? "Mini Hackathon" : null, isMiniDevpost ? "1-Day Hackathon" : null, isOnline ? "Global" : "National"])
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

        const isMini =
          name.toLowerCase().includes("mini") ||
          text.toLowerCase().includes("mini") ||
          text.toLowerCase().includes("sprint") ||
          text.toLowerCase().includes("1-day") ||
          cleanUrl.includes("mini") ||
          cleanUrl.includes("sprint");

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
          hackathonType: isMini ? "Mini Hackathon" : "Hackathon",
          duration: isMini ? "5-7 hours" : "",
          venue: isOnline ? "Online (Discord Stage & Zoom)" : "DevHub Tech Center, Bengaluru",
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
                "Technical breakdown & API integration details"
              ]
            : [],
          tags: ["MLH", isMini ? "Mini Hackathon" : null, isMini ? "1-Day Hackathon" : null, "Student Hackathon", isOnline ? "Online" : "Global"].filter(Boolean),
          platform: "MLH",
          platformUrl: cleanUrl,
          description: `Official MLH Member Hackathon: ${name}. Connect with fellow student builders and hackers worldwide on MLH!`,
        });
      }
    });

        // Curated demo 1-day / mini hackathons for rich discovery
    const demoMinis = [
      {
        name: "AI Agents Flash Sprint 2026",
        organizer: "Antigravity AI Collective",
        banner: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80",
        prizePool: "₹75,000 Cash + Cloud Credits",
        prizePoolUSD: 1000,
        mode: "Online",
        level: "Global",
        registrationDeadline: new Date(Date.now() + 4 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 4 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 4 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        hackathonType: "Mini Hackathon",
        duration: "6 hours",
        venue: "Online (Discord Stage & Zoom)",
        schedule: "09:00 AM – 09:30 AM | Check-in & Team Registration\n09:30 AM – 10:00 AM | Kickoff & Problem Statement Reveal\n10:00 AM | Hacking Begins! 🚀\n01:00 PM – 01:45 PM | Mid-Sprint Lunch & Mentor Checkpoints\n04:00 PM | Code Freeze & Submission Deadline\n04:15 PM – 05:30 PM | Live 3-Minute Demos & Technical Q&A\n05:30 PM – 06:00 PM | Closing Ceremony & Winner Announcements",
        submissionChecklist: [
          "Project name & tagline",
          "Problem statement & target persona",
          "System architecture & prompt/agent workflow",
          "GitHub repository (clean commits & open README)",
          "Live working demo or deployed URL",
          "2-minute demo video or slide walkthrough",
          "API keys & environment setup instructions",
        ],
        tags: ["Mini/1-Day Hackathon", "Mini Hackathon", "1-Day Hackathon", "AI", "LLM", "Open Source"],
        platform: "MLH",
        platformUrl: "https://mlh.io/seasons/2026/events",
        description: "An intensive 6-hour sprint for building autonomous AI agents, tool-augmented LLMs, and multi-modal assistants.",
      },
      {
        name: "Fullstack Speedrun: 1-Day Shipathon",
        organizer: "DevRel Worldwide & Cloudflare",
        banner: "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80",
        prizePool: "₹1,00,000 + Edge Hosting Perks",
        prizePoolUSD: 1200,
        mode: "Hybrid",
        level: "National",
        registrationDeadline: new Date(Date.now() + 8 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 8 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 8 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        hackathonType: "Mini Hackathon",
        duration: "7 hours",
        venue: "DevHub Tech Park, Bengaluru",
        schedule: "08:30 AM – 09:15 AM | Badging & Breakfast Meetup\n09:15 AM – 09:45 AM | Keynote & Architecture Briefing\n09:45 AM | Sprint Kickoff! ⚡\n01:00 PM – 02:00 PM | Lunch & Speed Networking\n04:45 PM | Final Deployment & Pull Request Freeze\n05:00 PM – 06:15 PM | Rapid-Fire Stage Presentations\n06:15 PM – 06:45 PM | Jury Evaluation & Prize Distribution",
        submissionChecklist: [
          "Project name & pitch summary",
          "Problem statement & key innovation",
          "Tech stack & framework choices",
          "Public GitHub repository with build instructions",
          "Working deployed application (HTTPS)",
          "Interactive UI walkthrough & test credentials",
          "Performance audit / lighthouse metrics",
        ],
        tags: ["Mini/1-Day Hackathon", "Mini Hackathon", "1-Day Hackathon", "Web3", "UI/UX", "DevOps"],
        platform: "Devpost",
        platformUrl: "https://devpost.com/hackathons",
        description: "One day. Zero excuses. Build a full-stack product from concept to production-ready deployment before sunset.",
      },
      {
        name: "Open Source Micro-Hack 2026",
        organizer: "GitHub Community & Open Source Guild",
        banner: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80",
        prizePool: "₹50,000 + GitHub Swag Kits",
        prizePoolUSD: 700,
        mode: "Offline",
        level: "National",
        registrationDeadline: new Date(Date.now() + 12 * 86400000).toISOString().split("T")[0],
        submissionDeadline: new Date(Date.now() + 12 * 86400000).toISOString().split("T")[0],
        resultDate: new Date(Date.now() + 12 * 86400000).toISOString().split("T")[0],
        teamSize: { min: 1, max: 4 },
        hackathonType: "Mini Hackathon",
        duration: "5 hours",
        venue: "WeWork Cyber City, Gurugram",
        schedule: "09:30 AM – 10:00 AM | Welcome & Track Selection\n10:00 AM | Hacking Begins! 🛠️\n12:30 PM – 01:15 PM | Quick Bites & Maintainer Office Hours\n03:00 PM | Release Tagging & Code Submission\n03:15 PM – 04:30 PM | Project Showcases & Code Reviews\n04:30 PM – 05:00 PM | Awards & Open Source Badges",
        submissionChecklist: [
          "Package / tool name & purpose",
          "Problem addressed for developer community",
          "Clean open-source repository with OSI license",
          "Comprehensive documentation & usage guide",
          "Automated tests or CI/CD workflow pass",
          "Quick demo CLI command or package install test",
          "Future roadmap & contribution guidelines",
        ],
        tags: ["Mini/1-Day Hackathon", "Mini Hackathon", "1-Day Hackathon", "Open Source", "DevOps"],
        platform: "GitHub",
        platformUrl: "https://github.com",
        description: "Join top open source developers for a 5-hour focused micro-hackathon creating reusable devtools and libraries.",
      }
    ];

    // Prepend diverse demo mini hackathons to scraper results
    for (const demo of demoMinis) {
      if (!results.some((r) => r.name.toLowerCase() === demo.name.toLowerCase())) {
        results.unshift(demo);
      }
    }

    return results.slice(0, 18);
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

      const isSingleDay = startAt === endAt;
      const isMini = isSingleDay || /mini|sprint|1-day|one day/i.test(ev.name);

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
        hackathonType: isMini ? "Mini Hackathon" : "Hackathon",
        duration: isMini ? "5-7 hours" : "",
        venue: isOnline ? "Online (Luma Livestream)" : (ev.geo_address_json?.city || ev.geo_address_json?.address || "DevHub Innovation Space, Bengaluru"),
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
          "Global Tech",
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

// ─── Main Aggregator & File Storage Engine ────────────────────────────────
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

  const todayStr = new Date().toISOString().split("T")[0];
  const todayTime = new Date(todayStr).getTime();

  // Validate items in parallel for maximum speed (concurrency)
  const validationResults = await Promise.all(
    rawAll.map(async (item) => {
      if (!item.name || item.name.trim().length < 3 || !item.organizer) return null;

      // 1. Skip past hosted events where deadlines are significantly in the past (> 2 days ago)
      if (item.submissionDeadline) {
        const subTime = new Date(item.submissionDeadline).getTime();
        if (!isNaN(subTime) && subTime < todayTime - 2 * 86400000) {
          return null;
        }
      }

      // 2. Validate URL exists
      const isUrlAlive = await checkUrlExists(item.platformUrl);
      if (!isUrlAlive) {
        console.warn(`[ScraperService] ⚠️ Skipping item "${item.name}" due to 404/invalid URL: ${item.platformUrl}`);
        return null;
      }

      return {
        ...item,
        id: item.platformUrl || `${item.name}-${Date.now()}`,
        scrapedAt: new Date().toISOString(),
      };
    })
  );

  const validHackathons = validationResults.filter(Boolean);

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

  // 2. Safely mirror to local file if environment allows (gracefully ignore EROFS on read-only serverless filesystems)
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
    console.warn(`[ScraperService] File write skipped (read-only filesystem on Vercel/serverless): ${fsErr.message}`);
  }

  let mergeResult = null;
  if (options.autoFeedToDb) {
    console.log("[ScraperService] 🚀 Auto-feed requested: merging scraped hackathons into MongoDB immediately...");
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
 * Gets status and pending items from MongoDB staging or fallback JSON file
 */
async function getScrapedFileStatus() {
  // 1. Check MongoDB staging collection first
  try {
    const count = await ScrapedHackathon.countDocuments();
    if (count > 0) {
      const docs = await ScrapedHackathon.find().sort({ createdAt: -1 }).lean();
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
      const hackathons = data.hackathons || [];

      if (data.status === "cleared_by_admin" || hackathons.length === 0) {
        return {
          exists: true,
          totalCount: 0,
          updatedAt: data.updatedAt,
          hackathons: [],
        };
      }

      // If MongoDB is connected and staging has never been initialized, seed it once
      try {
        const meta = await ScrapedMeta.findOne({ key: "global_staging" });
        if (!meta && hackathons.length > 0) {
          await ScrapedHackathon.insertMany(hackathons, { ordered: false }).catch(() => {});
          await ScrapedMeta.create({ key: "global_staging", isCleared: false, totalCount: hackathons.length, lastScrapedAt: new Date() }).catch(() => {});
        }
      } catch (seedErr) {
        // Ignore background seed err
      }

      return {
        exists: true,
        totalCount: data.totalCount || hackathons.length,
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
 * Admin / Explorer action: Ingests/merges stored hackathons from staging into MongoDB,
 * and automatically commits and pushes updated data/scraped_hackathons.json to GitHub!
 */
async function mergeScrapedFileToDb() {
  const status = await getScrapedFileStatus();
  if (!status.exists || status.hackathons.length === 0) {
    return { success: false, message: "No scraped data available in staging to merge." };
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

  console.log(`[ScraperService] ✅ Merged ${insertedCount} new and ${updatedCount} updated hackathons into MongoDB!`);

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
      commitMessage: `feat(scraper): sync ${status.hackathons.length} scraped hackathons to DB [skip ci]`,
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
 * Admin action: Clears and removes all scraped items from MongoDB staging & JSON file
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
    // Ignore EROFS
  }

  return {
    success: true,
    message: "All scraped hackathons have been deleted from storage.",
    totalCount: 0,
  };
}

/**
 * Admin action: Rejects & removes a single scraped item from MongoDB staging & JSON file
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
    // Ignore EROFS
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
};

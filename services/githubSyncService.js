const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Service to sync JSON files (like scraped_hackathons.json) to GitHub.
 * 
 * Strategy:
 * 1. If GITHUB_TOKEN (or GITHUB_PAT / GH_TOKEN) is set in environment:
 *    Uses GitHub REST API (Contents API) to commit & push directly.
 *    -> This works seamlessly on live websites (e.g. Vercel serverless) where no local Git binary exists.
 * 2. If NO token is set and running in a local Git repo (.git directory exists):
 *    Falls back to local Git CLI (`git add`, `git commit`, `git push origin main`)
 *    -> This works seamlessly on localhost with existing IDE / Windows Credential Manager.
 * 3. Always writes to the local file if filesystem is writable.
 */
async function syncJsonFileToGithub({
  relativeFilePath = "data/scraped_hackathons.json",
  data,
  commitMessage = "feat(scraper): update scraped hackathons data [skip ci]",
}) {
  const jsonString = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const repoRoot = path.resolve(__dirname, "..");
  const fullLocalPath = path.resolve(repoRoot, relativeFilePath);

  // 1. Try to write locally if possible
  let localWriteSuccess = false;
  try {
    const dir = path.dirname(fullLocalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullLocalPath, jsonString, "utf-8");
    localWriteSuccess = true;
    console.log(`[GithubSync] ✅ Written locally to ${fullLocalPath}`);
  } catch (fsErr) {
    console.warn(`[GithubSync] Local filesystem write skipped (read-only or permission):`, fsErr.message);
  }

  // 2. Check for GitHub Token (Works on live websites like Vercel)
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.GH_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER || "SAFAL-TIWARI";
  const repo = process.env.GITHUB_REPO_NAME || "Hackord-Backend";
  const branch = process.env.GITHUB_BRANCH || "main";
  const githubPath = relativeFilePath.replace(/\\/g, "/");

  if (token) {
    console.log(`[GithubSync] Pushing to GitHub via REST API for ${owner}/${repo}@${branch} (${githubPath})...`);
    try {
      // Step A: Get current file SHA if it exists
      let currentSha = null;
      try {
        const getRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${githubPath}?ref=${branch}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "Hackord-Scraper-Sync",
            },
          }
        );
        if (getRes.ok) {
          const getJson = await getRes.json();
          currentSha = getJson.sha;
        }
      } catch (getErr) {
        console.warn("[GithubSync] Could not fetch existing file SHA:", getErr.message);
      }

      // Step B: Create / Update file via GitHub API
      const body = {
        message: commitMessage,
        content: Buffer.from(jsonString).toString("base64"),
        branch,
      };
      if (currentSha) {
        body.sha = currentSha;
      }

      const putRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${githubPath}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "Hackord-Scraper-Sync",
          },
          body: JSON.stringify(body),
        }
      );

      const putData = await putRes.json();
      if (!putRes.ok) {
        throw new Error(putData.message || `GitHub API error (${putRes.status})`);
      }

      console.log(`[GithubSync] ✅ Successfully committed and pushed to GitHub via API! Commit SHA: ${putData.commit?.sha}`);
      return {
        success: true,
        method: "github-api",
        commitSha: putData.commit?.sha,
        commitUrl: putData.commit?.html_url,
        localWritten: localWriteSuccess,
      };
    } catch (apiErr) {
      console.error("[GithubSync] GitHub API sync failed:", apiErr.message);
      // Fall through to check local git CLI if in dev
    }
  }

  // 3. Fallback: Local Git CLI (Works on localhost with user's Git credentials)
  const isGitRepo = fs.existsSync(path.join(repoRoot, ".git"));
  if (isGitRepo) {
    try {
      console.log(`[GithubSync] Attempting local git commit & push...`);
      execSync(`git add "${githubPath}"`, { cwd: repoRoot, stdio: "pipe" });

      // Check if there are staged changes
      const diffStatus = execSync("git diff --cached --name-only", { cwd: repoRoot, stdio: "pipe" }).toString().trim();
      if (!diffStatus) {
        console.log("[GithubSync] No file changes to commit (already up to date).");
        return {
          success: true,
          method: "git-cli",
          note: "File was already up-to-date in git",
          localWritten: localWriteSuccess,
        };
      }

      execSync(`git commit -m "${commitMessage}"`, { cwd: repoRoot, stdio: "pipe" });
      execSync(`git push origin ${branch}`, { cwd: repoRoot, stdio: "pipe" });
      console.log(`[GithubSync] ✅ Local git commit and push completed successfully!`);

      return {
        success: true,
        method: "git-cli",
        localWritten: localWriteSuccess,
      };
    } catch (cliErr) {
      console.error("[GithubSync] Local Git CLI push failed:", cliErr.message);
      return {
        success: false,
        method: "git-cli-error",
        error: cliErr.message,
        localWritten: localWriteSuccess,
      };
    }
  }

  // 4. Serverless environment without GITHUB_TOKEN
  console.warn("[GithubSync] Notice: GITHUB_TOKEN not configured on live server. Local file updated where possible.");
  return {
    success: false,
    method: "no-token",
    localWritten: localWriteSuccess,
    note: "GITHUB_TOKEN environment variable is not configured on live host. File updated locally/in-memory.",
  };
}

module.exports = {
  syncJsonFileToGithub,
};

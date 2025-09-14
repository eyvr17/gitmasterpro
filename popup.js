// popup.js - GitHub Pro Manager v4.2
// Lógica principal de la extensión

const ghAPI = "https://api.github.com";
let ghToken = null;
let starredRepos = [];
let followingUsers = [];
let selectedRepos = new Set();
let googleAuthToken = null;

document.addEventListener("DOMContentLoaded", async () => {
  const tokenInput = document.getElementById("token");
  const rememberCheckbox = document.getElementById("rememberToken");
  const status = document.getElementById("status");

  /* -------------------- Tabs -------------------- */
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  /* -------------------- Token Handling -------------------- */
  chrome.storage.local.get(["ghToken"], (res) => {
    if (res.ghToken) {
      ghToken = res.ghToken;
      tokenInput.value = "************";
      tokenInput.disabled = true;
      rememberCheckbox.checked = true;
    }
  });

  rememberCheckbox.addEventListener("change", () => {
    if (!rememberCheckbox.checked) {
      chrome.storage.local.remove("ghToken", () => {
        ghToken = null;
        tokenInput.disabled = false;
        tokenInput.value = "";
      });
    }
  });

  document.getElementById("getTokenLink").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com/settings/tokens/new?scopes=repo,user,read:user" });
  });

  /* -------------------- Fetch Stars -------------------- */
  document.getElementById("fetchStarsBtn").addEventListener("click", async () => {
    starredRepos = [];
    selectedRepos.clear();
    const username = document.getElementById("username").value.trim();
    ghToken = tokenInput.disabled ? ghToken : tokenInput.value.trim() || null;
    if (rememberCheckbox.checked && ghToken) {
      chrome.storage.local.set({ ghToken });
    }

    showStatus("Fetching starred repos...");
    try {
      starredRepos = await fetchStarredRepos(username);
      renderStarredList(starredRepos);
      showStatus(`${starredRepos.length} repos fetched.`);
    } catch (e) {
      console.error(e);
      showStatus("Error fetching starred repos.", true);
    }
  });

  /* -------------------- Export / Copy / Open -------------------- */
  document.getElementById("exportBtn").addEventListener("click", () => exportStarredRepos());
  document.getElementById("copyBtn").addEventListener("click", () => {
    const urls = starredRepos.map(r => r.html_url).join("\n");
    navigator.clipboard.writeText(urls);
    showStatus("Copied to clipboard.");
  });
  document.getElementById("openUrlsBtn").addEventListener("click", () => {
    starredRepos.forEach(r => chrome.tabs.create({ url: r.html_url }));
  });

  /* -------------------- Google Sheets -------------------- */
  document.getElementById("exportSheetsBtn").addEventListener("click", async () => {
    if (!googleAuthToken) await authenticateGoogle();
    await exportToGoogleSheets(starredRepos);
    showStatus("Exported to Google Sheets!");
  });
  document.getElementById("googleAuthBtn").addEventListener("click", async () => {
    await authenticateGoogle();
    showStatus("Google Sheets authenticated.");
  });

  /* -------------------- Unstar / Unfollow -------------------- */
  document.getElementById("unstarAllBtn").addEventListener("click", async () => {
    if (!confirm("Are you sure you want to unstar ALL repos?")) return;
    for (let r of starredRepos) {
      await unstarRepo(r.owner.login, r.name);
    }
    showStatus("All repos unstarred.");
  });

  document.getElementById("unfollowAllBtn").addEventListener("click", async () => {
    if (!confirm("Unfollow ALL users?")) return;
    for (let u of followingUsers) {
      await unfollowUser(u.login);
    }
    showStatus("All unfollowed.");
  });

  /* -------------------- Import Repos -------------------- */
  document.getElementById("importTextBtn").addEventListener("click", async () => {
    const txt = document.getElementById("importText").value.trim();
    if (!txt) return showStatus("No text provided.", true);
    const urls = txt.split("\n").map(u => u.trim()).filter(Boolean);
    for (let url of urls) await starRepoFromUrl(url);
    showStatus(`${urls.length} repos starred.`);
  });

  document.getElementById("importFileBtn").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const urls = text.split("\n").map(u => u.trim()).filter(Boolean);
    for (let url of urls) await starRepoFromUrl(url);
    showStatus(`${urls.length} repos starred from file.`);
  });

  /* -------------------- Compare Followings -------------------- */
  document.getElementById("compareFollowingBtn").addEventListener("click", async () => {
    const usersInput = document.getElementById("compareUsers").value.trim();
    if (!usersInput) return;
    const users = usersInput.split(",").map(u => u.trim());
    const comparisons = await compareFollowings(users);
    renderComparison(comparisons);
  });

  /* -------------------- Contribution Opportunities -------------------- */
  document.getElementById("findContribBtn").addEventListener("click", async () => {
    showStatus("Searching contribution opportunities...");
    const opps = await findContributionOpportunities();
    renderContribResults(opps);
    showStatus("Opportunities loaded.");
  });

});

/* -------------------- Utility Functions -------------------- */

function showStatus(msg, isError = false) {
  const status = document.getElementById("status");
  status.textContent = msg;
  status.style.color = isError ? "red" : "green";
}

async function fetchStarredRepos(username) {
  let page = 1, all = [];
  while (true) {
    const res = await fetch(`${ghAPI}/users/${username}/starred?per_page=100&page=${page}`, {
      headers: ghToken ? { Authorization: `token ${ghToken}` } : {}
    });
    if (res.status !== 200) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all = all.concat(data);
    page++;
  }
  return all;
}

async function unstarRepo(owner, repo) {
  return fetch(`${ghAPI}/user/starred/${owner}/${repo}`, {
    method: "DELETE",
    headers: { Authorization: `token ${ghToken}` }
  });
}

async function unfollowUser(user) {
  return fetch(`${ghAPI}/user/following/${user}`, {
    method: "DELETE",
    headers: { Authorization: `token ${ghToken}` }
  });
}

async function starRepoFromUrl(url) {
  const parts = url.replace("https://github.com/", "").split("/");
  if (parts.length < 2) return;
  const owner = parts[0], repo = parts[1];
  return fetch(`${ghAPI}/user/starred/${owner}/${repo}`, {
    method: "PUT",
    headers: { Authorization: `token ${ghToken}` }
  });
}

async function authenticateGoogle() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return reject();
      }
      googleAuthToken = token;
      resolve(token);
    });
  });
}

async function exportToGoogleSheets(repos) {
  const body = {
    properties: { title: "GitHub Starred Repos" },
    sheets: [{ properties: { title: "Stars" } }]
  };
  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${googleAuthToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const sheet = await createRes.json();
  const values = repos.map(r => [r.full_name, r.html_url, r.stargazers_count, r.description || ""]);
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/Stars!A1:append?valueInputOption=RAW`, {
    method: "POST",
    headers: { Authorization: `Bearer ${googleAuthToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values })
  });
  chrome.tabs.create({ url: sheet.spreadsheetUrl });
}

/* -------------------- Renderers -------------------- */

function renderStarredList(list) {
  const container = document.getElementById("starredResults");
  container.innerHTML = "";
  list.forEach(repo => {
    const div = document.createElement("div");
    div.className = "repo-item";
    div.innerHTML = `
      <label>
        <input type="checkbox" data-url="${repo.html_url}">
        <strong>${repo.full_name}</strong> ⭐${repo.stargazers_count}
        <small>${repo.description || ""}</small>
      </label>`;
    container.appendChild(div);
  });
}

function renderComparison(data) {
  const container = document.getElementById("followingResults");
  container.innerHTML = "";
  if (!data || data.length === 0) {
    container.textContent = "No common followings found.";
    return;
  }
  data.forEach(user => {
    const div = document.createElement("div");
    div.textContent = user;
    container.appendChild(div);
  });
}

function renderContribResults(opps) {
  const container = document.getElementById("contribResults");
  container.innerHTML = "";
  opps.forEach(o => {
    const div = document.createElement("div");
    div.innerHTML = `<a href="${o.html_url}" target="_blank">${o.full_name}</a> - ${o.open_issues_count} open issues`;
    container.appendChild(div);
  });
}

async function compareFollowings(users) {
  let allFollowings = [];
  for (let u of users) {
    const res = await fetch(`${ghAPI}/users/${u}/following`);
    const data = await res.json();
    if (Array.isArray(data)) allFollowings.push(data.map(d => d.login));
  }
  // Intersección
  return allFollowings.reduce((a, b) => a.filter(i => b.includes(i)));
}

async function findContributionOpportunities() {
  // Filtra repos con más de 1 issue abierto
  return starredRepos.filter(r => r.open_issues_count > 1);
}

function exportStarredRepos() {
  const urls = starredRepos.map(r => r.html_url).join("\n");
  const blob = new Blob([urls], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: "starred_repos.txt"
  });
}

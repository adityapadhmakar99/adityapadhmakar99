/**
 * update-readme.js
 *
 * Fetches all public, non-forked repos via GitHub API and rewrites
 * the <!-- PROJECTS:START --> ... <!-- PROJECTS:END --> block in README.md.
 *
 * Markers in README.md (required):
 *   <!-- PROJECTS:START -->
 *   ...auto-generated content...
 *   <!-- PROJECTS:END -->
 */

const fs = require('fs');
const https = require('https');

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN    = process.env.GITHUB_TOKEN;
const README   = 'README.md';

if (!USERNAME) {
  console.error('GITHUB_USERNAME env var is required');
  process.exit(1);
}

// ─── HTTP helper ────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'readme-updater',
        'Accept': 'application/vnd.github+json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    };
    https.get(url, opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}: ${body}`));
        } else {
          resolve(JSON.parse(body));
        }
      });
    }).on('error', reject);
  });
}

// ─── Fetch all repos (handles pagination) ───────────────────────────────────

async function fetchAllRepos() {
  let page = 1;
  let all  = [];
  while (true) {
    const url  = `https://api.github.com/users/${USERNAME}/repos?per_page=100&page=${page}&sort=updated&type=public`;
    const data = await get(url);
    all  = all.concat(data);
    if (data.length < 100) break;
    page++;
  }
  return all.filter(r => !r.fork && r.name !== USERNAME);
}

// ─── Language → emoji map ───────────────────────────────────────────────────

const LANG_EMOJI = {
  Java:       '☕',
  Python:     '🐍',
  JavaScript: '🟨',
  TypeScript: '🔷',
  Go:         '🐹',
  Rust:       '🦀',
  Kotlin:     '🟣',
  Shell:      '🐚',
  'C++':      '⚙️',
  C:          '⚙️',
  'C#':       '🔵',
  Scala:      '🔴',
  Ruby:       '💎',
};

function langEmoji(lang) {
  return lang ? (LANG_EMOJI[lang] || '📦') : '📦';
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ─── Build markdown table ────────────────────────────────────────────────────

function buildProjectsBlock(repos) {
  // Sort: starred repos first, then by last updated
  const sorted = [...repos].sort((a, b) => {
    if (b.stargazers_count !== a.stargazers_count)
      return b.stargazers_count - a.stargazers_count;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const totalForks = repos.reduce((s, r) => s + r.forks_count, 0);
  const langCounts = {};
  repos.forEach(r => {
    if (r.language) langCounts[r.language] = (langCounts[r.language] || 0) + 1;
  });
  const topLangs = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([l]) => `\`${l}\``)
    .join(' · ');

  const updatedAt = new Date().toUTCString();

  const rows = sorted.map(r => {
    const name  = `[${r.name}](${r.html_url})`;
    const desc  = (r.description || '—').replace(/\|/g, '\\|');
    const lang  = r.language ? `${langEmoji(r.language)} ${r.language}` : '—';
    const stars = r.stargazers_count ? `⭐ ${r.stargazers_count}` : '—';
    const date  = formatDate(r.updated_at);
    return `| ${name} | ${desc} | ${lang} | ${stars} | ${date} |`;
  });

  return `<!-- PROJECTS:START -->
> 🔄 Auto-synced from GitHub · **${repos.length} repos** · ⭐ ${totalStars} stars · 🍴 ${totalForks} forks  
> Top languages: ${topLangs}  
> _Last updated: ${updatedAt}_

| Project | Description | Language | Stars | Updated |
|---------|-------------|----------|-------|---------|
${rows.join('\n')}
<!-- PROJECTS:END -->`;
}

// ─── Patch README.md ─────────────────────────────────────────────────────────

function patchReadme(content, block) {
  const START = '<!-- PROJECTS:START -->';
  const END   = '<!-- PROJECTS:END -->';
  const si = content.indexOf(START);
  const ei = content.indexOf(END);

  if (si === -1 || ei === -1) {
    console.error(
      `README.md is missing marker comments.\n` +
      `Add these two lines where you want the projects table:\n\n` +
      `  ${START}\n  ${END}\n`
    );
    process.exit(1);
  }

  return content.slice(0, si) + block + content.slice(ei + END.length);
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Fetching repos for @${USERNAME}…`);
  const repos = await fetchAllRepos();
  console.log(`Found ${repos.length} public non-fork repos`);

  const block   = buildProjectsBlock(repos);
  const before  = fs.readFileSync(README, 'utf8');
  const after   = patchReadme(before, block);

  if (before === after) {
    console.log('README unchanged — nothing to commit');
  } else {
    fs.writeFileSync(README, after, 'utf8');
    console.log('README.md updated ✓');
  }
})();

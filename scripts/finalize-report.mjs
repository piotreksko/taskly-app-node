#!/usr/bin/env node
// Replace the model-written "Commit:" line of the unit-test agent's PR comment with what actually
// happened when the workflow pushed the tests: the real commit, "push failed", or "no commit".
// The agent writes its report *before* the publishing job pushes, so only this step knows the outcome.
// Zero dependencies (Node 22 fetch). Runs in a job of its own, from the base branch, after safe_outputs.
//
// Environment: GH_TOKEN, REPO (owner/name), COMMENT_ID, PUSH_SHA, PUSH_URL, PUSH_FAILURES, PUSH_ERRORS
//   node scripts/finalize-report.mjs                   # read, rewrite and update the comment
//   node scripts/finalize-report.mjs --body-file f.md  # print the rewritten body only (tests, dry runs)

import { readFileSync } from 'node:fs';

const env = process.env;
const facts = {
  sha: env.PUSH_SHA ?? '',
  url: env.PUSH_URL ?? '',
  failures: Number(env.PUSH_FAILURES || 0),
  errors: env.PUSH_ERRORS ?? '',
};

const bodyFile = process.argv.indexOf('--body-file');
if (bodyFile !== -1) {
  process.stdout.write(rewrite(readFileSync(process.argv[bodyFile + 1], 'utf8'), facts));
} else {
  await updateComment();
}

function rewrite(body, { sha, url, failures, errors }) {
  let commit;
  let status = null;
  if (failures > 0) {
    commit = `**Commit:** ❌ push to this branch failed – the tests above were **not** applied: ${firstLine(errors) || 'see the workflow run'}`;
    status = '**Status:** ❌ Tests not delivered – the push failed (see Commit)';
  } else if (sha) {
    const short = sha.slice(0, 7);
    commit = `**Commit:** ${url ? `[\`${short}\`](${url})` : `\`${short}\``} – tests pushed to this branch`;
  } else {
    commit = '**Commit:** none – nothing was pushed to this branch';
  }
  let commitReplaced = false;
  let statusReplaced = false;
  const lines = body.split('\n').map((line) => {
    if (line.startsWith('**Commit:**')) {
      commitReplaced = true;
      return commit;
    }
    if (status && line.startsWith('**Status:**')) {
      statusReplaced = true;
      return status;
    }
    return line;
  });
  // A line the model left out is added right under the heading (or at the top), never lost or duplicated.
  const heading = lines.findIndex((line) => line.startsWith('## '));
  if (!commitReplaced) lines.splice(heading + 1, 0, '', commit);
  if (status && !statusReplaced) lines.splice(heading + 1, 0, '', status);
  return lines.join('\n');
}

function firstLine(text) {
  // The error text is shown in a PR comment: one line, no backticks or HTML, bounded length.
  const line = String(text).split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  return line.replace(/[`<>]/g, "'").slice(0, 300);
}

async function updateComment() {
  if (!env.COMMENT_ID) {
    console.log('No report comment was posted; nothing to update.');
    return;
  }
  const api = `https://api.github.com/repos/${env.REPO}/issues/comments/${env.COMMENT_ID}`;
  const headers = {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const current = await fetch(api, { headers });
  if (!current.ok) throw new Error(`Reading the comment failed: ${current.status}`);
  const { body } = await current.json();
  const next = rewrite(body, facts);
  if (next === body) {
    console.log('Comment already correct.');
    return;
  }
  const update = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify({ body: next }) });
  if (!update.ok) throw new Error(`Updating the comment failed: ${update.status}`);
  console.log(`Updated the report comment: ${next.split('\n').find((line) => line.startsWith('**Commit:**'))}`);
}

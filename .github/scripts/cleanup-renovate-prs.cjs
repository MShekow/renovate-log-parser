/**
 * Deletes every Renovate PR and branch from the shared test repository.
 *
 * Used by `.github/workflows/verify-fixtures.yml`, both as the first step of
 * each scenario job (so Renovate always starts from a pristine repository —
 * otherwise it would report "Branch already exists" and skip the very work the
 * fixture captures) and as the final job (so the repository is left clean).
 *
 * Every PR is renamed before it is closed, which makes it obvious in the
 * repository's PR list that CI — and not a human — retired it.
 *
 * Invoked via actions/github-script:
 *
 *   script: await require('./.github/scripts/cleanup-renovate-prs.cjs')({github, context, core})
 */

/** The repository the fixtures are captured against. */
const OWNER = "MShekow";
const REPO = "renovate-log-parser-test";

/** Branch-name prefix Renovate uses for every branch it creates. */
const BRANCH_PREFIX = "renovate/";

/** Prefix prepended to the title of each PR this script closes. */
const CLOSED_TITLE_PREFIX = "[CI cleanup] ";

module.exports = async ({ github, core }) => {
  const closed = [];
  const deleted = [];

  // 1. Close every open Renovate PR. This includes the onboarding PR, whose
  //    branch is `renovate/configure` and therefore also matches the prefix.
  const pulls = await github.paginate(github.rest.pulls.list, {
    owner: OWNER,
    repo: REPO,
    state: "open",
    per_page: 100,
  });

  for (const pull of pulls) {
    if (!pull.head.ref.startsWith(BRANCH_PREFIX)) continue;

    const title = pull.title.startsWith(CLOSED_TITLE_PREFIX)
      ? pull.title
      : `${CLOSED_TITLE_PREFIX}${pull.title}`;

    await github.rest.pulls.update({
      owner: OWNER,
      repo: REPO,
      pull_number: pull.number,
      title,
      state: "closed",
    });
    closed.push(`#${pull.number} (${pull.head.ref})`);
  }

  // 2. Delete every remaining `renovate/*` branch. Listing refs rather than
  //    deriving branches from the PRs above matters: Renovate also creates
  //    branches it has not opened a PR for yet (or whose PR it already closed),
  //    and those would still make the next run take a different code path.
  //
  //    listMatchingRefs returns 404 (not an empty list) when nothing matches.
  let refs = [];
  try {
    refs = await github.paginate(github.rest.git.listMatchingRefs, {
      owner: OWNER,
      repo: REPO,
      ref: `heads/${BRANCH_PREFIX}`,
      per_page: 100,
    });
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  for (const { ref } of refs) {
    // `ref` comes back fully qualified ("refs/heads/renovate/x"); the delete
    // endpoint wants it without the leading "refs/".
    const shortRef = ref.replace(/^refs\//, "");
    try {
      await github.rest.git.deleteRef({
        owner: OWNER,
        repo: REPO,
        ref: shortRef,
      });
      deleted.push(shortRef);
    } catch (error) {
      // Closing a PR can make Renovate's branch disappear underneath us, and a
      // concurrent run may have removed it already. Neither is a failure.
      if (error.status !== 404 && error.status !== 422) throw error;
    }
  }

  core.info(
    `Closed ${closed.length} pull request(s)${closed.length ? `: ${closed.join(", ")}` : ""}`,
  );
  core.info(
    `Deleted ${deleted.length} branch(es)${deleted.length ? `: ${deleted.join(", ")}` : ""}`,
  );

  await core.summary
    .addHeading("Renovate test-repo cleanup", 3)
    .addRaw(
      `Closed **${closed.length}** pull request(s), deleted **${deleted.length}** branch(es).`,
    )
    .write();
};

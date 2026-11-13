# Releasing agentcurfew

agentcurfew is published from a version tag by `.github/workflows/release.yml`, with no npm token stored anywhere: the publish job authenticates with OIDC (npm trusted publishing), npm adds provenance, and the release passes two gates that need the maintainer: the GitHub environment `npm` and npm's staged publishing, approved with 2FA.

The first release is **1.0.0**: `package.json` holds that version since 2026-11-07, and the commit that sets it is the one to tag. The workflow refuses to publish `0.0.0`.

Facts below come from npm's documentation sources (`npm/documentation`, `content/packages-and-modules/securing-your-code/trusted-publishers.mdx` and `staged-publishing.mdx`), read on 2026-11-06. Check them again before the first release: they change.

## Once, before the first release

1. **Name.** Check that `agentcurfew` is still free: `npm view agentcurfew` must answer E404 (it did on 2026-11-06).
2. **npm account.** Sign in to npmjs.com with two-factor authentication on.
3. **Trusted publisher.** In the package settings on npmjs.com, add a trusted publisher: GitHub Actions, organization or user `DevXord`, repository `agentcurfew`, workflow `release.yml`, environment `npm`. A new configuration must see a successful publish within 2 days, or it expires: add it on the day of the release.
   - It works only for a package that already exists, so for 1.0.0 do this after the first publish: see "The first release" below.
4. **No tokens.** After the first publish, set the package's **Settings → Publishing access** to "Require two-factor authentication and disallow tokens".
5. **GitHub environment.** In the repository settings, create the environment `npm` with **Required reviewers** (the maintainer) and **Deployment branches and tags** limited to tags matching `v*`.
6. **Tag protection.** Add a ruleset for tags `v*` that only the maintainer can create, update or delete.

7. **Documentation site.** Create the free GitHub organization `agentcurfew` and in it a public repository `agentcurfew.github.io` with the files of [`site/org-repo/`](../site/org-repo/) (its `README.md` and `.github/workflows/pages.yml`). In that repository's **Settings → Pages**, set **Source** to "GitHub Actions"; then run the workflow `pages` once (Actions → pages → Run workflow). Before the first release tag it builds from `main`. The site is then at https://agentcurfew.github.io/, the `homepage` of `package.json`.
8. **Repository page.** In `DevXord/agentcurfew`, **About** (the gear beside it): description "One security policy for the files that steer your AI coding agents", website https://agentcurfew.github.io/, topics such as `security`, `ai-agents`, `mcp`, `claude-code`, `supply-chain`; in **Settings → General → Social preview**, upload [`site/social.png`](../site/social.png).

## Every release (current flow since 1.1.0)

1. Make sure CI on `main` is green, including `agentcurfew verify .` and `depcurfew doctor`.
2. Write the user-facing notes in [CHANGELOG.md](../CHANGELOG.md) under `## <version>`, with any end-user-facing changes under a `### Upgrading` subsection; leave `## [Unreleased]` above it empty.
3. Set the version without creating a tag: `npm version <version> --no-git-tag-version`, commit `package.json`, `package-lock.json` and `CHANGELOG.md`, and push. The welcome-screen snapshot no longer carries the version, so step 3 does not touch it.
4. **Dry-run the gates.** After the merge to `main`, run `release.yml` by hand (`gh workflow run release.yml --ref main`, or Actions → release → Run workflow). This runs `build`, `tarball-install` and `tarball-smoke` without `publish`. GitHub only dispatches workflows from the default branch, so this step runs after the merge, not before. Fix anything before tagging.
5. Tag that commit and push the tag: `git tag -s v<version> -m v<version> && git push origin v<version>` (or `git -c tag.gpgSign=false tag -a …` without a signing key). The tag must match `v<major>.<minor>.<patch>`; the workflow refuses anything else.
6. The workflow checks that HEAD is an ancestor of `origin/main`, that `## <version>` is the first release heading in `CHANGELOG.md`, that `## [Unreleased]` is empty, that the tag matches the version, runs `npm test`, `npm run typecheck`, `npm run check:pkg`, `npm run fuzz`, the built-CLI self-check (`scan`, `verify`, `doctor`) and the import allowlist for `dist/*.js`, then packs the tarball and installs it once outside the project with the pinned npm (the project's `.npmrc`, with `allow-file=none`, does not apply there) and smoke-tests the installed CLI on Node 20.0.0, 20, 22, 24 and 26.
7. Approve the job `publish` in GitHub (environment `npm`). It checks the tarball's SHA-256 and runs `npm stage publish`; nothing is public yet. The job uses Node 24's bundled npm (≥ 11.15) and `id-token: write`, so no npm download is needed.
8. **Wait for npm's automated review.** After `npm stage publish`, npm scans the tarball; `npm stage approve` returns `E409` until the review finishes (seen on 1.2.0). Refresh `npm stage list agentcurfew` until the staged row is ready, then inspect: `npm stage view <id>`, `npm stage download <id>` (compare its SHA-256 with step 6).
9. Approve it with 2FA: `npm stage approve <id>`, or the Approve button on npmjs.com.
10. **Rebuild the site.** The `pages` workflow in `agentcurfew/agentcurfew.github.io` builds from the latest release tag. GitHub Pages disables scheduled workflows in a public repository after 60 days of no activity (roughly 2027-01-06 for this one), so trigger it by hand after each release: `gh workflow run pages.yml --ref main --repo agentcurfew/agentcurfew.github.io` (or Actions → pages → Run workflow). A scheduled watcher in R2 will eventually keep the daily run alive.
11. Check it: the package page on npmjs.com shows provenance from this repository and workflow; `npm audit signatures` in a project that installs it passes; the documentation site shows the new release.
12. Pin the GitHub Action in the README to the full commit SHA of the release; the action runs `agentcurfew@<version>` from npm from then on. `gh api repos/DevXord/agentcurfew/releases/tags/v<version> --jq .target_commitish` prints the SHA.

### Order of trusted-publisher changes

When the trusted-publisher configuration changes (environment, workflow name, user/organisation), add the new configuration on a release day and publish within 2 days; npm expires an unused configuration after 2 days. Keep the old one in place until the new publish is confirmed, then remove it.

## The first release (1.0.0): published by hand

Read again on 2026-11-07: a trusted publisher can be configured only for a package that already exists ("Package must exist", `npm/cli` docs of `npm trust`; the npmjs.com form sits in the package settings). So 1.0.0 cannot be staged by the workflow through OIDC. The maintainer publishes it from their own machine instead, from the tarball the workflow built and tested; it then has no provenance statement, and every later release does.

1. Push the tag `v1.0.0` as in "Every release". The job `build` tests and packs the tarball and prints its SHA-256; reject the job `publish` in the environment `npm`, since it cannot authenticate yet.
2. Download the artifact `package` of that run, unzip it, and check its SHA-256 against the run summary (`sha256sum agentcurfew-1.0.0.tgz`).
3. `npm login` (with 2FA), then `npm publish ./agentcurfew-1.0.0.tgz --access public --allow-file=all`, giving the one-time code when asked. The flag is needed inside this repository, whose `.npmrc` from depcurfew sets `allow-file=none` (npm then answers EALLOWFILE); a flag on the command line wins over `.npmrc` for that one command only. Seen on 2026-11-07: even this plain publish of a package that did not exist yet went through npm's staging, so the registry first showed a placeholder version `0.0.0-stage` (as `latest`) and, about two minutes later, 1.0.0 as `latest`; npm said "Your package is being processed and may take a few minutes to become available", and `npm view` answered 404 meanwhile. The placeholder stays in the version list: deprecate it with `npm deprecate agentcurfew@0.0.0-stage "<message>"`.
4. Check the package page on npmjs.com (version 1.0.0, README with logo and badges, homepage https://agentcurfew.github.io/) and `npm view agentcurfew version`, after a few minutes. 1.0.0 was published so on 2026-11-07 with the shasum of the tarball CI built (`0af21ade49e9802a5fc4aa879dfe0acfbf0f81cf`).
5. Set **Publishing access** to disallow tokens (step 4 of "Once, before the first release") right away. Add the trusted publisher (step 3), with stage publishing allowed, on the day of the next release, not now: a new configuration that sees no publish within 2 days expires. From 1.0.1 on, releases follow "Every release" with OIDC and provenance.
6. Optionally, create a GitHub release from the tag `v1.0.0` with the notes of [CHANGELOG.md](../CHANGELOG.md), so that the repository page shows it.

## Seen on the first release through the workflow (1.1.0, 2026-11-09)

- `npm stage publish` takes the tarball the job `build` tested, and the staged package keeps its provenance: the log of the job `publish` shows "Signed provenance statement with source and build information from GitHub Actions" and a transparency log entry. The SHA-1 shasum npm prints there can be compared with `npm stage download <id>`.
- npm 11.21.1 honors `min-release-age-exclude` for `npm install` but not for `npm exec`/`npx`; the action therefore uses `npm install` in a temporary folder, and a project with a release-age delay cannot run a new version through `npx` until it is older than the delay.

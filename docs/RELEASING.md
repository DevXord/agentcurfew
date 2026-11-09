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

## Every release

1. Make sure CI on `main` is green, including `agentcurfew verify .` and `depcurfew doctor`.
2. Write the user-facing notes in [CHANGELOG.md](../CHANGELOG.md).
3. Set the version without creating a tag: `npm version 1.0.0 --no-git-tag-version`, commit `package.json`, `package-lock.json` and `CHANGELOG.md`, and push.
4. Tag that commit and push the tag: `git tag -s v1.0.0 -m v1.0.0 && git push origin v1.0.0`.
5. The workflow checks that the tag matches the version, runs the tests, packs the tarball and prints its SHA-256.
6. Approve the job `publish` in GitHub (environment `npm`). It checks the tarball's SHA-256 and runs `npm stage publish`; nothing is public yet.
7. Inspect the staged package: `npm stage list agentcurfew`, `npm stage view <id>`, `npm stage download <id>` (compare its SHA-256 with step 5).
8. Approve it with 2FA: `npm stage approve <id>`, or the Approve button on npmjs.com.
9. Check it: the package page on npmjs.com shows provenance from this repository and workflow; `npm audit signatures` in a project that installs it passes.
10. Pin the GitHub Action in the README to the full commit SHA of the release; the action runs `agentcurfew@<version>` from npm from then on.

## The first release (1.0.0): published by hand

Read again on 2026-11-07: a trusted publisher can be configured only for a package that already exists ("Package must exist", `npm/cli` docs of `npm trust`; the npmjs.com form sits in the package settings). So 1.0.0 cannot be staged by the workflow through OIDC. The maintainer publishes it from their own machine instead, from the tarball the workflow built and tested; it then has no provenance statement, and every later release does.

1. Push the tag `v1.0.0` as in "Every release". The job `build` tests and packs the tarball and prints its SHA-256; reject the job `publish` in the environment `npm`, since it cannot authenticate yet.
2. Download the artifact `package` of that run, unzip it, and check its SHA-256 against the run summary (`sha256sum agentcurfew-1.0.0.tgz`).
3. `npm login` (with 2FA), then `npm publish ./agentcurfew-1.0.0.tgz --access public --allow-file=all`, giving the one-time code when asked. The flag is needed inside this repository, whose `.npmrc` from depcurfew sets `allow-file=none` (npm then answers EALLOWFILE); a flag on the command line wins over `.npmrc` for that one command only. Seen on 2026-11-07: even this plain publish of a package that did not exist yet went through npm's staging, so the registry first showed a placeholder version `0.0.0-stage` (as `latest`) and, about two minutes later, 1.0.0 as `latest`; npm said "Your package is being processed and may take a few minutes to become available", and `npm view` answered 404 meanwhile. The placeholder stays in the version list: deprecate it with `npm deprecate agentcurfew@0.0.0-stage "<message>"`.
4. Check the package page on npmjs.com (version 1.0.0, README with logo and badges, homepage https://agentcurfew.github.io/) and `npm view agentcurfew version`, after a few minutes. 1.0.0 was published so on 2026-11-07 with the shasum of the tarball CI built (`0af21ade49e9802a5fc4aa879dfe0acfbf0f81cf`).
5. Set **Publishing access** to disallow tokens (step 4 of "Once, before the first release") right away. Add the trusted publisher (step 3), with stage publishing allowed, on the day of the next release, not now: a new configuration that sees no publish within 2 days expires. From 1.0.1 on, releases follow "Every release" with OIDC and provenance.
6. Optionally, create a GitHub release from the tag `v1.0.0` with the notes of [CHANGELOG.md](../CHANGELOG.md), so that the repository page shows it.

## Open points for the first release

- `npm stage publish` is given the tarball built and tested by the job `build`. Whether staged publishing accepts a tarball, and whether the staged package keeps its provenance, is not stated in the documentation that was read; check it on the first run.
- npm 11.21.1 honors `min-release-age-exclude` for `npm install` but not for `npm exec` (seen on 2026-11-06); the action therefore uses `npm install` in a temporary folder.

# Releasing agentcurfew

agentcurfew is published from a version tag by `.github/workflows/release.yml`, with no npm token stored anywhere: the publish job authenticates with OIDC (npm trusted publishing), npm adds provenance, and the release passes two gates that need the maintainer: the GitHub environment `npm` and npm's staged publishing, approved with 2FA.

The first release is **1.0.0**, once phases 7 and 8 of [PLAN.md](PLAN.md) are done. Until then the version stays `0.0.0`, which the workflow refuses to publish.

Facts below come from npm's documentation sources (`npm/documentation`, `content/packages-and-modules/securing-your-code/trusted-publishers.mdx` and `staged-publishing.mdx`), read on 2026-11-06. Check them again before the first release: they change.

## Once, before the first release

1. **Name.** Check that `agentcurfew` is still free: `npm view agentcurfew` must answer E404 (it did on 2026-11-06).
2. **npm account.** Sign in to npmjs.com with two-factor authentication on.
3. **Trusted publisher.** In the package settings on npmjs.com, add a trusted publisher: GitHub Actions, organization or user `DevXord`, repository `agentcurfew`, workflow `release.yml`, environment `npm`. A new configuration must see a successful publish within 2 days, or it expires: add it on the day of the release.
   - The documentation does not say whether this works for a package that does not exist yet. If npmjs.com offers no settings for a package that was never published, stop and decide with Claude: the alternative is a first publish of the same tag with a granular token that can publish only this package and expires within a day, stored as a secret of the environment `npm` and deleted right after; the workflow would need `NODE_AUTH_TOKEN` for that one run.
4. **No tokens.** After the first publish, set the package's **Settings → Publishing access** to "Require two-factor authentication and disallow tokens".
5. **GitHub environment.** In the repository settings, create the environment `npm` with **Required reviewers** (the maintainer) and **Deployment branches and tags** limited to tags matching `v*`.
6. **Tag protection.** Add a ruleset for tags `v*` that only the maintainer can create, update or delete.

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

## Open points for the first release

- `npm stage publish` is given the tarball built and tested by the job `build`. Whether staged publishing accepts a tarball, and whether the staged package keeps its provenance, is not stated in the documentation that was read; check it on the first run.
- npm 11.21.1 honors `min-release-age-exclude` for `npm install` but not for `npm exec` (seen on 2026-11-06); the action therefore uses `npm install` in a temporary folder.

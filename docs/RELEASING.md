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

Read again on 2026-11-07: a trusted publisher can be configured only for a package that already exists ("Package must exist", `npm/cli` docs of `npm trust`; the npmjs.com form sits in the package settings). So 1.0.0 cannot be staged by the workflow through OIDC. The maintainer stages it from their own machine instead, from the tarball the workflow built and tested; it then has no provenance statement, and every later release does.

1. Push the tag `v1.0.0` as in "Every release". The job `build` tests and packs the tarball and prints its SHA-256; reject the job `publish` in the environment `npm`, since it cannot authenticate yet.
2. Download the artifact `package` of that run, unzip it, and check its SHA-256 against the run summary (`sha256sum agentcurfew-1.0.0.tgz`).
3. With npm 11.15.0 or later and Node 22.14.0 or later: `npm login` (2FA), then `npm stage publish ./agentcurfew-1.0.0.tgz --access public`. Staging a package that does not exist yet publishes a placeholder version `0.0.0-stage`; the staged 1.0.0 stays private until approved.
4. `npm stage list agentcurfew`, `npm stage view <id>`, then `npm stage approve <id>` with 2FA.
5. Now that the package exists, add the trusted publisher (step 3 of "Once, before the first release"), with stage publishing allowed, and set **Publishing access** to disallow tokens (step 4). From 1.0.1 on, releases follow "Every release" with OIDC and provenance.

## Open points for the first release

- `npm stage publish` is given the tarball built and tested by the job `build`. Whether staged publishing accepts a tarball, and whether the staged package keeps its provenance, is not stated in the documentation that was read; check it on the first run.
- npm 11.21.1 honors `min-release-age-exclude` for `npm install` but not for `npm exec` (seen on 2026-11-06); the action therefore uses `npm install` in a temporary folder.

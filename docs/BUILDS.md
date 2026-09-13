# Builds and downloads

Every component of this repository is built by the [`Build`](../.github/workflows/build.yml)
GitHub Actions workflow and published as a downloadable file.

| Component | Source | Produces |
| --- | --- | --- |
| CLI (`sc`) | repository root | `sc-<version>-<platform>.tar.gz` / `.zip` |
| Mock backend (`scalable-mock`) | `extra/mock` | `scalable-mock-<version>-<platform>.tar.gz` / `.zip` |
| Desktop app (Tauri) | `desktop` | `.deb`, `.rpm`, `.AppImage`, `.dmg`, `.msi`, `-setup.exe` |

Platforms: `linux-x86_64`, `linux-aarch64`, `macos-aarch64`, `macos-x86_64`,
`windows-x86_64`.

## Where the downloads are

**Every build — Actions artifacts.** Open the repository's *Actions* tab, pick a
run of the `Build` workflow and scroll to *Artifacts*. Artifacts are named
`pkg-cli-<platform>`, `pkg-mock-<platform>` and `pkg-desktop-<platform>`.
Downloading them requires being signed in to GitHub, and they expire after the
repository's artifact retention period.

**Releases — permanent links.** Pushing a tag that starts with `v` builds
everything and creates a GitHub Release with all files attached plus a
`SHA256SUMS.txt`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

**Rolling `dev` pre-release.** Run the workflow manually (*Actions* → *Build* →
*Run workflow*) on any branch and tick *Publish the build as the rolling 'dev'
pre-release*. The previous `dev` release and its tag are replaced by the new
build, so `…/releases/tag/dev` is always the latest manual build.

## When the workflow runs

- pushes to `main`, `dev-main`, `feature/**`, `release/**`, `claude/**`
- pushes of `v*` tags (additionally publishes a release)
- every pull request
- manual runs (`workflow_dispatch`), optionally publishing the `dev` pre-release

## The desktop app ships the CLI

`desktop/src-tauri/src/sc.rs` only accepts the `sc` binary that sits next to the
app executable in release builds, so `sc` is bundled as a Tauri sidecar
(`bundle.externalBin` in `desktop/src-tauri/tauri.conf.json`). The workflow
builds the CLI first and stages the matching binary at
`desktop/src-tauri/binaries/sc-<target-triple>` before bundling.

For a local desktop build, stage it the same way — this builds `sc` in release
mode if needed and copies it into place:

```bash
cd desktop
npm ci
npm run sidecar
npm run tauri -- build
```

`npm run sidecar` is also required before `npm run tauri -- dev`, because Tauri
refuses to start when a declared sidecar is missing.

## Notes on the artifacts

- Binaries and installers are **unsigned and unnotarized**. macOS will refuse to
  open the `.dmg` contents until they are cleared in *System Settings → Privacy
  & Security*, and Windows SmartScreen will warn about the installer. Official,
  signed Scalable builds come from the upstream releases page.
- The CLI is built with the repository's default channel (`TargetEnv::Dev`,
  endpoints from `config/dev-channel.toml`). It talks to the same production
  endpoints as a `--features channel-prod` build and honours `SC_MOCK` /
  `SC_GRAPHQL_URL`, but stores its session under the `dev` namespace.
- Linux `aarch64` desktop builds skip the AppImage bundle; use the `.deb` or
  `.rpm` there.
- The macOS `x86_64` binaries are cross-compiled on an arm64 runner, so they are
  built but not smoke-tested in CI.

# Third-Party Notices

ApiOne Studio is [MIT](LICENSE) licensed. Everything it depends on is permissively licensed
(MIT / Apache-2.0 / BSD-3-Clause / ISC / OFL-1.1) — none copyleft.

Dependencies keep their own license files inside `node_modules`, which the Docker image ships as
installed. The three components below are redistributed from outside that tree, so their licenses
are carried explicitly.

## oasdiff — Apache-2.0

The breaking-change engine. The Dockerfile downloads a pinned release binary from
[oasdiff/oasdiff](https://github.com/oasdiff/oasdiff) and copies it into the runtime image, with its
license alongside at `/usr/local/share/oasdiff/`.

The application does not link against it and runs without it — the breaking-change report just says
it is unavailable.

## Fonts — SIL Open Font License 1.1

The web build ships these as `.woff2`. The full license text is in
[`licenses/OFL-1.1.txt`](licenses/OFL-1.1.txt), which the image carries alongside the assets.

| Font           | Package                               | Copyright                                         |
| -------------- | ------------------------------------- | ------------------------------------------------- |
| Hanken Grotesk | `@fontsource-variable/hanken-grotesk` | Copyright 2021 The Hanken Grotesk Project Authors |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` | Copyright 2020 The JetBrains Mono Project Authors |

CJK text falls back to fonts already on the reader's system (PingFang SC / Hiragino Sans / Microsoft
YaHei / Noto Sans CJK). Those are named, never redistributed.

## Scalar's browser bundle — MIT

The docs view and the offline HTML export are rendered by `@scalar/api-reference`. The server build
copies its browser bundle into `dist/assets` and the runtime image prunes the package, so nothing
would carry the notice — and the package publishes no license file of its own. The text in
[`apps/server/licenses/scalar.LICENSE.txt`](apps/server/licenses/scalar.LICENSE.txt) is copied beside the bundle at build
time.

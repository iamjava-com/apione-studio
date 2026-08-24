<p align="center">
  <img alt="" src=".github/assets/logo.png" width="56" height="56" />
</p>

<h1 align="center">ApiOne Studio</h1>

<p align="center">
  OpenAPI-first. Design, Docs and Mock in one place.
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

![The ApiOne Studio design view](.github/assets/demo.png)

## What it is

An OpenAPI-first API platform. It takes your OpenAPI files and adds a form and YAML editor, version
history, a mock server and user management on top.

## Features

- **Design** — a form editor and a YAML editor, kept in sync as you type.
- **Mock** — responses generated from the schema, or from your own JavaScript, run in a sandbox.
- **Docs** — rendered with [Scalar](https://github.com/scalar/scalar).
- **Versioning** — every save is numbered and attributed. Diff any two, restore any one.
- **Collaboration** — multiple projects, multiple roles, conflict warnings.
- **Interface languages** — English, 简体中文, 日本語 and more.
- **Import / export** — OpenAPI 3, Swagger 2 and Postman collections in; YAML, JSON and offline HTML
  out.
- **API access** — an Agent Skill is included, so you can hand an API token to your own AI agent, or
  drive the API yourself.

## Quick start

### Docker

```bash
docker run -d -p 4100:4100 -v apione-data:/data ghcr.io/iamjava-com/apione-studio
```

### Node

```bash
npm run setup
npm run build
npm start
```

Open <http://localhost:4100>.

## Development

Requires **Node 24**

```bash
npm run setup   # installs apps/server and apps/web
npm run dev     # server on :4100, web on :5173
```

Open <http://localhost:5173>.

## License

[MIT](LICENSE)

[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

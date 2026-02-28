# JSCAD Server (Vanilla)

Simple Node.js server that serves `web/` as a static site and provides a custom browser JSCAD builder/editor with:

- Monaco (VS Code-like) editor
- Live preview in the browser (Three.js)
- JSCAD API hints/autocomplete
- Import/export source code
- Export rendered geometry as STL

## Run

```bash
npm install
node server.js
# then open http://localhost:3000
```

Or:

```bash
npm start
```

Development mode with auto-reload on `web/` changes:

```bash
npm run dev
```

## Pages

- Browser editor (existing): `http://localhost:3000/`
- Server render preview (new): `http://localhost:3000/server-preview.html`

The server preview page renders code files from `models/` on Node.js using JSCAD, then returns STL to the browser for preview.

## Remote STL API

Render JSCAD source remotely and get an STL file response:

- Endpoint: `POST /api/render-stl`
- Request body:
  - `application/json`: `{ "code": "...jscad...", "filename": "part.stl" }`
  - `text/plain`: raw JSCAD code
- Response: `200` with `model/stl` body and attachment filename

Example JSON request:

```bash
curl -X POST http://localhost:3000/api/render-stl \
  -H 'Content-Type: application/json' \
  -d '{"filename":"remote-part.stl","code":"const { cuboid } = primitives; function main(){ return cuboid({ size:[20,20,20] }) } return main()"}' \
  -o remote-part.stl
```

Example plain text request:

```bash
curl -X POST http://localhost:3000/api/render-stl \
  -H 'Content-Type: text/plain' \
  --data-binary 'const { sphere } = primitives; function main(){ return sphere({ radius: 12 }) } return main()' \
  -o sphere.stl
```

## Notes

- No React, no frontend framework.
- Frontend libraries are loaded via CDN at runtime.

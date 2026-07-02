// src/client/** files are bundled by wrangler as Text modules (see the
// [[rules]] block in wrangler.toml) and served by src/routes/assets.ts.
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.js' {
  const text: string;
  export default text;
}

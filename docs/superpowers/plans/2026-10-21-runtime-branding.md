# Runtime console branding

User requests an environment-configurable console name, navigation footer domain/logo, favicon and clickable brand
link to the console homepage. Preserve the existing default name; provide a distinct bundled console symbol and support
public custom assets. Settings are server runtime environment values, not Vite build variables.

- CONSOLE_NAME (default LiveKit Console), CONSOLE_DOMAIN (default current browser host), CONSOLE_LOGO_URL (default
  bundled /brand.svg), CONSOLE_FAVICON_URL (default logo URL). Domain accepts a host or HTTP(S) origin only.
- Public /branding.json exposes these display fields only. Validate public same-origin paths/HTTPS image URLs and
  domain origins; reject script/data/protocol-relative URLs and embedded credentials. Never fetch asset URLs server-side.
- Shared brand component on shell/login links to `/`; footer includes mark and domain. Responsive collapsed footer
  remains an accessible icon link. Browser title/favicon reflect runtime settings; initial production HTML uses them too.
- Verify validation/public safe response, HTML escaping, custom branding/title/favicon, logo home navigation, footer,
  collapsed/mobile/theme rendering and broken-image fallback. Build/review/protected PR/deploy; preserve v0.1.0 tag.
- Report official LiveKit Cloud terms/trademark boundaries separately. No further Cloud bundle capture for this task.

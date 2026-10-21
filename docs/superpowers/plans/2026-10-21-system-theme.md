# Final appearance phase

Approved scope: top-header Light/Dark/System control, system default, explicit choice persisted across navigation and
reloads, automatic OS updates only while System is selected. Both palettes cover all shared components and charts.
No layout redesign. The combined production release follows all acceptance checks; no intermediate release.

1. Add meaningful Chrome coverage for initial OS resolution, manual override, live OS changes, reload/navigation,
   cross-tab preference updates, keyboard controls, responsive layout, contrast, forms/dialogs/charts and recordings.
2. Add a small blocking public bootstrap before CSS/React: validate stored preference, resolve matchMedia, set root
   data attributes/color-scheme; tolerate blocked storage; listen to OS/storage changes. React subscribes to changes.
3. Add an accessible three-button appearance control to every PageHeader and login. Keep refresh and time controls.
4. Add light semantic tokens; preserve dark values; replace fixed chart colors and alert/button colors where necessary.
5. Build, run browser regressions and inspect screenshots in both themes, review, protected merge/deploy/live checks.
6. Update both parity checklists. Only then prepare the single combined production release.

## Local acceptance

Web/server builds pass; Chrome administration/theme suite9/9 and RTC/deployment suite7/7, zero page errors.
Tests cover System default/live OS updates, explicit override persistence, reload/navigation/storage updates,
keyboard actions, mobile layout, charts/dialogs/recording controls, pre-React resolution and disabled storage.
Measured normal text/status contrast >=4.5:1 and chart/form-boundary contrast >=3:1 in both palettes.
Independent review found and verified the form-border fix. Screenshots inspected for light desktop and dark mobile.
Live theme verification and combined production release follow protected CI/deployment.

## Live acceptance

Protected PR #28 merged and deployed. System follows live OS changes; explicit choices survive reload and OS updates.
Light/dark across eleven console pages, mobile forms/dialogs and absence of project state passed with zero page errors.
All phases are verified; the single combined production release can now be prepared.

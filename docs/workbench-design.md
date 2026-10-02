# Workbench interface

The workbench uses a neutral dark or white appearance, orange actions and a small split-A mark. IBM Plex Sans carries labels and explanations; IBM Plex Mono carries identifiers and exact integer values. Fonts are bundled locally. Sections use dividers, aligned tables and modest corner radii. Verdicts always include a word and an icon.

The layout was informed by [Linear’s interface redesign and screen comparisons](https://linear.app/now/how-we-redesigned-the-linear-ui). Its separation of navigation, working content and properties guided the workbench structure. Linear screenshots and brand assets are references, not distributed assets.

## Controls

- **Dark / White** in the top bar changes every view and remembers the choice in this browser. A small same-origin script restores it before the app renders, within the API’s existing content security policy.
- **Ctrl K / ⌘ K** opens workspace search. Search pages, run IDs, case IDs or capture IDs; use arrows and Enter to open a result, or Escape to close it.
- The overview connects an actual incident to its recording, campaign, reductions, comparison and export. Links follow registered case IDs, including nested reductions.
- Run details have **Summary**, **Source & files** and **Run log** tabs. Arrow keys, Home and End move between tabs.
- A source input opens its signature, hash, decoded event identities, mint and amounts. Full records and raw bytes remain available in disclosures. Closing the inspector returns focus to that input.
- At narrow widths, navigation becomes a modal drawer and evidence tables scroll inside their section. Reduced-motion preferences disable transitions and animated indicators.

Campaign outcome cells choose the latest execution or saved comparison for that case and variant. A previous passing comparison cannot hide a later failed or active campaign. Expired sessions return to the connection screen; network and malformed-response errors use readable messages without reflecting transport details.

Amounts remain exact decimal integers. Source labels, exclusions, coverage and required-fault evidence are preserved. The redesign does not extend the maintained-sample execution scope or establish chain completeness.

## Verification

The October 2, 2026 update passed `pnpm check` (88 tests, including seven workbench regressions), TypeScript checking and `pnpm build:workbench`. Browser checks covered both appearances, white-mode persistence after refresh, saved incident navigation, keyboard search and tabs, source inspection, mobile navigation and horizontal containment. An offline fixed campaign on an existing reduced mainnet case passed with its required process termination applied; progress and the final result survived refresh. No fresh provider recording was required for the redesign.

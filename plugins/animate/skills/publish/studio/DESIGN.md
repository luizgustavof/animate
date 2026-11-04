---
name: Estúdio
description: A quiet dark studio for the posting schedule (began as a split-flap board; the retro dressing was removed at the user's request).
colors:
  flap: "#0d0d0f"
  flap-raised: "#1b1b1e"
  flap-hover: "#26262b"
  rule: "#2e2f35"
  ink: "#f2f2f2"
  ink-secondary: "#b9bcc2"
  ink-label: "#8a8f98"
  delay-amber: "#ffb400"
  amber-ink: "#1a1200"
  cancelled-red: "#ff4b45"
  steel: "#b6bbc2"
  steel-mid: "#7d838c"
  steel-deep: "#4a4f57"
typography:
  flap:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
  label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.14em"
  caps:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "0.08em"
  title:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 600
    letterSpacing: "0.06em"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  flap: "2px"
  none: "0px"
spacing:
  row-gap: "3px"
  cell: "12px"
  block: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.delay-amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "0 16px"
  button-frame:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "0 16px"
  flap-cell:
    backgroundColor: "{colors.flap-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.flap}"
    rounded: "{rounded.flap}"
  board-row:
    backgroundColor: "{colors.flap-raised}"
    textColor: "{colors.ink}"
    padding: "10px 12px"
  input:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
---

# Design System: Estúdio

> **2026-11-04, user direction:** "less VHS". The board structure, the colors and the one-amber rule stay; the retro dressing is gone:
> no per-letter flap cells, no brushed-steel or grain textures, no split hairlines or hinge pins, no condensed letter-spaced caps
> for titles. Type is Barlow throughout (700 for headings, sentence case). Buttons, fields and panels round 4–8px. `<Flap>` is now
> plain type that rises in when its value changes. Navigation is a left sidebar. Class names (`steel`, `flap-row`, `Flap`) are
> kept for code stability; read the sections below for structure and color, and this note for the look.

## Overview
A railway concourse departure board, working. Every screen is a board hung in a brushed-steel frame. Episodes are rows that
leave at a time for their destinations (platforms), and statuses are words painted on flaps that turn when they change. It is
dark because it is a lit board in a dim concourse, and because the episodes' own frames have to read true beside it. The
content (episode frames, titles, times) carries the color; the chrome is black, white, steel, and one amber.

## Colors
Restrained strategy: a neutral board, one signal accent, one failure color.

### Primary
- **delay-amber `#ffb400`**: means *time, attention, the one thing to do*. Scheduled times, active tab marks, the primary button,
  the selected candidate, an upload in progress. Never decoration.

### Neutral
- **flap `#0d0d0f`** is the page ground. **flap-raised `#1b1b1e`** is every flap and row face. **rule `#2e2f35`** draws cell and field edges.
- **ink `#f2f2f2`** is flap paint. **ink-secondary `#b9bcc2`** and **ink-label `#8a8f98`** are steel-tinted, never neutral gray (≥4.5:1 on flap).
- **steel** tones are only the frame: the header and the board surround.

### Tertiary
- **cancelled-red `#ff4b45`**: failures and blocking errors only (lifted from the board's #D32F2F for AA on black).

### Named Rules
- **Amber is a promise.** If it is amber, it is either a time, the active thing, or the next click. A second amber element on a screen must be the same idea.
- **Status lives in words.** NO AR, AGENDADO, PRONTO, SEM TEXTO, FALHOU: painted flap words, not colored pills.

## Typography
Big Shoulders Display (800) in flap cells for every short board token: screen names, times, codes, statuses, percentages.
Barlow Condensed for labels and row titles in caps. Barlow for sentences, help text and editable copy. Tabular numerals everywhere.

### Hierarchy
- Screen name: flap cells, `lg` (2.3rem glyphs). Progress percentage: `xl`.
- Row title / episode name: Barlow Condensed 600, uppercase, 1.2rem (2rem in the episode header).
- Labels: Barlow Condensed 600, 0.72rem, 0.14em tracking, uppercase, ink-label.
- Body: Barlow 400, 1rem–1.05rem, line-height 1.6, measure ≤62ch.

### Named Rules
- **Flaps for tokens, never for sentences.** A flap cell holds a character of a short code; a sentence on flaps is unreadable.

## Layout
One centered column, max 1600px, 24px gutters (16px under 640px). Boards are full-width tables with 3px gaps between rows (the
rows are separate flaps). The episode is two columns from 1024px: frame and facts left (≤340px, sticky), work right.
Tables scroll sideways inside their frame under ~900px rather than collapsing columns.

## Elevation & Depth
Physical, shallow: a board sits in its frame with `0 10px 30px rgb(0 0 0 / .45)`; the header casts `0 2px 10px rgb(0 0 0 / .5)`;
flap cells carry a 1px top highlight and a 1–2px drop. The split hairline across every flap face is the signature depth cue.

## Shapes
Square. Flap cells round 2px (the physical flap edge); everything else, buttons, fields, rows, panels, is 0. Lamps are the only circles.

## Components

### Buttons
Framed caps panels: Barlow Condensed 600 uppercase, 0.12em tracking, a drawn arrow or verb icon at the end. **Primary** is solid
amber with near-black text (one per view). **Frame** is black with a steel-deep border that turns ink on hover and amber when
pressed. **Quiet** has no border. Busy state swaps the icon for a blinking square lamp.

### Inputs / Fields
Black field, 1px rule border, steel-deep on hover, amber on focus, amber caret. The label sits above in label type, and its
counter on the right goes amber over the soft limit and red over the hard one.

### Navigation
A left sidebar (248px, a 76px rail of number keys under 1024px), dark `#121215` with a rule on its right. One item per screen: a
number-key square (1/2/3, amber when active), the name, and a live line saying what's on it ("1 pronto · 5 sem texto"). The active
item's background and amber left bar glide between items. Inside an episode its own item (code + title + Voltar/Esc) opens under
Partidas. Keys: `1` `2` `3` (or `G` then `P`/`C`/`D`); `Esc` leaves an episode. No logo, clock or status lamp.

### Flap (signature)
`<Flap text cells size tone>`: one cell per character, face split by a hairline with two hinge pins. When the text changes,
only changed cells turn (260ms, staggered 26ms left to right). A board cascades once per visit; reduced motion turns nothing.

### Board row
A row is one long flap (textured face, split hairline): time flap · 9:16 episode frame + code + title · channel code · platform
codes · status flap (10 cells) · arrow. The whole row opens the episode; brightness lifts on hover.

### Lamp
A 10px painted bulb (amber, red, green, white, off), blinking in two steps while work runs. Not a glow: a lit object.

## Do's and Don'ts

### Do:
- Put the episode's own frame wherever an episode is named.
- Say the destination, the channel and the time in words right before anything leaves.
- Keep surfaces flat: solid dark fills and 1px rules, no textures.

### Don't:
- Sidebar + metric cards + charts: the SaaS dashboard shape this world exists to refuse.
- Colored status pills, gradients on text, glow halos, rounded cards.
- A second accent color, or amber used as decoration.
- Flap cells for long titles or sentences.

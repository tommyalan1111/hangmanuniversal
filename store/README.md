# Google Play store assets — Hangman Universal

Generated from the current build (viewport 450×800 @2.4x, file:// build).

## Files

| File | Size | Notes |
|---|---|---|
| `play-icon-512.png` | 512×512 | 24-bit PNG, no transparency |
| `feature-graphic-1024x500.png` | 1024×500 | 24-bit PNG, no transparency |
| `screenshots/01-home.png` | 1080×1920 | 9:16 phone screenshot |
| `screenshots/02-play.png` | 1080×1920 | 9:16 phone screenshot |
| `screenshots/03-play-mid.png` | 1080×1920 | 9:16 phone screenshot |
| `screenshots/04-win.png` | 1080×1920 | 9:16 phone screenshot |
| `screenshots/05-categories.png` | 1080×1920 | 9:16 phone screenshot |

## Upload order

1. App icon → `play-icon-512.png`
2. Feature graphic → `feature-graphic-1024x500.png`
3. Phone screenshots → `screenshots/01-home.png` … `05-categories.png`

## Notes

- The app currently has **21 topics** and **7,384 questions** (shown on the
  categories screen and home stats).
- "Remove Ads" is implemented with Google Play Billing (one-time product ID
  `remove_ads`). The button is hidden in these screenshots; on a real build it
  appears only after the product loads successfully, showing the localized
  Play price.
- Screenshots are raw app screens (no device frame, no marketing text).
- Regenerate after UI changes: capture at 450×800 @2.4x, or resize to
  1080×1920 keeping the 9:16 ratio.

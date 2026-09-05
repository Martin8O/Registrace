import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// The one card design, shared by the site-wide preview image and the per-event
// one, so a change to the branding cannot land on only half the links.
//
// Facebook's and X's stated size; every other client scales from it.
export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

// The card is the event PAGE, cropped — not a poster in BDC's own livery. Same
// warm off-white ground, same dark serif heading, same short crimson rule under
// it, same muted supporting line. A crimson field would have been a louder,
// prettier card that looked like somebody else's site; this one looks like the
// page the link actually opens, which is the only thing a preview is for.
const GROUND = '#FAF8F4' // stone-100 — the body background
const INK = '#221E1A' // neutral-900 — the heading colour
const MUTED = '#645B50' // neutral-600 — body text
const FAINT = '#A89E90' // neutral-400 — the page's small uppercase labels
const CRIMSON = '#A51A2E' // primary-500 — used only as the accent it is on the page

// The logo is deliberately absent: public/images/bdc_logo_2.jpg is a JPEG on a
// white ground, which the site hides with `mix-blend-mode: multiply`. Satori does
// not implement blend modes, so it would sit on the beige as a white rectangle.
// Type-only beats a broken logo.

// Satori rasterises with the fonts it is handed and nothing else — it has no
// access to the app's next/font faces. Crimson Pro SemiBold is committed under
// assets/ (SIL OFL, licence beside it) so the card carries the site's own serif.
// Read once per instance, not once per image.
let serif: Promise<ArrayBuffer | null> | undefined

function loadSerif(): Promise<ArrayBuffer | null> {
  serif ??= readFile(join(process.cwd(), 'assets', 'CrimsonPro-SemiBold.ttf'))
    .then((buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    .catch((error: unknown) => {
      // A file the deployment failed to carry must not 500 the route: no image
      // at all is worse than the wrong typeface. Falling through to no `fonts`
      // option leaves Satori on its bundled Geist, which — checked, not assumed —
      // carries the Czech diacritics, so the card still reads correctly.
      console.error('[og] Crimson Pro unavailable, falling back to the bundled face', error)
      return null
    })
  return serif
}

export type OgCardContent = {
  /** Small gold line above the title — the hosting centre. */
  eyebrow?: string
  /** The card's one strong line. */
  title: string
  /** Gold line at the foot — the dates, or the site's own description. */
  footnote: string
  /** Bottom-right watermark. */
  siteName: string
}

export async function renderOgCard({
  eyebrow,
  title,
  footnote,
  siteName,
}: OgCardContent): Promise<ImageResponse> {
  const font = await loadSerif()

  // A long event name must shrink rather than run off the card; titles are capped
  // at 200 characters by validation, and three lines at 44px still fit.
  const titleSize = title.length > 90 ? 50 : title.length > 55 ? 62 : 76

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: GROUND,
          color: INK,
          fontFamily: '"Crimson Pro", Georgia, serif',
        }}
      >
        {/* The one crimson edge the site itself has: the sticky header's bottom
            border. Without it a beige card floats shapelessly in a chat window,
            which is usually white — this gives it a top and a brand in one line
            that shouts at nobody. */}
        <div style={{ height: 10, backgroundColor: CRIMSON }} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            justifyContent: 'center',
            padding: '0 84px',
          }}
        >
          {eyebrow ? (
            // The page's own small-label treatment — uppercase, widely tracked —
            // in crimson rather than the page's grey, because here it is the
            // card's only colour above the rule and it says WHERE.
            <div
              style={{
                fontSize: 28,
                letterSpacing: 8,
                textTransform: 'uppercase',
                color: CRIMSON,
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div
            style={{
              fontSize: titleSize,
              lineHeight: 1.18,
              fontWeight: 600,
              marginTop: eyebrow ? 20 : 0,
            }}
          >
            {title}
          </div>
          {/* The short crimson rule that sits under the page's own <h1>. */}
          <div
            style={{ width: 100, height: 6, borderRadius: 3, backgroundColor: CRIMSON, marginTop: 30 }}
          />
          <div style={{ fontSize: 40, color: MUTED, marginTop: 28 }}>{footnote}</div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            padding: '0 84px 54px',
            fontSize: 26,
            color: FAINT,
          }}
        >
          {siteName}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      // Omitted entirely when the file is missing — an empty `fonts` array is not
      // the same as no option, and would leave Satori with nothing to draw with.
      ...(font
        ? { fonts: [{ name: 'Crimson Pro', data: font, style: 'normal' as const, weight: 600 as const }] }
        : {}),
    },
  )
}

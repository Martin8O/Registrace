import { getTranslations } from 'next-intl/server'

// The admin help page: six task recipes, in Czech only (a product decision —
// see i18n/request.ts). The texts are the `help.page` messages; this file only
// lays them out. Each recipe is an ordered list of blocks, and every string in
// it may carry <b>, <i> and <k> (a UI label, drawn as a key cap).
//
// The "?" hints on the admin screens link here by anchor (#zaklady … #seznam).

type Step = { title: string; chip: 'open' | 'locked' | 'check' | 'decide'; text: string }
type Card = { title: string; rows?: [string, string][]; sum?: [string, string]; note?: string }
type Table = { caption: string; head: string[]; rows: string[][] }
type Block =
  | { p: string }
  | { h: string }
  | { ul: string[] }
  | { callout: string }
  | { small: string }
  | { steps: Step[] }
  | { cards: Card[] }
  | { table: Table }
type Recipe = { id: string; title: string; blocks: Block[] }

const CHIP_CLASS: Record<Step['chip'], string> = {
  open: 'border-success-100 bg-success-50 text-success-700',
  locked: 'border-neutral-200 bg-neutral-50 text-neutral-600',
  check: 'border-neutral-200 bg-neutral-50 text-neutral-600',
  decide: 'border-neutral-200 bg-neutral-50 text-neutral-600',
}

export async function generateMetadata() {
  const t = await getTranslations('help.page')
  return { title: t('title') }
}

export default async function HelpPage() {
  const t = await getTranslations('help.page')
  const tags = {
    b: (chunks: React.ReactNode) => <strong className="font-semibold text-neutral-900">{chunks}</strong>,
    i: (chunks: React.ReactNode) => <em>{chunks}</em>,
    k: (chunks: React.ReactNode) => (
      <span className="whitespace-nowrap rounded border border-neutral-200 bg-neutral-50 px-1.5 py-px text-[13px] font-medium text-neutral-800">
        {chunks}
      </span>
    ),
  }
  const rich = (path: string) => t.rich(path, tags)
  const recipes = t.raw('recipes') as Recipe[]

  const chip = (kind: Step['chip']) => (
    <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHIP_CLASS[kind]}`}>
      {t(`chips.${kind}`)}
    </span>
  )

  function renderBlock(block: Block, path: string) {
    if ('p' in block) return <p>{rich(`${path}.p`)}</p>
    if ('h' in block) return <h3 className="pt-1 text-[15px] font-semibold text-neutral-900">{rich(`${path}.h`)}</h3>
    if ('small' in block) return <p className="text-[13px] text-neutral-500">{rich(`${path}.small`)}</p>
    if ('callout' in block) {
      return (
        <div className="rounded-r-lg border-l-[3px] border-primary-500 bg-primary-50 px-4 py-3 text-sm">
          {rich(`${path}.callout`)}
        </div>
      )
    }
    if ('ul' in block) {
      return (
        <ul className="list-disc space-y-2.5 pl-5">
          {block.ul.map((_, i) => (
            <li key={i}>{rich(`${path}.ul.${i}`)}</li>
          ))}
        </ul>
      )
    }
    if ('steps' in block) {
      return (
        <div className="space-y-2">
          <ol className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            {block.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto]">
                <span className="font-mono text-xs leading-6 text-neutral-400">{i + 1}</span>
                <span className="font-semibold text-neutral-900">{rich(`${path}.steps.${i}.title`)}</span>
                <span className="col-start-2 sm:col-start-3 sm:row-start-1">{chip(s.chip)}</span>
                <span className="col-start-2 text-sm text-neutral-600">{rich(`${path}.steps.${i}.text`)}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-neutral-600">
            <span className="flex items-center gap-2">{chip('open')} {t('legend.open')}</span>
            <span className="flex items-center gap-2">{chip('locked')} {t('legend.locked')}</span>
          </div>
        </div>
      )
    }
    if ('cards' in block) {
      return (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {block.cards.map((c, i) => (
            <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {rich(`${path}.cards.${i}.title`)}
              </p>
              {c.rows && (
                <div className="space-y-1.5 font-mono text-[13px] tabular-nums text-neutral-700">
                  {c.rows.map(([label, value], j) => (
                    <div key={j} className="flex justify-between gap-4">
                      <span>{label}</span>
                      <span>{value}</span>
                    </div>
                  ))}
                  {c.sum && (
                    <div className="flex justify-between gap-4 border-t border-dashed border-neutral-300 pt-1.5 font-medium text-neutral-900">
                      <span>{c.sum[0]}</span>
                      <span className="text-primary-600">{c.sum[1]}</span>
                    </div>
                  )}
                </div>
              )}
              {c.note && (
                <p className={`text-[13px] text-neutral-600 ${c.rows ? 'mt-3' : ''}`}>
                  {rich(`${path}.cards.${i}.note`)}
                </p>
              )}
            </div>
          ))}
        </div>
      )
    }
    // table
    const table = block.table
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {table.caption && (
            <caption className="pb-2 text-left text-[13px] text-neutral-500">{table.caption}</caption>
          )}
          <thead>
            <tr>
              {table.head.map((h, i) => (
                <th key={i} className="border border-neutral-200 bg-stone-200 px-3 py-2 text-left text-xs font-semibold text-neutral-800">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`border border-neutral-200 bg-white px-3 py-2 ${
                      /^\d+$/.test(cell) ? 'text-right font-mono tabular-nums' : ''
                    } ${c === 0 && table.head.length === 2 ? 'font-semibold text-neutral-900' : ''}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div lang="cs" className="text-[15px] leading-relaxed text-neutral-700">
      <header>
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">{t('title')}</h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        <p className="mt-4 max-w-[62ch] text-neutral-600">{t('lede')}</p>
      </header>

      <section className="mt-7 flex max-w-[72ch] gap-4 rounded-2xl border border-gold-300 bg-gold-50 p-5 sm:p-6">
        <svg className="mt-0.5 shrink-0 text-gold-800" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        </svg>
        <div className="min-w-0 space-y-2">
          <h2 className="font-serif text-xl font-semibold text-neutral-900">{t('lock.title')}</h2>
          <p>{rich('lock.p1')}</p>
          <p>{rich('lock.p2')}</p>
        </div>
      </section>

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label={t('tocTitle')} className="text-sm lg:sticky lg:top-8 lg:self-start">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-neutral-400">{t('tocTitle')}</p>
          <ol className="space-y-0.5">
            {recipes.map((r, i) => (
              <li key={r.id}>
                <a
                  href={`#${r.id}`}
                  className="flex gap-2.5 rounded-md px-2.5 py-1.5 text-neutral-600 transition hover:bg-stone-200 hover:text-neutral-900"
                >
                  <span className="font-mono text-[11px] leading-6 text-neutral-400">{i + 1}</span>
                  {r.title}
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-neutral-200 pt-3.5 text-[13px] text-neutral-500">
            {t.rich('tocAfter', {
              mail: (chunks) => (
                <a href={`mailto:${chunks}`} className="inline-block text-primary-600 underline underline-offset-2 hover:text-primary-700">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </nav>

        <div className="min-w-0 space-y-14">
          {recipes.map((r, ri) => (
            <article key={r.id} id={r.id} className="scroll-mt-6">
              <header className="mb-5 flex items-baseline gap-3 border-b border-neutral-200 pb-3">
                <span className="shrink-0 rounded-md border border-primary-100 bg-primary-50 px-2 py-0.5 font-mono text-[13px] text-primary-500">
                  {ri + 1}
                </span>
                <h2 className="font-serif text-2xl font-semibold text-neutral-900">{r.title}</h2>
              </header>
              <div className="flex max-w-[66ch] flex-col gap-3.5">
                {r.blocks.map((b, bi) => (
                  <div key={bi}>{renderBlock(b, `recipes.${ri}.blocks.${bi}`)}</div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      <p className="mt-16 max-w-[66ch] border-t border-neutral-200 pt-5 text-sm text-neutral-500">{t('footer')}</p>
    </div>
  )
}

export type EventCenter = {
  name: string
  city: string
  email: string
  phone: string
}

export type MockEvent = {
  id: string
  title_cs: string
  title_en: string
  subtitle_cs: string | null
  subtitle_en: string | null
  description_cs: string
  description_en: string
  startDate: string
  endDate: string
  status: 'PUBLISHED' | 'CLOSED' | 'ARCHIVED' | 'DRAFT'
  center: EventCenter
}

export const mockEvents: MockEvent[] = [
  {
    id: 'evt-001',
    title_cs: 'Meditační retreat',
    title_en: 'Meditation Retreat',
    subtitle_cs: 'Otevřený pro všechny',
    subtitle_en: 'Open to everyone',
    description_cs:
      'Týdenní pobytový retreat zaměřený na meditaci na Buddhu Diamantové cesty. Vhodný pro začátečníky i zkušené praktikující.',
    description_en:
      'A week-long residential retreat focused on Diamond Way Buddhist meditation. Suitable for both newcomers and experienced practitioners.',
    startDate: '2026-09-05',
    endDate: '2026-09-12',
    status: 'PUBLISHED',
    center: {
      name: 'Tenovice',
      city: 'Spálené Poříčí',
      email: 'tenovice@bdc.cz',
      phone: '+420 377 123 456',
    },
  },
  {
    id: 'evt-002',
    title_cs: 'Víkendová praxe',
    title_en: 'Weekend Practice',
    subtitle_cs: null,
    subtitle_en: null,
    description_cs:
      'Víkend společné meditace a přednášek v městském centru. Registrace je již uzavřena.',
    description_en:
      'A weekend of group meditation and talks at the city centre. Registration is now closed.',
    startDate: '2026-06-14',
    endDate: '2026-06-16',
    status: 'CLOSED',
    center: {
      name: 'Praha',
      city: 'Praha',
      email: 'praha@bdc.cz',
      phone: '+420 222 111 222',
    },
  },
  {
    id: 'evt-003',
    title_cs: 'Roční kurz meditace',
    title_en: 'Annual Meditation Course',
    subtitle_cs: 'Archivní záznam',
    subtitle_en: 'Archived record',
    description_cs:
      'Roční cyklus pravidelných setkání a vedených meditací. Archivovaný záznam z minulého ročníku.',
    description_en:
      'A year-long cycle of regular meetings and guided meditations. Archived record from the previous year.',
    startDate: '2025-09-01',
    endDate: '2025-09-08',
    status: 'ARCHIVED',
    center: {
      name: 'Brno',
      city: 'Brno',
      email: 'brno@bdc.cz',
      phone: '+420 543 210 987',
    },
  },
  {
    id: 'evt-004',
    title_cs: 'Letní soustředění',
    title_en: 'Summer Intensive',
    subtitle_cs: null,
    subtitle_en: null,
    description_cs:
      'Letní intenzivní soustředění s hosty z dalších center. Program se připravuje.',
    description_en:
      'A summer intensive with guests from other centres. Programme in preparation.',
    startDate: '2027-07-10',
    endDate: '2027-07-17',
    status: 'DRAFT',
    center: {
      name: 'Olomouc',
      city: 'Olomouc',
      email: 'olomouc@bdc.cz',
      phone: '+420 585 333 444',
    },
  },
]

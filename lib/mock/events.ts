export type MockEvent = {
  id: string
  title_cs: string
  title_en: string
  subtitle_cs: string | null
  subtitle_en: string | null
  startDate: string
  endDate: string
  status: 'PUBLISHED' | 'CLOSED' | 'ARCHIVED' | 'DRAFT'
}

export const mockEvents: MockEvent[] = [
  {
    id: 'evt-001',
    title_cs: 'Meditační retreat — podzim 2026',
    title_en: 'Meditation Retreat — Autumn 2026',
    subtitle_cs: 'Otevřený pro všechny',
    subtitle_en: 'Open to everyone',
    startDate: '2026-09-05',
    endDate: '2026-09-12',
    status: 'PUBLISHED',
  },
  {
    id: 'evt-002',
    title_cs: 'Víkendová praxe — červen 2026',
    title_en: 'Weekend Practice — June 2026',
    subtitle_cs: null,
    subtitle_en: null,
    startDate: '2026-06-14',
    endDate: '2026-06-16',
    status: 'CLOSED',
  },
  {
    id: 'evt-003',
    title_cs: 'Roční kurz meditace 2025',
    title_en: 'Annual Meditation Course 2025',
    subtitle_cs: 'Archivní záznam',
    subtitle_en: 'Archived record',
    startDate: '2025-09-01',
    endDate: '2025-09-08',
    status: 'ARCHIVED',
  },
  {
    id: 'evt-004',
    title_cs: 'Letní soustředění 2027',
    title_en: 'Summer Intensive 2027',
    subtitle_cs: null,
    subtitle_en: null,
    startDate: '2027-07-10',
    endDate: '2027-07-17',
    status: 'DRAFT',
  },
]

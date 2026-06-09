// Mock registration options (presentation scaffolding for B5).
// Supplies the event dates, per-day meal slots, and the centre list that the
// registration form needs. This mirrors what B7 will later fetch from the DB
// (EventDate / EventMeal / Center). Money = whole CZK integers (invariant 10).

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER'

export type MockEventDate = {
  id: string
  date: string // ISO yyyy-mm-dd (UTC date, displayed in Europe/Prague — invariant 11)
  label_cs: string
  label_en: string
  sortOrder: number
}

export type MockMealSlot = {
  id: string
  eventDateId: string
  mealType: MealType
  price: number // whole CZK
  isClosed: boolean
}

export type MockCenter = {
  id: string
  name_cs: string
  name_en: string
}

// Three consecutive days (Fri / Sat / Sun, 4–6 Sep 2026) within evt-001's range.
export const mockEventDates: MockEventDate[] = [
  { id: 'date-fri', date: '2026-09-04', label_cs: 'Pátek 4. 9.', label_en: 'Friday 4 Sep', sortOrder: 1 },
  { id: 'date-sat', date: '2026-09-05', label_cs: 'Sobota 5. 9.', label_en: 'Saturday 5 Sep', sortOrder: 2 },
  { id: 'date-sun', date: '2026-09-06', label_cs: 'Neděle 6. 9.', label_en: 'Sunday 6 Sep', sortOrder: 3 },
]

// Breakfast / lunch / dinner per day. Saturday lunch is closed to demonstrate
// the disabled state. Catalog prices match the PricingModal (80 / 120 / 120).
export const mockMealSlots: MockMealSlot[] = [
  { id: 'meal-fri-breakfast', eventDateId: 'date-fri', mealType: 'BREAKFAST', price: 80, isClosed: false },
  { id: 'meal-fri-lunch', eventDateId: 'date-fri', mealType: 'LUNCH', price: 120, isClosed: false },
  { id: 'meal-fri-dinner', eventDateId: 'date-fri', mealType: 'DINNER', price: 120, isClosed: false },

  { id: 'meal-sat-breakfast', eventDateId: 'date-sat', mealType: 'BREAKFAST', price: 80, isClosed: false },
  { id: 'meal-sat-lunch', eventDateId: 'date-sat', mealType: 'LUNCH', price: 120, isClosed: true },
  { id: 'meal-sat-dinner', eventDateId: 'date-sat', mealType: 'DINNER', price: 120, isClosed: false },

  { id: 'meal-sun-breakfast', eventDateId: 'date-sun', mealType: 'BREAKFAST', price: 80, isClosed: false },
  { id: 'meal-sun-lunch', eventDateId: 'date-sun', mealType: 'LUNCH', price: 120, isClosed: false },
  { id: 'meal-sun-dinner', eventDateId: 'date-sun', mealType: 'DINNER', price: 120, isClosed: false },
]

// All 25 BDC centres, mirrored from prisma/seed.ts (presentation scaffolding —
// B7 reads these from the DB). All centres are active; ordering is done in the
// UI by alphabetical name. Bilingual names — only a few differ across locales.
export const mockCenters: MockCenter[] = [
  { id: 'ctr-brno', name_cs: 'Brno', name_en: 'Brno' },
  { id: 'ctr-cesky-tesin', name_cs: 'Český Těšín', name_en: 'Český Těšín' },
  { id: 'ctr-jihlava', name_cs: 'Jihlava', name_en: 'Jihlava' },
  { id: 'ctr-jilemnice', name_cs: 'Jilemnice', name_en: 'Jilemnice' },
  { id: 'ctr-karlovy-vary', name_cs: 'Karlovy Vary', name_en: 'Karlovy Vary' },
  { id: 'ctr-kladno', name_cs: 'Kladno', name_en: 'Kladno' },
  { id: 'ctr-klatovy', name_cs: 'Klatovy', name_en: 'Klatovy' },
  { id: 'ctr-kolin', name_cs: 'Kolín', name_en: 'Kolín' },
  { id: 'ctr-liberec', name_cs: 'Liberec', name_en: 'Liberec' },
  { id: 'ctr-olomouc', name_cs: 'Olomouc', name_en: 'Olomouc' },
  { id: 'ctr-ostrava', name_cs: 'Ostrava', name_en: 'Ostrava' },
  { id: 'ctr-pardubice', name_cs: 'Pardubice', name_en: 'Pardubice' },
  { id: 'ctr-pisek', name_cs: 'Písek', name_en: 'Písek' },
  { id: 'ctr-plzen', name_cs: 'Plzeň', name_en: 'Plzeň' },
  { id: 'ctr-praha', name_cs: 'Praha', name_en: 'Prague' },
  { id: 'ctr-roznov', name_cs: 'Rožnov pod Radhoštěm', name_en: 'Rožnov pod Radhoštěm' },
  { id: 'ctr-sumperk', name_cs: 'Šumperk', name_en: 'Šumperk' },
  { id: 'ctr-tenovice', name_cs: 'Těnovice', name_en: 'Těnovice' },
  { id: 'ctr-trojak', name_cs: 'Troják', name_en: 'Troják' },
  { id: 'ctr-trutnov', name_cs: 'Trutnov', name_en: 'Trutnov' },
  { id: 'ctr-usti-nad-labem', name_cs: 'Ústí nad Labem', name_en: 'Ústí nad Labem' },
  { id: 'ctr-vyhlidky', name_cs: 'Vyhlídky / České Budějovice', name_en: 'Vyhlídky / České Budějovice' },
  { id: 'ctr-zlin', name_cs: 'Zlín', name_en: 'Zlín' },
  { id: 'ctr-jine', name_cs: 'Jiné', name_en: 'Other' },
  { id: 'ctr-mimo-cr', name_cs: 'Mimo ČR', name_en: 'Not from Czechia' },
]

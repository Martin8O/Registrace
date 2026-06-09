// Mock registrations (presentation scaffolding for the B6 admin panel).
// Mirrors what B7 will fetch from the DB (Registration + Participant). Cross-
// references mockEvents (eventId) and mockCenters (centerId). Money = whole CZK
// integers (invariant 10); datetimes are UTC ISO, displayed Europe/Prague (11).

export type MockAgeCategory = 'AGE_0_3' | 'AGE_4_7' | 'AGE_8_14' | 'AGE_15_PLUS'
export type MockPricingType = 'STANDARD' | 'SUPPORTED' | 'SURPLUS'
// Product decision (B6): only two registration statuses. Everyone is REGISTERED
// on submit (no payment system — this is paperwork); an admin may CANCEL. The
// Prisma RegistrationStatus enum (PENDING/CONFIRMED/CANCELLED/WAITLIST) is
// reconciled to this in B7 (schema change). See SESSION_BOOTSTRAP parking lot.
export type MockRegistrationStatus = 'REGISTERED' | 'CANCELLED'

// NONE = stays until the end of the event (event's ending meal);
// AFTER_BREAKFAST = leaves after breakfast on the departure day.
export type MockEarlyDeparture = 'NONE' | 'AFTER_BREAKFAST'

export type MockRegistrationParticipant = {
  fullName: string
  ageCategory: MockAgeCategory
  pricingType: MockPricingType | null // null for ages 0–14 (invariant 15)
  participationPrice: number
  mealPrice: number
  totalPrice: number
  mealIds: string[] // → mockMealSlots[].id (which meals this person eats)
}

export type MockRegistration = {
  id: string
  eventId: string // → mockEvents[].id
  email: string
  centerId: string // → mockCenters[].id
  arrivalDateId: string // → mockEventDates[].id
  departureDateId: string // → mockEventDates[].id
  arrivalTime: 'MORNING' | 'AFTERNOON' | 'EVENING'
  earlyDeparture: MockEarlyDeparture
  hasAccommodation: boolean
  participants: MockRegistrationParticipant[]
  totalPrice: number // whole CZK
  status: MockRegistrationStatus
  createdAt: string // UTC ISO
}

export const mockRegistrations: MockRegistration[] = [
  {
    id: 'reg-1001',
    eventId: 'evt-001',
    email: 'jana.novakova@example.com',
    centerId: 'ctr-tenovice',
    arrivalDateId: 'date-fri',
    departureDateId: 'date-sun',
    arrivalTime: 'AFTERNOON',
    earlyDeparture: 'NONE',
    hasAccommodation: true,
    participants: [
      {
        fullName: 'Jana Nováková',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'STANDARD',
        participationPrice: 360,
        mealPrice: 320,
        totalPrice: 680,
        mealIds: ['meal-fri-dinner', 'meal-sat-breakfast', 'meal-sat-dinner', 'meal-sun-breakfast', 'meal-sun-lunch'],
      },
      {
        fullName: 'Petr Novák',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'SUPPORTED',
        participationPrice: 240,
        mealPrice: 320,
        totalPrice: 560,
        mealIds: ['meal-fri-dinner', 'meal-sat-breakfast', 'meal-sat-dinner', 'meal-sun-breakfast', 'meal-sun-lunch'],
      },
    ],
    totalPrice: 1240,
    status: 'REGISTERED',
    createdAt: '2026-06-01T08:24:00.000Z',
  },
  {
    id: 'reg-1002',
    eventId: 'evt-001',
    email: 'tomas.svoboda@example.com',
    centerId: 'ctr-praha',
    arrivalDateId: 'date-sat',
    departureDateId: 'date-sun',
    arrivalTime: 'MORNING',
    earlyDeparture: 'AFTER_BREAKFAST',
    hasAccommodation: false,
    participants: [
      {
        fullName: 'Tomáš Svoboda',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'SURPLUS',
        participationPrice: 240,
        mealPrice: 200,
        totalPrice: 440,
        mealIds: ['meal-sat-breakfast', 'meal-sat-dinner', 'meal-sun-breakfast'],
      },
    ],
    totalPrice: 440,
    status: 'REGISTERED',
    createdAt: '2026-06-02T14:05:00.000Z',
  },
  {
    id: 'reg-1003',
    eventId: 'evt-001',
    email: 'rodina.kralova@example.com',
    centerId: 'ctr-brno',
    arrivalDateId: 'date-fri',
    departureDateId: 'date-sun',
    arrivalTime: 'EVENING',
    earlyDeparture: 'NONE',
    hasAccommodation: true,
    participants: [
      {
        fullName: 'Eva Králová',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'STANDARD',
        participationPrice: 360,
        mealPrice: 320,
        totalPrice: 680,
        mealIds: ['meal-fri-dinner', 'meal-sat-breakfast', 'meal-sat-dinner', 'meal-sun-breakfast', 'meal-sun-lunch'],
      },
      {
        fullName: 'Anna Králová',
        ageCategory: 'AGE_8_14',
        pricingType: null,
        participationPrice: 0,
        mealPrice: 240,
        totalPrice: 240,
        mealIds: ['meal-sat-breakfast', 'meal-sat-dinner', 'meal-sun-breakfast'],
      },
      {
        fullName: 'Marek Král',
        ageCategory: 'AGE_4_7',
        pricingType: null,
        participationPrice: 0,
        mealPrice: 160,
        totalPrice: 160,
        mealIds: ['meal-sat-breakfast', 'meal-sun-breakfast'],
      },
    ],
    totalPrice: 1080,
    status: 'REGISTERED',
    createdAt: '2026-06-03T09:47:00.000Z',
  },
  {
    id: 'reg-1004',
    eventId: 'evt-002',
    email: 'lucie.dvorakova@example.com',
    centerId: 'ctr-plzen',
    arrivalDateId: 'date-fri',
    departureDateId: 'date-sat',
    arrivalTime: 'MORNING',
    earlyDeparture: 'AFTER_BREAKFAST',
    hasAccommodation: false,
    participants: [
      {
        fullName: 'Lucie Dvořáková',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'STANDARD',
        participationPrice: 120,
        mealPrice: 120,
        totalPrice: 240,
        mealIds: [],
      },
    ],
    totalPrice: 240,
    status: 'CANCELLED',
    createdAt: '2026-05-20T11:12:00.000Z',
  },
  {
    id: 'reg-1005',
    eventId: 'evt-001',
    email: 'martin.benes@example.com',
    centerId: 'ctr-olomouc',
    arrivalDateId: 'date-fri',
    departureDateId: 'date-sun',
    arrivalTime: 'AFTERNOON',
    earlyDeparture: 'NONE',
    hasAccommodation: true,
    participants: [
      {
        fullName: 'Martin Beneš',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'SUPPORTED',
        participationPrice: 240,
        mealPrice: 320,
        totalPrice: 560,
        mealIds: ['meal-fri-dinner', 'meal-sat-breakfast', 'meal-sat-dinner', 'meal-sun-breakfast', 'meal-sun-lunch'],
      },
    ],
    totalPrice: 560,
    status: 'REGISTERED',
    createdAt: '2026-06-04T16:38:00.000Z',
  },
]

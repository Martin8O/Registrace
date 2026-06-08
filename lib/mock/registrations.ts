// Mock registrations (presentation scaffolding for the B6 admin panel).
// Mirrors what B7 will fetch from the DB (Registration + Participant). Cross-
// references mockEvents (eventId) and mockCenters (centerId). Money = whole CZK
// integers (invariant 10); datetimes are UTC ISO, displayed Europe/Prague (11).

export type MockAgeCategory = 'AGE_0_3' | 'AGE_4_7' | 'AGE_8_14' | 'AGE_15_PLUS'
export type MockPricingType = 'STANDARD' | 'SUPPORTED' | 'SURPLUS'
export type MockRegistrationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'WAITLIST'

export type MockRegistrationParticipant = {
  fullName: string
  ageCategory: MockAgeCategory
  pricingType: MockPricingType | null // null for ages 0–14 (invariant 15)
  participationPrice: number
  mealPrice: number
  totalPrice: number
}

export type MockRegistration = {
  id: string
  eventId: string // → mockEvents[].id
  email: string
  centerId: string // → mockCenters[].id
  arrivalDateId: string // → mockEventDates[].id
  departureDateId: string // → mockEventDates[].id
  arrivalTime: 'MORNING' | 'AFTERNOON' | 'EVENING'
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
    hasAccommodation: true,
    participants: [
      {
        fullName: 'Jana Nováková',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'STANDARD',
        participationPrice: 360,
        mealPrice: 320,
        totalPrice: 680,
      },
      {
        fullName: 'Petr Novák',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'SUPPORTED',
        participationPrice: 240,
        mealPrice: 320,
        totalPrice: 560,
      },
    ],
    totalPrice: 1240,
    status: 'CONFIRMED',
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
    hasAccommodation: false,
    participants: [
      {
        fullName: 'Tomáš Svoboda',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'SURPLUS',
        participationPrice: 240,
        mealPrice: 200,
        totalPrice: 440,
      },
    ],
    totalPrice: 440,
    status: 'PENDING',
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
    hasAccommodation: true,
    participants: [
      {
        fullName: 'Eva Králová',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'STANDARD',
        participationPrice: 360,
        mealPrice: 320,
        totalPrice: 680,
      },
      {
        fullName: 'Anna Králová',
        ageCategory: 'AGE_8_14',
        pricingType: null,
        participationPrice: 0,
        mealPrice: 240,
        totalPrice: 240,
      },
      {
        fullName: 'Marek Král',
        ageCategory: 'AGE_4_7',
        pricingType: null,
        participationPrice: 0,
        mealPrice: 160,
        totalPrice: 160,
      },
    ],
    totalPrice: 1080,
    status: 'WAITLIST',
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
    hasAccommodation: false,
    participants: [
      {
        fullName: 'Lucie Dvořáková',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'STANDARD',
        participationPrice: 120,
        mealPrice: 120,
        totalPrice: 240,
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
    hasAccommodation: true,
    participants: [
      {
        fullName: 'Martin Beneš',
        ageCategory: 'AGE_15_PLUS',
        pricingType: 'SUPPORTED',
        participationPrice: 240,
        mealPrice: 320,
        totalPrice: 560,
      },
    ],
    totalPrice: 560,
    status: 'CONFIRMED',
    createdAt: '2026-06-04T16:38:00.000Z',
  },
]

// Mock admin users (presentation scaffolding for the B6 Users scaffold page).
// Mirrors what B7 will fetch from the DB (User + UserCenter). assignedCenterIds
// cross-reference mockCenters. NOTE: roles are display-only in B6 — there is no
// role logic, no SUPER_ADMIN/ADMIN branching, and no User/UserCenter query yet
// (those tables are unmigrated). All of that is // TODO(B7).

export type MockUserRole = 'SUPER_ADMIN' | 'ADMIN'

export type MockUser = {
  id: string
  email: string
  role: MockUserRole
  assignedCenterIds: string[] // → mockCenters[].id (empty for SUPER_ADMIN: sees all)
  createdAt: string // UTC ISO
}

export const mockUsers: MockUser[] = [
  {
    id: 'usr-0001',
    email: 'martin@bdc.cz',
    role: 'SUPER_ADMIN',
    assignedCenterIds: [],
    createdAt: '2026-05-01T07:00:00.000Z',
  },
  {
    id: 'usr-0002',
    email: 'tenovice.admin@bdc.cz',
    role: 'ADMIN',
    assignedCenterIds: ['ctr-tenovice'],
    createdAt: '2026-05-10T09:30:00.000Z',
  },
  {
    id: 'usr-0003',
    email: 'praha.admin@bdc.cz',
    role: 'ADMIN',
    assignedCenterIds: ['ctr-praha', 'ctr-plzen'],
    createdAt: '2026-05-14T13:15:00.000Z',
  },
  {
    id: 'usr-0004',
    email: 'brno.admin@bdc.cz',
    role: 'ADMIN',
    assignedCenterIds: ['ctr-brno'],
    createdAt: '2026-05-22T18:45:00.000Z',
  },
]

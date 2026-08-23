// Imp Credits is live at imp.rxliuli.com (deployed 2026-08-23), so both dev
// and production builds talk to the real service. For local iteration against
// the imp-credits repo's `wrangler dev` (http://localhost:8787), temporarily
// swap the constant below.
export const IMP_ORIGIN = 'https://imp.rxliuli.com'
// export const IMP_ORIGIN = 'http://localhost:8787'

export const IMP_CONNECT_URL = `${IMP_ORIGIN}/connect?src=imp-write`

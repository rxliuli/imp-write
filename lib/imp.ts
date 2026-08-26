import { connectUrl } from '@rxliuli/imp-credits-sdk'

// Imp Credits is live at imp.rxliuli.com (deployed 2026-08-23), so both dev
// and production builds talk to the real service. For local iteration against
// the imp-credits repo's `wrangler dev` (http://localhost:8787), temporarily
// swap the constant below.
export const IMP_ORIGIN = 'https://imp.rxliuli.com'
// export const IMP_ORIGIN = 'http://localhost:8787'

// The extension's identity on the Imp Credits connect flow — must match the
// `?src=` value we open the connect page with (see IMP_CONNECT_URL). The SDK's
// `isForExtension` gates the connect-success content script on this exact id.
export const IMP_SRC = 'imp-write'

export const IMP_CONNECT_URL = connectUrl(IMP_SRC, IMP_ORIGIN)

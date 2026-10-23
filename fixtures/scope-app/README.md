# Scope fixture

This fixture has 14 Next.js App Router pages across five groups:
- Authentication: `/login`, `/signup`, `/forgot-password`, `/verify`
- Marketing: `/`, `/pricing`, `/about`
- Dashboard: `/dashboard`, `/analytics`, `/reports`
- Settings: `/settings`, `/settings/security`
- Checkout: `/checkout`, `/checkout/success`

The `app/` folder exists for route discovery. The four auth HTML pages are served by the scope selection tests. This fixture is not a running Next.js app.

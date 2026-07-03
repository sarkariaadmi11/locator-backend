# Locator Backend

Production-ready Node.js API for the Locator mobile app.

## Stack

- Node.js, Express.js, TypeScript
- PostgreSQL with Prisma ORM
- JWT authentication and bcrypt password hashing
- Helmet, CORS, rate limiting
- Winston logging
- Zod validation
- MVC plus repository pattern

## Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:dev
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

API documentation lives in [docs/API.md](docs/API.md).

## Environment

Set a strong `JWT_SECRET` before deploying. Configure `DATABASE_URL`,
`CORS_ORIGIN`, and `PUBLIC_BASE_URL` for your production environment.

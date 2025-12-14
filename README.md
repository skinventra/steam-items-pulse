# Steam Items Pulse API

CS2 item price data from Steam Community Market.

## 🚀 Deployment

### Quick Start (Local)

```bash
# Install dependencies
npm install

# Create .env file (see env.example)
cp env.example .env

# Start with Docker Compose
docker-compose up -d

# Run migrations
npm run db:push

# Start development server
npm run dev
```

### Deploy to Railway

1. Push to GitHub
2. Create project on [railway.app](https://railway.app) → Deploy from GitHub
3. Add PostgreSQL plugin (+ Add → Database → PostgreSQL)
4. Set environment variables (see `env.example`)
5. Generate public domain (Settings → Networking)
6. Done! 🚀

## Base URL

**Local:**
```
http://localhost:8080
```

**Production (Railway):**
```
https://your-app-xyz.up.railway.app
```

---

## Endpoints

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-14T10:30:00Z",
  "version": "1.0.0",
  "database": "connected",
  "providers": {
    "steam-market": {
      "status": "healthy",
      "latencyMs": 245
    }
  }
}
```

---

### List Items

```
GET /api/v1/items
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 50 | Items per page (max 100) |
| `search` | string | - | Search by name |
| `sortBy` | string | name | Sort by: `name`, `updatedAt` |
| `order` | string | asc | Order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "marketHashName": "AK-47 | Redline (Field-Tested)",
      "iconUrl": "https://steamcommunity-a.akamaihd.net/economy/image/...",
      "price": 1250,
      "currency": "EUR",
      "listings": 1847,
      "updatedAt": "2025-12-14T10:25:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 29019,
    "totalPages": 581
  }
}
```

---

### Get Item by ID

```
GET /api/v1/items/:id
```

**Response:**
```json
{
  "data": {
    "id": 1,
    "marketHashName": "AK-47 | Redline (Field-Tested)",
    "iconUrl": "https://steamcommunity-a.akamaihd.net/economy/image/...",
    "price": 1250,
    "currency": "EUR",
    "listings": 1847,
    "createdAt": "2025-12-14T10:00:00Z",
    "updatedAt": "2025-12-14T10:25:00Z"
  }
}
```

---

### Get Item by Hash Name

```
GET /api/v1/items/by-hash/:hashName
```

**Example:**
```
GET /api/v1/items/by-hash/AK-47%20%7C%20Redline%20(Field-Tested)
```

**Response:** Same as Get Item by ID

---

### Stats

```
GET /api/v1/stats
```

**Response:**
```json
{
  "totalItems": 29019,
  "providers": {
    "total": 1,
    "enabled": 1,
    "healthy": 1
  },
  "database": {
    "itemsCount": 29019,
    "oldestUpdate": "2025-12-14T10:00:00Z",
    "newestUpdate": "2025-12-14T10:25:00Z"
  }
}
```

---

### List Providers

```
GET /api/v1/providers
```

**Response:**
```json
{
  "data": [
    {
      "name": "steam-market",
      "displayName": "Steam Community Market",
      "enabled": true,
      "status": "healthy",
      "config": {
        "batchSize": 10,
        "requestDelay": 3000
      }
    }
  ]
}
```

---

### Trigger Manual Scan

```
POST /api/v1/providers/:name/run
```

**Example:**
```bash
curl -X POST https://your-app.up.railway.app/api/v1/providers/steam-market/run
```

**Response:**
```json
{
  "message": "Scan completed",
  "result": {
    "provider": "steam-market",
    "startedAt": "2025-12-14T10:00:00Z",
    "completedAt": "2025-12-14T11:15:00Z",
    "itemsProcessed": 29019,
    "itemsUpdated": 1547,
    "errors": 0
  }
}
```

---

## Data Fields

| Field | Type | Description |
|-------|------|-------------|
| `marketHashName` | string | Unique item identifier from Steam |
| `iconUrl` | string | Full URL to item icon |
| `price` | int | Price in cents |
| `currency` | string | Currency code (EUR, USD, RUB, etc.) |
| `listings` | int | Number of active sell listings |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `PORT` | ❌ | 8080 | Server port |
| `NODE_ENV` | ❌ | development | Environment mode |
| `STEAM_MARKET_ENABLED` | ❌ | true | Enable Steam Market parser |
| `STEAM_MARKET_INTERVAL_MINUTES` | ❌ | 5 | Parse interval in minutes |
| `STEAM_MARKET_BATCH_SIZE` | ❌ | 10 | Items per API request |
| `STEAM_MARKET_DELAY_MS` | ❌ | 3000 | Delay between requests |
| `RUN_INITIAL_SCAN` | ❌ | false | Run scan on startup |
| `LOG_LEVEL` | ❌ | info | Log level (debug/info/warn/error) |

---

## Errors

```json
{
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "Item with id 99999 not found"
  }
}
```

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `ITEM_NOT_FOUND` | 404 | Item not found |
| `PROVIDER_NOT_FOUND` | 404 | Provider not found |
| `SCAN_FAILED` | 400 | Manual scan failed |
| `INTERNAL_ERROR` | 500 | Server error |

---

## 🗺️ Roadmap

### Planned Features

- [ ] **Rate Limiting** — Protect API from abuse (100 req/min per IP)
- [ ] **Response Caching** — In-memory cache for frequent queries
- [ ] **API Keys** — Authentication for public API access
- [ ] **Price History** — Track price changes over time
- [ ] **Multiple Providers** — Add more price sources (Buff163, CSFloat, etc.)
- [ ] **Webhooks** — Notify on significant price changes
- [ ] **GraphQL API** — Alternative to REST

### Infrastructure

- [ ] **Redis** — External cache for multi-replica deployments
- [ ] **Sentry** — Error monitoring and alerting
- [ ] **Prometheus/Grafana** — Metrics and dashboards

---

## License

MIT

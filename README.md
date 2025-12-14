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

See [RAILWAY_SETUP.md](./RAILWAY_SETUP.md) for detailed instructions on deploying to Railway.

**TL;DR:**
1. Push to GitHub
2. Connect repo to Railway
3. Add PostgreSQL plugin
4. Set environment variables
5. Deploy! 🚀

## Base URL

**Local:**
```
http://localhost:8000
```

**Production (Railway):**
```
https://your-app-xyz.railway.app
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
  "database": "connected"
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

## Data Fields

| Field | Type | Description |
|-------|------|-------------|
| `marketHashName` | string | Unique item identifier from Steam |
| `iconUrl` | string | Full URL to item icon |
| `price` | int | Price in cents |
| `currency` | string | Currency code (EUR, USD, RUB, etc.) |
| `listings` | int | Number of active sell listings |

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
| `INTERNAL_ERROR` | 500 | Server error |

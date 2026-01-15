# Jetstream Post Indexing

Real-time post indexing from Bluesky's Jetstream service for list-scoped search.

## Overview

This feature indexes posts from admin list members in real-time, enabling fast full-text search limited to your community. When the Jetstream indexer is unavailable, the system automatically falls back to Bluesky's public search API.

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────────┐
│   Bluesky       │ ─────────────────▶ │  Jetstream Worker   │
│   Jetstream     │   (filtered by     │  (PM2 process)      │
│   Servers       │    admin DIDs)     │                     │
└─────────────────┘                    └──────────┬──────────┘
                                                  │
                                                  ▼
┌─────────────────┐                    ┌─────────────────────┐
│   Mobile App    │◀──── REST API ────│   Gateway API       │
│                 │                    │   /api/search/posts │
└─────────────────┘                    └──────────┬──────────┘
                                                  │
                                                  ▼
                                       ┌─────────────────────┐
                                       │   PostgreSQL        │
                                       │   (IndexedPost +    │
                                       │    full-text index) │
                                       └─────────────────────┘
```

## Setup

### 1. Run Database Migration

```bash
cd backend
npx prisma migrate dev --name add_jetstream_indexing
npx prisma generate

# Apply full-text search indexes
psql $DATABASE_URL -f prisma/migrations/jetstream_search_index.sql
```

### 2. Configure Admin List

Set `videoFeedListUri` in your AppConfig to the Bluesky list URI containing users whose posts should be indexed:

```sql
UPDATE "AppConfig" 
SET "videoFeedListUri" = 'at://did:plc:xxx/app.bsky.graph.list/yyy'
WHERE id = 1;
```

### 3. Start Services

```bash
# Development (both gateway and jetstream worker)
pm2 start ecosystem.config.js

# Or start individually
pm2 start ecosystem.config.js --only gominiapp-gateway
pm2 start ecosystem.config.js --only gominiapp-jetstream
```

## API Endpoints

### Search Posts

```
GET /api/search/posts?q=keyword&limit=25&sort=latest
```

Query parameters:
- `q` (required): Search query
- `limit` (optional): Results per page (default: 25, max: 100)
- `cursor` (optional): Pagination cursor
- `sort` (optional): `top` (relevance) or `latest` (chronological)

Response:
```json
{
  "success": true,
  "data": {
    "posts": [...],
    "cursor": "next_page_cursor",
    "totalCount": 42,
    "source": "indexed",  // or "bluesky" if using fallback
    "jetstreamStatus": {
      "running": true,
      "watchedDidsCount": 150,
      "postsIndexed": 12345,
      "fallbackReason": null  // or reason string if fallback
    }
  }
}
```

### Indexer Status

```
GET /api/search/status
```

## Search Ranking

When using `sort=top`, posts are ranked by:

1. **Engagement Score**: `likes + (reposts × 2) + (replies × 0.5)`
2. **Recency Decay**: Score decreases by 50% after 7 days

## Fallback Behavior

When Jetstream is unavailable, the system:

1. Automatically falls back to Bluesky's `searchPosts` API
2. Filters results to admin list members
3. Shows a notification to users: "⚠️ [reason]. Results may be limited."

Fallback is triggered when:
- Jetstream worker is not running
- No posts have been indexed yet
- Index query fails

## Real-time Updates

New posts are broadcast via WebSocket to clients subscribed to `feed:updates`:

```javascript
// Subscribe to feed updates
ws.send(JSON.stringify({
  type: 'subscribe',
  payload: { channel: 'feed:updates' }
}))

// Receive new posts
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'new_post') {
    // Refresh search results or show notification
  }
}
```

## Monitoring

Check Jetstream worker logs:
```bash
pm2 logs gominiapp-jetstream
```

Check indexer stats:
```bash
curl http://localhost:3001/api/search/status
```

## Troubleshooting

### "Jetstream indexer is not running"
- Check if the admin list is configured in AppConfig
- Verify the list URI is valid and accessible
- Check PM2 logs for connection errors

### "No posts indexed yet"
- Jetstream only indexes posts created after worker startup
- Wait for new posts from list members
- Check that list has active members

### Search returns no results
- Verify the query matches indexed post content
- Check that posts exist from list members
- Try the fallback by stopping the Jetstream worker

## Performance Notes

- **Database**: ~1KB per post, estimated 60MB/month for 100-user list
- **Memory**: Jetstream worker uses ~50-100MB RAM
- **Network**: Single WebSocket connection to Jetstream servers
- **Latency**: Sub-second for real-time indexing

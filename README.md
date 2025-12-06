# GoMiniApp Backend

Scalable Node.js + PostgreSQL backend for the GoMiniApp ride-hailing and delivery service.

## Architecture

```
backend/
├── prisma/                  # Database schema and migrations
│   └── schema.prisma
├── packages/
│   ├── core/               # Shared utilities and infrastructure
│   │   ├── auth/           # DID authentication
│   │   ├── bluesky/        # Bluesky DM integration
│   │   ├── db/             # Prisma client
│   │   ├── geo/            # Geographic utilities (PostGIS)
│   │   ├── notifications/  # Push notifications (Expo)
│   │   ├── realtime/       # WebSocket & Redis
│   │   └── utils/          # Logger, errors, types
│   ├── go-service/         # Business logic services
│   │   └── services/
│   │       ├── driver.service.ts   # Driver management
│   │       ├── order.service.ts    # Ride/delivery orders
│   │       ├── rating.service.ts   # Driver ratings
│   │       └── user.service.ts     # User management
│   └── gateway/            # Express API server
│       └── routes/
│           ├── auth.routes.ts
│           ├── driver.routes.ts
│           ├── order.routes.ts
│           └── user.routes.ts
├── docker-compose.yml      # PostgreSQL + Redis
└── package.json            # Monorepo root
```

## Features

- **Bluesky DID Authentication**: Authenticate users via their Bluesky identity
- **Bluesky DM Integration**: Order communications via Bluesky direct messages
- **Real-time Tracking**: WebSocket + Redis pub/sub for live driver locations
- **PostGIS Geo Queries**: Efficient spatial queries for finding nearby drivers
- **80m Location Threshold**: Optimized location updates (only update if driver moves 80m+)
- **Push Notifications**: Expo push notifications for order updates
- **Fare Calculation**: Dynamic pricing with surge multipliers
- **OTP Verification**: 4-digit OTP for ride start verification

## Setup

### Prerequisites

- Node.js 18+
- Yarn (for workspaces)
- Docker & Docker Compose

### Installation

1. **Clone and install dependencies:**
   ```bash
   cd backend
   yarn install
   ```

2. **Start databases:**
   ```bash
   docker-compose up -d
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Run migrations:**
   ```bash
   yarn db:migrate
   ```

5. **Generate Prisma client:**
   ```bash
   yarn db:generate
   ```

6. **Start development server:**
   ```bash
   yarn dev
   ```

## Environment Variables

```env
# Database
DATABASE_URL="postgresql://gominiapp:gominiapp@localhost:5432/gominiapp?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"

# Bluesky (for DM integration)
BSKY_SERVICE_IDENTIFIER="your-bot.bsky.social"
BSKY_SERVICE_PASSWORD="your-app-password"

# Server
PORT=3001
NODE_ENV=development
LOG_LEVEL=debug
```

## API Endpoints

### Authentication

```
POST /api/auth/login       # Login with Bluesky DID
POST /api/auth/refresh     # Refresh JWT token
POST /api/auth/logout      # Logout
```

### Users

```
GET    /api/users/me           # Get current user
PATCH  /api/users/me           # Update profile
PUT    /api/users/me/push-token # Update push token
```

### Drivers

```
POST   /api/drivers/register       # Register as driver
GET    /api/drivers/me             # Get driver profile
GET    /api/drivers/me/stats       # Get driver statistics
PATCH  /api/drivers/me/availability # Toggle online/offline
POST   /api/drivers/me/location    # Update location
GET    /api/drivers/nearby         # Find nearby drivers
```

### Orders

```
POST   /api/orders/estimate        # Get fare estimate
POST   /api/orders                 # Create order
GET    /api/orders/active          # Get user's active order
GET    /api/orders/driver/active   # Get driver's active order
GET    /api/orders/history         # Get order history
POST   /api/orders/:id/accept      # Driver accepts order
PATCH  /api/orders/:id/status      # Update order status
POST   /api/orders/:id/cancel      # Cancel order
POST   /api/orders/:id/rate        # Rate completed order
```

## WebSocket Events

### Client → Server

```javascript
// Subscribe to order updates
{ type: 'subscribe', payload: { channel: 'order:ORDER_ID' } }

// Driver location update
{ type: 'driver:location', payload: { latitude, longitude, heading } }
```

### Server → Client

```javascript
// Order status update
{ type: 'order:update', payload: { orderId, status, driverLocation, eta } }

// New order request (for drivers)
{ type: 'order:request', payload: { orderId, type, pickup, dropoff, fare } }

// Driver location (for riders tracking)
{ type: 'driver:location', payload: { driverId, latitude, longitude } }
```

## Database Schema

### Core Tables

- **User**: Bluesky DID, profile, push token
- **Driver**: Vehicle info, availability, rating, location
- **Order**: Ride/delivery details, status, fare
- **OrderEvent**: Status transitions with timestamps/locations
- **Rating**: User ratings for drivers

### Key Enums

```prisma
enum AvailabilityType { RIDE, DELIVERY, BOTH }
enum VehicleType { CAR, MOTORCYCLE, BICYCLE, VAN }
enum OrderType { RIDE, DELIVERY }
enum OrderStatus { SEARCHING, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED }
```

## Scaling Considerations

1. **Horizontal Scaling**: Stateless API servers behind load balancer
2. **Redis Cluster**: For high-availability real-time features
3. **Read Replicas**: PostgreSQL read replicas for analytics
4. **Message Queue**: Add RabbitMQ/Kafka for async processing
5. **CDN**: For static assets and API caching
6. **Kubernetes**: Container orchestration for production

## Future MiniApps

The architecture is designed to support additional miniapps:

```typescript
// MiniApp table supports:
- Unique identifiers
- Custom schemas
- Versioning
- Feature flags
```

To add a new miniapp:
1. Create a new package in `packages/`
2. Define domain models in `schema.prisma`
3. Create service classes
4. Add routes to gateway

## License

MIT

# GoMiniApp Admin Panel

Full-featured admin panel with database debugging and CRUD operations for managing users, drivers, and orders.

## Features

- ✅ **Database Debug Tools**
  - Test connection
  - List all tables
  - View database statistics
  
- ✅ **Dashboard**
  - Real-time stats (users, drivers, orders)
  - Online driver monitoring
  
- ✅ **User Management**
  - List all users with search
  - View user details
  - Delete users
  - Pagination support
  
- ✅ **Driver Management**
  - List all drivers with filters
  - Edit driver details (vehicle info, status)
  - Delete drivers
  - Filter by online/offline status
  
- ✅ **Order Management**
  - List all orders with filters
  - View order details
  - Delete orders
  - Filter by status

## Quick Start

### Installation

```bash
cd packages/admin
npm install
```

### Running

**Option 1: From project root**
```bash
npm run admin
```

**Option 2: From admin directory**
```bash
cd packages/admin
npm start
```

**Option 3: With PM2 (production)**
Add to `ecosystem.config.js`:
```javascript
{
  name: 'gominiapp-admin',
  script: './packages/admin/server.js',
  cwd: '/path/to/backend',
  instances: 1,
  env: {
    ADMIN_PORT: 8080,
    DATABASE_URL: 'postgresql://...'
  }
}
```

Then:
```bash
pm2 start ecosystem.config.js --only gominiapp-admin
```

## Environment Variables

Create `.env` in the admin directory or set these:

```bash
ADMIN_PORT=8080
DATABASE_URL=postgresql://back:password@localhost:5432/back?schema=public
```

## Access

Once running, open:
- **Local**: http://localhost:8080
- **Remote**: http://your-server-ip:8080

## API Endpoints

### Debug
- `GET /api/debug/connection` - Test database connection
- `GET /api/debug/tables` - List all tables
- `GET /api/debug/stats` - Get database statistics

### Users
- `GET /api/users` - List users (with pagination & search)
- `GET /api/users/:id` - Get user details
- `DELETE /api/users/:id` - Delete user

### Drivers
- `GET /api/drivers` - List drivers (with filters)
- `PATCH /api/drivers/:id` - Update driver
- `DELETE /api/drivers/:id` - Delete driver

### Orders
- `GET /api/orders` - List orders (with filters)
- `GET /api/orders/:id` - Get order details
- `DELETE /api/orders/:id` - Delete order

## Security Notes

⚠️ **This admin panel has NO authentication!** 

For production:
1. Add authentication middleware
2. Restrict to internal network only
3. Use HTTPS
4. Add audit logging
5. Implement rate limiting

## Development

The admin panel consists of:
- `server.js` - Express API server with Prisma
- `public/index.html` - Admin UI
- `public/admin.js` - Frontend JavaScript

To modify the UI, edit files in `public/` directory.

## Troubleshooting

**Port already in use:**
```bash
# Change port
ADMIN_PORT=8081 npm start
```

**Database connection error:**
- Ensure `DATABASE_URL` is set correctly
- Check PostgreSQL is running
- Verify user permissions

**Missing dependencies:**
```bash
cd packages/admin
npm install
```

## License

Part of the GoMiniApp backend project.

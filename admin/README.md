# GoMiniApp Admin UI

Simple web-based admin panel for managing GoMiniApp drivers and users.

## Quick Start

### Option 1: Open directly in browser
Simply open `index.html` in your browser. Update the API URL in the config section.

### Option 2: Serve with Python
```bash
cd admin
python3 -m http.server 8080
```

Then open http://localhost:8080

### Option 3: Serve with Node.js
```bash
cd admin
npx http-server -p 8080
```

## Features

- **Dashboard**: View statistics (when admin endpoints are added)
- **Users**: List all users (requires admin endpoint)
- **Drivers**: List all drivers (requires admin endpoint)
- **Orders**: View recent orders (requires admin endpoint)
- **Add Driver**: Register new drivers with DID

## Configuration

Click "Save Config" after entering your API URL (e.g., `http://44.218.114.60:3001`)

## Database Queries (Alternative)

While admin endpoints are being built, use these SQL queries:

### View all drivers
```sql
psql -h localhost -U back -d back -c "
SELECT 
  u.did, 
  u.handle, 
  u.\"displayName\",
  d.\"vehicleType\", 
  d.\"licensePlate\",
  d.\"isOnline\",
  d.rating
FROM \"User\" u 
JOIN \"Driver\" d ON u.id = d.\"userId\";
"
```

### View all users
```sql
psql -h localhost -U back -d back -c "
SELECT id, did, handle, \"displayName\", \"createdAt\"
FROM \"User\"
ORDER BY \"createdAt\" DESC;
"
```

### View recent orders
```sql
psql -h localhost -U back -d back -c "
SELECT 
  o.id,
  o.type,
  o.status,
  o.\"pickupAddress\",
  o.\"dropoffAddress\",
  o.\"estimatedFare\",
  o.\"requestedAt\"
FROM \"Order\" o
ORDER BY o.\"requestedAt\" DESC
LIMIT 20;
"
```

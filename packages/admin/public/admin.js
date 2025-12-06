// Admin Panel JavaScript

const API_BASE = window.location.origin

let currentDriverId = null
let currentPage = { users: 1, drivers: 1, orders: 1 }

// ============================================================================
// Tab Management
// ============================================================================

function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
    
    event.target.classList.add('active')
    document.getElementById(tabName).classList.add('active')

    if (tabName === 'dashboard') loadDashboard()
    if (tabName === 'users') loadUsers()
    if (tabName === 'drivers') loadDrivers()
    if (tabName === 'orders') loadOrders()
    if (tabName === 'vehicleTypes') loadVehicleTypes()
}

// ============================================================================
// Dashboard
// ============================================================================

async function loadDashboard() {
    try {
        const res = await fetch(`${API_BASE}/api/debug/stats`)
        const data = await res.json()
        
        if (data.success) {
            document.getElementById('statUsers').textContent = data.data.users
            document.getElementById('statDrivers').textContent = data.data.drivers
            document.getElementById('statOnlineDrivers').textContent = data.data.onlineDrivers
            document.getElementById('statOrders').textContent = data.data.orders
        }
    } catch (error) {
        showMessage('dashboardMessage', 'Failed to load stats: ' + error.message, 'error')
    }
}

// ============================================================================
// Debug Functions
// ============================================================================

async function testConnection() {
    showDebugOutput('Testing database connection...')
    try {
        const res = await fetch(`${API_BASE}/api/debug/connection`)
        const data = await res.json()
        showDebugOutput(JSON.stringify(data, null, 2))
        showMessage('debugMessage', data.success ? '✓ Connection successful' : '✗ Connection failed', data.success ? 'success' : 'error')
    } catch (error) {
        showDebugOutput(`Error: ${error.message}`)
        showMessage('debugMessage', '✗ Connection failed', 'error')
    }
}

async function listTables() {
    showDebugOutput('Loading tables...')
    try {
        const res = await fetch(`${API_BASE}/api/debug/tables`)
        const data = await res.json()
        showDebugOutput(JSON.stringify(data, null, 2))
    } catch (error) {
        showDebugOutput(`Error: ${error.message}`)
    }
}

async function loadStats() {
    showDebugOutput('Loading statistics...')
    try {
        const res = await fetch(`${API_BASE}/api/debug/stats`)
        const data = await res.json()
        showDebugOutput(JSON.stringify(data, null, 2))
    } catch (error) {
        showDebugOutput(`Error: ${error.message}`)
    }
}

function showDebugOutput(content) {
    const output = document.getElementById('debugOutput')
    const contentEl = document.getElementById('debugContent')
    output.style.display = 'block'
    contentEl.textContent = content
}

// ============================================================================
// Users
// ============================================================================

async function loadUsers(page = 1) {
    currentPage.users = page
    const search = document.getElementById('userSearch').value
    
    try {
        showLoading('usersTable')
        const res = await fetch(`${API_BASE}/api/users?page=${page}&pageSize=20&search=${encodeURIComponent(search)}`)
        const data = await res.json()
        
        if (data.success) {
            renderUsersTable(data.data)
            renderPagination('usersPagination', data.meta, loadUsers)
            showMessage('usersMessage', `Loaded ${data.data.length} users`, 'success')
        }
    } catch (error) {
        showMessage('usersMessage', 'Error loading users: ' + error.message, 'error')
        document.getElementById('usersTable').innerHTML = ''
    }
}

function renderUsersTable(users) {
    const html = `
        <table>
            <thead>
                <tr>
                    <th>DID</th>
                    <th>Handle</th>
                    <th>Display Name</th>
                    <th>Is Driver</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(user => `
                    <tr>
                        <td><code>${user.did}</code></td>
                        <td>${user.handle || '-'}</td>
                        <td>${user.displayName || '-'}</td>
                        <td>${user.driver ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>'}</td>
                        <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                        <td>
                            <button class="btn btn-danger" onclick="deleteUser('${user.id}')" style="padding: 6px 12px; font-size: 12px;">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `
    document.getElementById('usersTable').innerHTML = html
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This will also delete their driver profile and all related data.')) {
        return
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/users/${userId}`, { method: 'DELETE' })
        const data = await res.json()
        
        if (data.success) {
            showMessage('usersMessage', 'User deleted successfully', 'success')
            loadUsers(currentPage.users)
        } else {
            showMessage('usersMessage', 'Error: ' + data.error, 'error')
        }
    } catch (error) {
        showMessage('usersMessage', 'Error deleting user: ' + error.message, 'error')
    }
}

// ============================================================================
// Drivers
// ============================================================================

async function loadDrivers(page = 1) {
    currentPage.drivers = page
    const isOnline = document.getElementById('driverFilter').value
    
    try {
        showLoading('driversTable')
        const url = `${API_BASE}/api/drivers?page=${page}&pageSize=20${isOnline ? '&isOnline=' + isOnline : ''}`
        const res = await fetch(url)
        const data = await res.json()
        
        if (data.success) {
            renderDriversTable(data.data)
            renderPagination('driversPagination', data.meta, loadDrivers)
            showMessage('driversMessage', `Loaded ${data.data.length} drivers`, 'success')
        }
    } catch (error) {
        showMessage('driversMessage', 'Error loading drivers: ' + error.message, 'error')
        document.getElementById('driversTable').innerHTML = ''
    }
}

function renderDriversTable(drivers) {
    const html = `
        <table>
            <thead>
                <tr>
                    <th>DID</th>
                    <th>Handle</th>
                    <th>Vehicle</th>
                    <th>License Plate</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Rating</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${drivers.map(driver => `
                    <tr>
                        <td><code style="font-size: 11px;">${driver.user.did}</code></td>
                        <td>${driver.user.handle || '-'}</td>
                        <td>${driver.vehicleMake || ''} ${driver.vehicleModel || ''} ${driver.vehicleColor || ''}</td>
                        <td><strong>${driver.licensePlate || '-'}</strong></td>
                        <td><span class="badge badge-info">${driver.vehicleType}</span></td>
                        <td>${driver.isOnline ? '<span class="badge badge-success">Online</span>' : '<span class="badge badge-danger">Offline</span>'}</td>
                        <td>⭐ ${driver.rating.toFixed(1)}</td>
                        <td>
                            <button class="btn btn-primary" onclick="editDriver('${driver.id}')" style="padding: 6px 12px; font-size: 12px;">Edit</button>
                            <button class="btn btn-danger" onclick="deleteDriver('${driver.id}')" style="padding: 6px 12px; font-size: 12px;">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `
    document.getElementById('driversTable').innerHTML = html
}

async function editDriver(driverId) {
    try {
        const res = await fetch(`${API_BASE}/api/drivers?page=1&pageSize=100`)
        const data = await res.json()
        const driver = data.data.find(d => d.id === driverId)
        
        if (!driver) return
        
        currentDriverId = driverId
        document.getElementById('editDriverOnline').value = driver.isOnline.toString()
        document.getElementById('editDriverVehicleType').value = driver.vehicleType
        document.getElementById('editDriverPlate').value = driver.licensePlate || ''
        document.getElementById('editDriverMake').value = driver.vehicleMake || ''
        document.getElementById('editDriverModel').value = driver.vehicleModel || ''
        document.getElementById('editDriverColor').value = driver.vehicleColor || ''
        
        document.getElementById('editDriverModal').classList.add('show')
    } catch (error) {
        showMessage('driversMessage', 'Error loading driver: ' + error.message, 'error')
    }
}

document.getElementById('editDriverForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const updates = {
        isOnline: document.getElementById('editDriverOnline').value === 'true',
        vehicleType: document.getElementById('editDriverVehicleType').value,
        licensePlate: document.getElementById('editDriverPlate').value,
        vehicleMake: document.getElementById('editDriverMake').value,
        vehicleModel: document.getElementById('editDriverModel').value,
        vehicleColor: document.getElementById('editDriverColor').value
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/drivers/${currentDriverId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        })
        const data = await res.json()
        
        if (data.success) {
            showMessage('driversMessage', 'Driver updated successfully', 'success')
            closeEditDriver()
            loadDrivers(currentPage.drivers)
        } else {
            alert('Error: ' + data.error)
        }
    } catch (error) {
        alert('Error updating driver: ' + error.message)
    }
})

function closeEditDriver() {
    document.getElementById('editDriverModal').classList.remove('show')
    currentDriverId = null
}

// Create Driver
function showCreateDriver() {
    document.getElementById('createDriverModal').classList.add('show')
}

function closeCreateDriver() {
    document.getElementById('createDriverModal').classList.remove('show')
    document.getElementById('createDriverForm').reset()
}

document.getElementById('createDriverForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const driverData = {
        did: document.getElementById('createDriverDid').value,
        handle: document.getElementById('createDriverHandle').value,
        displayName: document.getElementById('createDriverDisplayName').value || undefined,
        vehicleType: document.getElementById('createDriverVehicleType').value,
        licensePlate: document.getElementById('createDriverPlate').value,
        vehicleMake: document.getElementById('createDriverMake').value || undefined,
        vehicleModel: document.getElementById('createDriverModel').value || undefined,
        vehicleColor: document.getElementById('createDriverColor').value || undefined,
        vehicleYear: document.getElementById('createDriverYear').value ? parseInt(document.getElementById('createDriverYear').value) : undefined,
        availabilityType: document.getElementById('createDriverAvailability').value
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/drivers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(driverData)
        })
        
        const data = await res.json()
        
        if (data.success) {
            showMessage('driversMessage', '✓ Driver created successfully', 'success')
            closeCreateDriver()
            loadDrivers()
        } else {
            showMessage('driversMessage', `✗ ${data.error}`, 'error')
        }
    } catch (error) {
        showMessage('driversMessage', `✗ Failed to create driver: ${error.message}`, 'error')
    }
})

async function deleteDriver(driverId) {
    if (!confirm('Are you sure you want to delete this driver?')) {
        return
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/drivers/${driverId}`, { method: 'DELETE' })
        const data = await res.json()
        
        if (data.success) {
            showMessage('driversMessage', 'Driver deleted successfully', 'success')
            loadDrivers(currentPage.drivers)
        } else {
            showMessage('driversMessage', 'Error: ' + data.error, 'error')
        }
    } catch (error) {
        showMessage('driversMessage', 'Error deleting driver: ' + error.message, 'error')
    }
}

// ============================================================================
// Orders
// ============================================================================

async function loadOrders(page = 1) {
    currentPage.orders = page
    const status = document.getElementById('orderFilter').value
    
    try {
        showLoading('ordersTable')
        const url = `${API_BASE}/api/orders?page=${page}&pageSize=20${status ? '&status=' + status : ''}`
        const res = await fetch(url)
        const data = await res.json()
        
        if (data.success) {
            renderOrdersTable(data.data)
            renderPagination('ordersPagination', data.meta, loadOrders)
            showMessage('ordersMessage', `Loaded ${data.data.length} orders`, 'success')
        }
    } catch (error) {
        showMessage('ordersMessage', 'Error loading orders: ' + error.message, 'error')
        document.getElementById('ordersTable').innerHTML = ''
    }
}

function renderOrdersTable(orders) {
    const html = `
        <table>
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>User</th>
                    <th>Driver</th>
                    <th>Pickup</th>
                    <th>Dropoff</th>
                    <th>Fare</th>
                    <th>Date</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map(order => `
                    <tr>
                        <td><code style="font-size: 10px;">${order.id.substring(0, 8)}...</code></td>
                        <td><span class="badge badge-info">${order.type}</span></td>
                        <td>${getStatusBadge(order.status)}</td>
                        <td>${order.user.handle || 'Unknown'}</td>
                        <td>${order.driver?.handle || '-'}</td>
                        <td title="${order.pickupAddress}">${order.pickupAddress.substring(0, 30)}...</td>
                        <td title="${order.dropoffAddress}">${order.dropoffAddress.substring(0, 30)}...</td>
                        <td>$${(order.finalFare || order.estimatedFare).toFixed(2)}</td>
                        <td>${new Date(order.requestedAt).toLocaleDateString()}</td>
                        <td>
                            <button class="btn btn-danger" onclick="deleteOrder('${order.id}')" style="padding: 6px 12px; font-size: 12px;">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `
    document.getElementById('ordersTable').innerHTML = html
}

function getStatusBadge(status) {
    const badges = {
        'PENDING': 'warning',
        'DRIVER_ASSIGNED': 'info',
        'DRIVER_ARRIVING': 'info',
        'ARRIVED': 'info',
        'IN_PROGRESS': 'info',
        'COMPLETED': 'success',
        'CANCELLED': 'danger'
    }
    return `<span class="badge badge-${badges[status] || 'info'}">${status}</span>`
}

async function deleteOrder(orderId) {
    if (!confirm('Are you sure you want to delete this order?')) {
        return
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/orders/${orderId}`, { method: 'DELETE' })
        const data = await res.json()
        
        if (data.success) {
            showMessage('ordersMessage', 'Order deleted successfully', 'success')
            loadOrders(currentPage.orders)
        } else {
            showMessage('ordersMessage', 'Error: ' + data.error, 'error')
        }
    } catch (error) {
        showMessage('ordersMessage', 'Error deleting order: ' + error.message, 'error')
    }
}

// ============================================================================
// Create Order
// ============================================================================

function showCreateOrder() {
    document.getElementById('createOrderModal').classList.add('show')
}

function closeCreateOrder() {
    document.getElementById('createOrderModal').classList.remove('show')
    document.getElementById('createOrderForm').reset()
    document.getElementById('deliveryFields').style.display = 'none'
}

function toggleDeliveryFields() {
    const orderType = document.getElementById('createOrderType').value
    const deliveryFields = document.getElementById('deliveryFields')
    deliveryFields.style.display = orderType === 'DELIVERY' ? 'block' : 'none'
}

document.getElementById('createOrderForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const orderType = document.getElementById('createOrderType').value
    
    const orderData = {
        userDid: document.getElementById('createOrderUserDid').value,
        type: orderType,
        vehicleType: document.getElementById('createOrderVehicleType').value,
        
        // Pickup
        pickupAddress: document.getElementById('createOrderPickupAddress').value,
        pickupName: document.getElementById('createOrderPickupName').value || undefined,
        pickupLatitude: document.getElementById('createOrderPickupLat').value,
        pickupLongitude: document.getElementById('createOrderPickupLon').value,
        
        // Dropoff
        dropoffAddress: document.getElementById('createOrderDropoffAddress').value,
        dropoffName: document.getElementById('createOrderDropoffName').value || undefined,
        dropoffLatitude: document.getElementById('createOrderDropoffLat').value,
        dropoffLongitude: document.getElementById('createOrderDropoffLon').value,
        
        // Fare
        estimatedFare: document.getElementById('createOrderFare').value ? parseFloat(document.getElementById('createOrderFare').value) : undefined
    }
    
    // Add delivery-specific fields
    if (orderType === 'DELIVERY') {
        orderData.packageSize = document.getElementById('createOrderPackageSize').value
        orderData.packageDescription = document.getElementById('createOrderPackageDesc').value || undefined
        orderData.recipientName = document.getElementById('createOrderRecipientName').value || undefined
        orderData.recipientPhone = document.getElementById('createOrderRecipientPhone').value || undefined
        orderData.deliveryInstructions = document.getElementById('createOrderDeliveryInstructions').value || undefined
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        })
        
        const data = await res.json()
        
        if (data.success) {
            showMessage('ordersMessage', `✓ ${data.message}`, 'success')
            closeCreateOrder()
            loadOrders()
        } else {
            showMessage('ordersMessage', `✗ ${data.error}`, 'error')
        }
    } catch (error) {
        showMessage('ordersMessage', `✗ Failed to create order: ${error.message}`, 'error')
    }
})

// ============================================================================
// Vehicle Types
// ============================================================================

let currentVehicleTypeId = null

async function loadVehicleTypes() {
    try {
        showLoading('vehicleTypesTable')
        const res = await fetch(`${API_BASE}/api/vehicle-types`)
        const data = await res.json()
        
        if (data.success) {
            renderVehicleTypesTable(data.data)
        } else {
            document.getElementById('vehicleTypesTable').innerHTML = `<p>Error: ${data.error}</p>`
        }
    } catch (error) {
        document.getElementById('vehicleTypesTable').innerHTML = `<p>Error: ${error.message}</p>`
    }
}

function renderVehicleTypesTable(vehicleTypes) {
    if (vehicleTypes.length === 0) {
        document.getElementById('vehicleTypesTable').innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <p>No vehicle types configured.</p>
                <p>Click "Seed Defaults" to add default vehicle types.</p>
            </div>
        `
        return
    }

    const html = `
        <table>
            <thead>
                <tr>
                    <th>Order</th>
                    <th>Icon</th>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Capacity</th>
                    <th>Base Fare</th>
                    <th>Per KM</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${vehicleTypes.map(vt => `
                    <tr>
                        <td>${vt.sortOrder}</td>
                        <td style="font-size: 24px;">${vt.icon}</td>
                        <td><code>${vt.code}</code></td>
                        <td><strong>${vt.name}</strong></td>
                        <td>${vt.description || '-'}</td>
                        <td>${vt.capacity}</td>
                        <td>$${vt.baseFare.toFixed(2)}</td>
                        <td>$${vt.perKmRate.toFixed(2)}</td>
                        <td>
                            ${vt.isActive ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}
                            ${vt.isPromo ? `<span class="badge badge-info">${vt.promoText || 'Promo'}</span>` : ''}
                        </td>
                        <td>
                            <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick="editVehicleType('${vt.id}')">Edit</button>
                            <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="deleteVehicleType('${vt.id}', '${vt.name}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `
    document.getElementById('vehicleTypesTable').innerHTML = html
}

function showCreateVehicleType() {
    currentVehicleTypeId = null
    document.getElementById('vehicleTypeModalTitle').textContent = 'Add Vehicle Type'
    document.getElementById('vehicleTypeForm').reset()
    document.getElementById('vehicleTypeId').value = ''
    document.getElementById('promoTextGroup').style.display = 'none'
    document.getElementById('vehicleTypeModal').classList.add('show')
}

async function editVehicleType(id) {
    try {
        const res = await fetch(`${API_BASE}/api/vehicle-types/${id}`)
        const data = await res.json()
        
        if (data.success) {
            const vt = data.data
            currentVehicleTypeId = id
            
            document.getElementById('vehicleTypeModalTitle').textContent = 'Edit Vehicle Type'
            document.getElementById('vehicleTypeId').value = id
            document.getElementById('vehicleTypeCode').value = vt.code
            document.getElementById('vehicleTypeName').value = vt.name
            document.getElementById('vehicleTypeDescription').value = vt.description || ''
            document.getElementById('vehicleTypeIcon').value = vt.icon
            document.getElementById('vehicleTypeCapacity').value = vt.capacity
            document.getElementById('vehicleTypeBaseFare').value = vt.baseFare
            document.getElementById('vehicleTypePerKm').value = vt.perKmRate
            document.getElementById('vehicleTypePerMin').value = vt.perMinuteRate
            document.getElementById('vehicleTypeMinFare').value = vt.minimumFare
            document.getElementById('vehicleTypeFeatures').value = (vt.features || []).join(', ')
            document.getElementById('vehicleTypeSortOrder').value = vt.sortOrder
            document.getElementById('vehicleTypeActive').value = vt.isActive ? 'true' : 'false'
            document.getElementById('vehicleTypeIsPromo').value = vt.isPromo ? 'true' : 'false'
            document.getElementById('vehicleTypePromoText').value = vt.promoText || ''
            
            togglePromoText()
            document.getElementById('vehicleTypeModal').classList.add('show')
        }
    } catch (error) {
        showMessage('vehicleTypesMessage', 'Error loading vehicle type: ' + error.message, 'error')
    }
}

function closeVehicleTypeModal() {
    document.getElementById('vehicleTypeModal').classList.remove('show')
    currentVehicleTypeId = null
}

function togglePromoText() {
    const isPromo = document.getElementById('vehicleTypeIsPromo').value === 'true'
    document.getElementById('promoTextGroup').style.display = isPromo ? 'block' : 'none'
}

document.getElementById('vehicleTypeForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const featuresStr = document.getElementById('vehicleTypeFeatures').value
    const features = featuresStr ? featuresStr.split(',').map(f => f.trim()).filter(f => f) : []
    
    const payload = {
        code: document.getElementById('vehicleTypeCode').value.toUpperCase(),
        name: document.getElementById('vehicleTypeName').value,
        description: document.getElementById('vehicleTypeDescription').value,
        icon: document.getElementById('vehicleTypeIcon').value || '🚗',
        capacity: parseInt(document.getElementById('vehicleTypeCapacity').value) || 4,
        baseFare: parseFloat(document.getElementById('vehicleTypeBaseFare').value) || 2.50,
        perKmRate: parseFloat(document.getElementById('vehicleTypePerKm').value) || 1.20,
        perMinuteRate: parseFloat(document.getElementById('vehicleTypePerMin').value) || 0.15,
        minimumFare: parseFloat(document.getElementById('vehicleTypeMinFare').value) || 5.00,
        features: features,
        sortOrder: parseInt(document.getElementById('vehicleTypeSortOrder').value) || 0,
        isActive: document.getElementById('vehicleTypeActive').value === 'true',
        isPromo: document.getElementById('vehicleTypeIsPromo').value === 'true',
        promoText: document.getElementById('vehicleTypePromoText').value || null
    }
    
    try {
        const id = document.getElementById('vehicleTypeId').value
        const url = id ? `${API_BASE}/api/vehicle-types/${id}` : `${API_BASE}/api/vehicle-types`
        const method = id ? 'PATCH' : 'POST'
        
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        
        const data = await res.json()
        
        if (data.success) {
            closeVehicleTypeModal()
            showMessage('vehicleTypesMessage', id ? 'Vehicle type updated!' : 'Vehicle type created!', 'success')
            loadVehicleTypes()
        } else {
            showMessage('vehicleTypesMessage', 'Error: ' + data.error, 'error')
        }
    } catch (error) {
        showMessage('vehicleTypesMessage', 'Error: ' + error.message, 'error')
    }
})

async function deleteVehicleType(id, name) {
    if (!confirm(`Delete vehicle type "${name}"? This cannot be undone.`)) return
    
    try {
        const res = await fetch(`${API_BASE}/api/vehicle-types/${id}`, { method: 'DELETE' })
        const data = await res.json()
        
        if (data.success) {
            showMessage('vehicleTypesMessage', 'Vehicle type deleted!', 'success')
            loadVehicleTypes()
        } else {
            showMessage('vehicleTypesMessage', 'Error: ' + data.error, 'error')
        }
    } catch (error) {
        showMessage('vehicleTypesMessage', 'Error: ' + error.message, 'error')
    }
}

async function seedVehicleTypes() {
    if (!confirm('This will create default vehicle types. Existing ones will be skipped. Continue?')) return
    
    try {
        const res = await fetch(`${API_BASE}/api/vehicle-types/seed`, { method: 'POST' })
        const data = await res.json()
        
        if (data.success) {
            showMessage('vehicleTypesMessage', data.message, 'success')
            loadVehicleTypes()
        } else {
            showMessage('vehicleTypesMessage', 'Error: ' + data.error, 'error')
        }
    } catch (error) {
        showMessage('vehicleTypesMessage', 'Error: ' + error.message, 'error')
    }
}

// ============================================================================
// Utilities
// ============================================================================

function showMessage(elementId, message, type) {
    const el = document.getElementById(elementId)
    el.className = `message ${type} show`
    el.textContent = message
    setTimeout(() => {
        el.classList.remove('show')
    }, 5000)
}

function showLoading(elementId) {
    document.getElementById(elementId).innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <div>Loading...</div>
        </div>
    `
}

function renderPagination(elementId, meta, loadFunction) {
    const totalPages = Math.ceil(meta.total / meta.pageSize)
    const current = meta.page
    
    let html = ''
    
    if (current > 1) {
        html += `<button onclick="${loadFunction.name}(${current - 1})">← Previous</button>`
    }
    
    for (let i = Math.max(1, current - 2); i <= Math.min(totalPages, current + 2); i++) {
        html += `<button class="${i === current ? 'active' : ''}" onclick="${loadFunction.name}(${i})">${i}</button>`
    }
    
    if (current < totalPages) {
        html += `<button onclick="${loadFunction.name}(${current + 1})">Next →</button>`
    }
    
    document.getElementById(elementId).innerHTML = html
}

// Initialize
loadDashboard()

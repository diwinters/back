// Admin Panel JavaScript

const API_BASE = window.location.origin

let currentDriverId = null
let currentDriverDid = null
let currentPage = { users: 1, drivers: 1, orders: 1 }
let vehicleTypesCache = [] // Cache for vehicle types

// ============================================================================
// Vehicle Types Management (Dynamic)
// ============================================================================

async function loadVehicleTypesForDropdown() {
    try {
        const res = await fetch(`${API_BASE}/api/vehicle-types`)
        const data = await res.json()
        
        if (data.success && data.data.length > 0) {
            vehicleTypesCache = data.data
        } else {
            // Fallback to defaults if no vehicle types configured
            vehicleTypesCache = [
                { code: 'ECONOMY', name: 'Economy' },
                { code: 'COMFORT', name: 'Comfort' },
                { code: 'PREMIUM', name: 'Premium' },
                { code: 'XL', name: 'XL' },
                { code: 'MOTO', name: 'Moto' },
                { code: 'BIKE', name: 'Bike' }
            ]
        }
        
        populateVehicleTypeDropdowns()
    } catch (error) {
        console.error('Failed to load vehicle types:', error)
        // Use fallback
        vehicleTypesCache = [
            { code: 'ECONOMY', name: 'Economy' },
            { code: 'COMFORT', name: 'Comfort' },
            { code: 'PREMIUM', name: 'Premium' },
            { code: 'XL', name: 'XL' },
            { code: 'MOTO', name: 'Moto' },
            { code: 'BIKE', name: 'Bike' }
        ]
        populateVehicleTypeDropdowns()
    }
}

function populateVehicleTypeDropdowns() {
    const dropdowns = [
        'createDriverVehicleType',
        'editDriverVehicleType',
        'createOrderVehicleType'
    ]
    
    const optionsHtml = vehicleTypesCache.map(vt => 
        `<option value="${vt.code}">${vt.icon || ''} ${vt.name}</option>`
    ).join('')
    
    dropdowns.forEach(id => {
        const el = document.getElementById(id)
        if (el) {
            el.innerHTML = optionsHtml
        }
    })
}

// ============================================================================
// File Upload Functions
// ============================================================================

function previewImage(input, previewId) {
    const preview = document.getElementById(previewId)
    const zone = input.closest('.upload-zone')
    
    if (input.files && input.files[0]) {
        const reader = new FileReader()
        
        reader.onload = function(e) {
            preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`
            zone.classList.add('has-image')
        }
        
        reader.readAsDataURL(input.files[0])
    }
}

async function uploadAvatar(did, fileInput) {
    if (!fileInput.files || !fileInput.files[0]) return null
    
    const formData = new FormData()
    formData.append('avatar', fileInput.files[0])
    formData.append('did', did)
    
    try {
        const res = await fetch(`${API_BASE}/api/upload/avatar/${encodeURIComponent(did)}`, {
            method: 'POST',
            body: formData
        })
        const data = await res.json()
        
        if (data.success) {
            return data.data.url
        } else {
            console.error('Avatar upload failed:', data.error)
            return null
        }
    } catch (error) {
        console.error('Avatar upload error:', error)
        return null
    }
}

async function uploadVehicleImage(did, fileInput) {
    if (!fileInput.files || !fileInput.files[0]) return null
    
    const formData = new FormData()
    formData.append('vehicleImage', fileInput.files[0])
    formData.append('did', did)
    
    try {
        const res = await fetch(`${API_BASE}/api/upload/vehicle/${encodeURIComponent(did)}`, {
            method: 'POST',
            body: formData
        })
        const data = await res.json()
        
        if (data.success && data.data.length > 0) {
            return data.data[0].url
        } else {
            console.error('Vehicle image upload failed:', data.error)
            return null
        }
    } catch (error) {
        console.error('Vehicle image upload error:', error)
        return null
    }
}

function resetUploadPreview(previewId, defaultIcon, defaultText) {
    const preview = document.getElementById(previewId)
    const zone = preview?.closest('.upload-zone')
    
    if (preview) {
        preview.innerHTML = `
            <span class="upload-icon">${defaultIcon}</span>
            <span>${defaultText}</span>
        `
    }
    if (zone) {
        zone.classList.remove('has-image')
    }
}

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
    if (tabName === 'cities') loadCities()
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
                    <th>Photo</th>
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
                        <td>
                            ${driver.user.avatarUrl 
                                ? `<img src="${driver.user.avatarUrl}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">` 
                                : '<span style="display: inline-block; width: 40px; height: 40px; border-radius: 50%; background: #e5e7eb; text-align: center; line-height: 40px;">👤</span>'}
                        </td>
                        <td>
                            <div><strong>${driver.user.handle || '-'}</strong></div>
                            <div style="font-size: 10px; color: #6b7280;">${driver.user.did.substring(0, 20)}...</div>
                        </td>
                        <td>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                ${driver.vehicleImageUrl 
                                    ? `<img src="${driver.vehicleImageUrl}" alt="Vehicle" style="width: 50px; height: 35px; border-radius: 4px; object-fit: cover;">` 
                                    : ''}
                                <div>
                                    <div>${driver.vehicleMake || ''} ${driver.vehicleModel || ''}</div>
                                    <div style="font-size: 11px; color: #6b7280;">${driver.vehicleColor || ''}</div>
                                </div>
                            </div>
                        </td>
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
        currentDriverDid = driver.user.did
        
        document.getElementById('editDriverDid').value = driver.user.did
        document.getElementById('editDriverOnline').value = driver.isOnline.toString()
        document.getElementById('editDriverVehicleType').value = driver.vehicleType
        document.getElementById('editDriverPlate').value = driver.licensePlate || ''
        document.getElementById('editDriverMake').value = driver.vehicleMake || ''
        document.getElementById('editDriverModel').value = driver.vehicleModel || ''
        document.getElementById('editDriverColor').value = driver.vehicleColor || ''
        document.getElementById('editDriverCity').value = driver.cityId || ''
        
        // Reset and show existing images
        resetUploadPreview('editDriverAvatarPreview', '📷', 'Click to upload profile photo')
        resetUploadPreview('editDriverVehiclePreview', '🚗', 'Click to upload vehicle photo')
        
        // Show existing avatar if available
        if (driver.user.avatarUrl) {
            const avatarPreview = document.getElementById('editDriverAvatarPreview')
            const avatarZone = avatarPreview?.closest('.upload-zone')
            avatarPreview.innerHTML = `<img src="${driver.user.avatarUrl}" alt="Profile">`
            avatarZone?.classList.add('has-image')
        }
        
        // Show existing vehicle image if available
        if (driver.vehicleImageUrl) {
            const vehiclePreview = document.getElementById('editDriverVehiclePreview')
            const vehicleZone = vehiclePreview?.closest('.upload-zone')
            vehiclePreview.innerHTML = `<img src="${driver.vehicleImageUrl}" alt="Vehicle">`
            vehicleZone?.classList.add('has-image')
        }
        
        document.getElementById('editDriverModal').classList.add('show')
    } catch (error) {
        showMessage('driversMessage', 'Error loading driver: ' + error.message, 'error')
    }
}

document.getElementById('editDriverForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const did = document.getElementById('editDriverDid').value
    
    // Upload images if selected
    const avatarInput = document.getElementById('editDriverAvatarInput')
    const vehicleInput = document.getElementById('editDriverVehicleInput')
    
    let avatarUrl = null
    let vehicleImageUrl = null
    
    if (avatarInput.files && avatarInput.files[0]) {
        showMessage('driversMessage', 'Uploading avatar...', 'success')
        avatarUrl = await uploadAvatar(did, avatarInput)
    }
    
    if (vehicleInput.files && vehicleInput.files[0]) {
        showMessage('driversMessage', 'Uploading vehicle image...', 'success')
        vehicleImageUrl = await uploadVehicleImage(did, vehicleInput)
    }
    
    const updates = {
        isOnline: document.getElementById('editDriverOnline').value === 'true',
        vehicleType: document.getElementById('editDriverVehicleType').value,
        licensePlate: document.getElementById('editDriverPlate').value,
        vehicleMake: document.getElementById('editDriverMake').value,
        vehicleModel: document.getElementById('editDriverModel').value,
        vehicleColor: document.getElementById('editDriverColor').value,
        cityId: document.getElementById('editDriverCity').value || null
    }
    
    // Add vehicleImageUrl if uploaded
    if (vehicleImageUrl) {
        updates.vehicleImageUrl = vehicleImageUrl
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
    currentDriverDid = null
    
    // Reset file inputs
    document.getElementById('editDriverAvatarInput').value = ''
    document.getElementById('editDriverVehicleInput').value = ''
    
    // Reset previews
    resetUploadPreview('editDriverAvatarPreview', '📷', 'Click to upload profile photo')
    resetUploadPreview('editDriverVehiclePreview', '🚗', 'Click to upload vehicle photo')
}

// Create Driver
function showCreateDriver() {
    // Load vehicle types before showing modal
    loadVehicleTypesForDropdown()
    document.getElementById('createDriverModal').classList.add('show')
}

function closeCreateDriver() {
    document.getElementById('createDriverModal').classList.remove('show')
    document.getElementById('createDriverForm').reset()
    
    // Reset file inputs
    document.getElementById('createDriverAvatarInput').value = ''
    document.getElementById('createDriverVehicleInput').value = ''
    
    // Reset previews
    resetUploadPreview('createDriverAvatarPreview', '📷', 'Click to upload profile photo')
    resetUploadPreview('createDriverVehiclePreview', '🚗', 'Click to upload vehicle photo')
}

document.getElementById('createDriverForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const did = document.getElementById('createDriverDid').value
    
    const driverData = {
        did: did,
        handle: document.getElementById('createDriverHandle').value,
        displayName: document.getElementById('createDriverDisplayName').value || undefined,
        vehicleType: document.getElementById('createDriverVehicleType').value,
        licensePlate: document.getElementById('createDriverPlate').value,
        vehicleMake: document.getElementById('createDriverMake').value || undefined,
        vehicleModel: document.getElementById('createDriverModel').value || undefined,
        vehicleColor: document.getElementById('createDriverColor').value || undefined,
        vehicleYear: document.getElementById('createDriverYear').value ? parseInt(document.getElementById('createDriverYear').value) : undefined,
        availabilityType: document.getElementById('createDriverAvailability').value,
        cityId: document.getElementById('createDriverCity').value || null
    }
    
    try {
        // First create the driver
        const res = await fetch(`${API_BASE}/api/drivers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(driverData)
        })
        
        const data = await res.json()
        
        if (data.success) {
            // Now upload images if provided
            const avatarInput = document.getElementById('createDriverAvatarInput')
            const vehicleInput = document.getElementById('createDriverVehicleInput')
            
            if (avatarInput.files && avatarInput.files[0]) {
                showMessage('driversMessage', 'Uploading avatar...', 'success')
                await uploadAvatar(did, avatarInput)
            }
            
            if (vehicleInput.files && vehicleInput.files[0]) {
                showMessage('driversMessage', 'Uploading vehicle image...', 'success')
                const vehicleImageUrl = await uploadVehicleImage(did, vehicleInput)
                
                // Update driver with vehicle image URL
                if (vehicleImageUrl && data.data.id) {
                    await fetch(`${API_BASE}/api/drivers/${data.data.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ vehicleImageUrl })
                    })
                }
            }
            
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
loadVehicleTypesForDropdown() // Load vehicle types for dropdowns
loadCitiesForDropdown() // Load cities for driver dropdowns

// ============================================================================
// Cities Management
// ============================================================================

let cityMap = null
let cityMarker = null
let citiesCache = []

const MAPBOX_TOKEN = 'pk.eyJ1IjoiZGl3aW50ZXIiLCJhIjoiY21pYndocXRqMHpuZjJpc2F0d2ppdXYwOCJ9.5SLdcEQmHoGpNKnzJ5Oq7A'

async function loadCitiesForDropdown() {
    try {
        const res = await fetch(`${API_BASE}/api/cities`)
        citiesCache = await res.json()
        populateCityDropdowns()
    } catch (error) {
        console.error('Failed to load cities:', error)
    }
}

function populateCityDropdowns() {
    const dropdowns = ['createDriverCity', 'editDriverCity']
    
    const optionsHtml = '<option value="">-- No City (Global) --</option>' + 
        citiesCache
            .filter(c => c.isActive)
            .map(c => `<option value="${c.id}">${c.name} (${c.code})</option>`)
            .join('')
    
    dropdowns.forEach(id => {
        const el = document.getElementById(id)
        if (el) el.innerHTML = optionsHtml
    })
}

async function loadCities() {
    try {
        const res = await fetch(`${API_BASE}/api/cities`)
        const cities = await res.json()
        citiesCache = cities
        
        const tbody = document.getElementById('citiesBody')
        if (!tbody) return
        
        tbody.innerHTML = cities.map(city => `
            <tr>
                <td>
                    ${city.imageUrl 
                        ? `<img src="${city.imageUrl}" style="width: 60px; height: 40px; object-fit: cover; border-radius: 4px;">` 
                        : '<span style="color: #999; font-size: 12px;">No image</span>'}
                </td>
                <td><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${city.code}</code></td>
                <td><strong>${city.name}</strong></td>
                <td>${city.country}</td>
                <td style="font-size: 11px; font-family: monospace;">${city.centerLatitude.toFixed(4)}, ${city.centerLongitude.toFixed(4)}</td>
                <td>${city.radiusKm} km</td>
                <td>${city._count?.drivers || 0}</td>
                <td>${city._count?.orders || 0}</td>
                <td>
                    <span class="badge ${city.isActive ? 'badge-success' : 'badge-danger'}">
                        ${city.isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-primary" style="padding: 6px 10px; font-size: 12px;" onclick="editCity('${city.id}')">✏️ Edit</button>
                    <button class="btn btn-success" style="padding: 6px 10px; font-size: 12px;" onclick="showCityPricing('${city.id}', '${city.name}')">💰 Pricing</button>
                    <button class="btn" style="padding: 6px 10px; font-size: 12px; background: #8b5cf6; color: white;" onclick="showWalkthroughConfig('${city.id}', '${city.name}', ${city.centerLatitude}, ${city.centerLongitude})">🎬 Tour</button>
                    <button class="btn btn-danger" style="padding: 6px 10px; font-size: 12px;" onclick="deleteCity('${city.id}')">🗑️</button>
                </td>
            </tr>
        `).join('')
        
        showMessage('citiesMessage', `Loaded ${cities.length} cities`, 'success')
        populateCityDropdowns()
    } catch (error) {
        showMessage('citiesMessage', 'Error: ' + error.message, 'error')
    }
}

async function seedCities() {
    if (!confirm('Seed default Moroccan cities (Dakhla, Laâyoune, Casablanca, Rabat, Marrakech, Agadir)?')) return
    
    try {
        const res = await fetch(`${API_BASE}/api/cities/seed`, { method: 'POST' })
        const result = await res.json()
        
        if (result.success) {
            const created = result.cities.filter(c => c.status === 'created').length
            const existing = result.cities.filter(c => c.status === 'exists').length
            showMessage('citiesMessage', `Seeded ${created} new cities, ${existing} already existed`, 'success')
            loadCities()
        } else {
            showMessage('citiesMessage', 'Error: ' + result.error, 'error')
        }
    } catch (error) {
        showMessage('citiesMessage', 'Error: ' + error.message, 'error')
    }
}

function showCityForm(cityData = null) {
    document.getElementById('cityFormModal').style.display = 'flex'
    document.getElementById('cityFormTitle').textContent = cityData ? '✏️ Edit City' : '➕ Add City'
    
    // Reset form
    document.getElementById('cityId').value = cityData?.id || ''
    document.getElementById('cityCode').value = cityData?.code || ''
    document.getElementById('cityName').value = cityData?.name || ''
    document.getElementById('cityCountry').value = cityData?.country || 'MA'
    document.getElementById('cityCurrency').value = cityData?.currency || 'MAD'
    document.getElementById('cityTimezone').value = cityData?.timezone || 'Africa/Casablanca'
    document.getElementById('cityLat').value = cityData?.centerLatitude || ''
    document.getElementById('cityLng').value = cityData?.centerLongitude || ''
    document.getElementById('cityRadius').value = cityData?.radiusKm || 50
    document.getElementById('cityActive').value = cityData?.isActive !== false ? 'true' : 'false'
    document.getElementById('cityImage').value = ''
    updateRadiusDisplay()
    
    // Initialize map after a short delay to ensure modal is visible
    setTimeout(() => initCityMapPicker(cityData), 150)
}

function hideCityForm() {
    document.getElementById('cityFormModal').style.display = 'none'
    if (cityMap) {
        cityMap.remove()
        cityMap = null
    }
}

function initCityMapPicker(cityData) {
    const container = document.getElementById('cityMapPicker')
    if (!container) return
    
    // Clear any existing map
    if (cityMap) {
        cityMap.remove()
        cityMap = null
    }
    
    mapboxgl.accessToken = MAPBOX_TOKEN
    
    const defaultCenter = cityData 
        ? [cityData.centerLongitude, cityData.centerLatitude]
        : [-7.5898, 33.5731] // Morocco center (Casablanca)
    
    cityMap = new mapboxgl.Map({
        container: 'cityMapPicker',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: defaultCenter,
        zoom: cityData ? 9 : 5
    })
    
    cityMap.addControl(new mapboxgl.NavigationControl())
    
    // Add marker if editing
    if (cityData) {
        addCityMarkerAndCircle(defaultCenter, cityData.radiusKm)
    }
    
    // Click handler
    cityMap.on('click', (e) => {
        const { lng, lat } = e.lngLat
        document.getElementById('cityLat').value = lat.toFixed(6)
        document.getElementById('cityLng').value = lng.toFixed(6)
        addCityMarkerAndCircle([lng, lat], parseFloat(document.getElementById('cityRadius').value))
    })
}

function addCityMarkerAndCircle(center, radiusKm) {
    if (!cityMap) return
    
    // Remove existing marker
    if (cityMarker) {
        cityMarker.remove()
    }
    
    // Add new marker
    cityMarker = new mapboxgl.Marker({ color: '#667eea' })
        .setLngLat(center)
        .addTo(cityMap)
    
    // Add/update radius circle
    const circle = createGeoJSONCircle(center, radiusKm)
    
    if (cityMap.getSource('city-radius')) {
        cityMap.getSource('city-radius').setData(circle)
    } else {
        cityMap.on('load', () => {
            if (!cityMap.getSource('city-radius')) {
                cityMap.addSource('city-radius', { type: 'geojson', data: circle })
                cityMap.addLayer({
                    id: 'city-radius-fill',
                    type: 'fill',
                    source: 'city-radius',
                    paint: { 'fill-color': '#667eea', 'fill-opacity': 0.15 }
                })
                cityMap.addLayer({
                    id: 'city-radius-outline',
                    type: 'line',
                    source: 'city-radius',
                    paint: { 'line-color': '#667eea', 'line-width': 2, 'line-dasharray': [2, 2] }
                })
            }
        })
        
        // If map already loaded
        if (cityMap.isStyleLoaded()) {
            if (!cityMap.getSource('city-radius')) {
                cityMap.addSource('city-radius', { type: 'geojson', data: circle })
                cityMap.addLayer({
                    id: 'city-radius-fill',
                    type: 'fill',
                    source: 'city-radius',
                    paint: { 'fill-color': '#667eea', 'fill-opacity': 0.15 }
                })
                cityMap.addLayer({
                    id: 'city-radius-outline',
                    type: 'line',
                    source: 'city-radius',
                    paint: { 'line-color': '#667eea', 'line-width': 2, 'line-dasharray': [2, 2] }
                })
            }
        }
    }
}

function createGeoJSONCircle(center, radiusKm) {
    const points = 64
    const coords = []
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * 2 * Math.PI
        const dx = radiusKm * Math.cos(angle)
        const dy = radiusKm * Math.sin(angle)
        const lat = center[1] + (dy / 111.32)
        const lng = center[0] + (dx / (111.32 * Math.cos(center[1] * Math.PI / 180)))
        coords.push([lng, lat])
    }
    coords.push(coords[0]) // Close the polygon
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }
}

function updateRadiusDisplay() {
    const radius = document.getElementById('cityRadius').value
    document.getElementById('radiusValue').textContent = radius
    
    // Update circle on map if coordinates exist
    const lat = parseFloat(document.getElementById('cityLat').value)
    const lng = parseFloat(document.getElementById('cityLng').value)
    if (cityMap && !isNaN(lat) && !isNaN(lng)) {
        addCityMarkerAndCircle([lng, lat], parseFloat(radius))
    }
}

async function saveCity() {
    const id = document.getElementById('cityId').value
    const data = {
        code: document.getElementById('cityCode').value.toUpperCase(),
        name: document.getElementById('cityName').value,
        country: document.getElementById('cityCountry').value,
        currency: document.getElementById('cityCurrency').value,
        timezone: document.getElementById('cityTimezone').value,
        centerLatitude: parseFloat(document.getElementById('cityLat').value),
        centerLongitude: parseFloat(document.getElementById('cityLng').value),
        radiusKm: parseFloat(document.getElementById('cityRadius').value),
        isActive: document.getElementById('cityActive').value === 'true'
    }
    
    if (!data.code || !data.name || isNaN(data.centerLatitude) || isNaN(data.centerLongitude)) {
        showMessage('citiesMessage', 'Please fill in all required fields and select a location on the map', 'error')
        return
    }
    
    try {
        const url = id ? `${API_BASE}/api/cities/${id}` : `${API_BASE}/api/cities`
        const method = id ? 'PUT' : 'POST'
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
        
        const city = await response.json()
        if (city.error) throw new Error(city.error)
        
        // Upload image if selected
        const imageInput = document.getElementById('cityImage')
        if (imageInput.files.length > 0) {
            showMessage('citiesMessage', 'Uploading city image...', 'success')
            
            const formData = new FormData()
            formData.append('cityImage', imageInput.files[0])
            
            const uploadResponse = await fetch(`${API_BASE}/api/upload/city-image/${city.code}`, {
                method: 'POST',
                body: formData
            })
            const uploadResult = await uploadResponse.json()
            
            if (uploadResult.imageUrl) {
                // Update city with image URL
                await fetch(`${API_BASE}/api/cities/${city.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageUrl: uploadResult.imageUrl })
                })
            }
        }
        
        showMessage('citiesMessage', `City ${id ? 'updated' : 'created'} successfully`, 'success')
        hideCityForm()
        loadCities()
    } catch (error) {
        showMessage('citiesMessage', 'Error: ' + error.message, 'error')
    }
}

async function editCity(cityId) {
    const city = citiesCache.find(c => c.id === cityId)
    if (city) {
        showCityForm(city)
    } else {
        // Fetch fresh if not in cache
        try {
            const res = await fetch(`${API_BASE}/api/cities`)
            const cities = await res.json()
            citiesCache = cities
            const found = cities.find(c => c.id === cityId)
            if (found) showCityForm(found)
        } catch (error) {
            showMessage('citiesMessage', 'Error loading city: ' + error.message, 'error')
        }
    }
}

async function deleteCity(cityId) {
    const city = citiesCache.find(c => c.id === cityId)
    if (!confirm(`Delete city "${city?.name || cityId}"? This will unlink associated drivers and orders.`)) return
    
    try {
        await fetch(`${API_BASE}/api/cities/${cityId}`, { method: 'DELETE' })
        showMessage('citiesMessage', 'City deleted successfully', 'success')
        loadCities()
    } catch (error) {
        showMessage('citiesMessage', 'Error: ' + error.message, 'error')
    }
}

// City Pricing Modal
async function showCityPricing(cityId, cityName) {
    document.getElementById('cityPricingModal').style.display = 'flex'
    document.getElementById('pricingCityId').value = cityId
    document.getElementById('pricingCityName').textContent = cityName
    
    // Load vehicle types and existing pricing
    try {
        const [vehicleTypesRes, citiesRes] = await Promise.all([
            fetch(`${API_BASE}/api/vehicle-types`),
            fetch(`${API_BASE}/api/cities`)
        ])
        
        const vehicleTypesData = await vehicleTypesRes.json()
        const vehicleTypes = vehicleTypesData.success ? vehicleTypesData.data : vehicleTypesData
        const cities = await citiesRes.json()
        const city = cities.find(c => c.id === cityId)
        const existingPricing = city?.pricing || []
        
        const container = document.getElementById('pricingVehicleTypes')
        container.innerHTML = vehicleTypes.map(vt => {
            const pricing = existingPricing.find(p => p.vehicleTypeCode === vt.code) || {
                baseFare: vt.baseFare,
                perKmRate: vt.perKmRate,
                perMinuteRate: vt.perMinuteRate,
                minimumFare: vt.minimumFare,
                surgeMultiplier: 1.0
            }
            
            return `
                <div style="border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; margin-bottom: 10px; background: #fafafa;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <strong>${vt.icon || '🚗'} ${vt.name} <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 11px;">${vt.code}</code></strong>
                        <button class="btn btn-success" style="padding: 6px 12px; font-size: 12px;" onclick="saveCityPricing('${cityId}', '${vt.code}')">💾 Save</button>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;">
                        <div>
                            <label style="font-size: 11px; color: #666;">Base Fare</label>
                            <input type="number" id="price_${vt.code}_base" value="${pricing.baseFare}" step="0.01" style="width: 100%; padding: 6px;">
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #666;">Per Km</label>
                            <input type="number" id="price_${vt.code}_km" value="${pricing.perKmRate}" step="0.01" style="width: 100%; padding: 6px;">
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #666;">Per Minute</label>
                            <input type="number" id="price_${vt.code}_min" value="${pricing.perMinuteRate}" step="0.01" style="width: 100%; padding: 6px;">
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #666;">Minimum</label>
                            <input type="number" id="price_${vt.code}_minimum" value="${pricing.minimumFare}" step="0.01" style="width: 100%; padding: 6px;">
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #666;">Surge ×</label>
                            <input type="number" id="price_${vt.code}_surge" value="${pricing.surgeMultiplier}" step="0.1" min="1" style="width: 100%; padding: 6px;">
                        </div>
                    </div>
                </div>
            `
        }).join('')
    } catch (error) {
        showMessage('citiesMessage', 'Error loading pricing: ' + error.message, 'error')
    }
}

function hideCityPricingModal() {
    document.getElementById('cityPricingModal').style.display = 'none'
}

async function saveCityPricing(cityId, vehicleTypeCode) {
    const data = {
        vehicleTypeCode,
        baseFare: document.getElementById(`price_${vehicleTypeCode}_base`).value,
        perKmRate: document.getElementById(`price_${vehicleTypeCode}_km`).value,
        perMinuteRate: document.getElementById(`price_${vehicleTypeCode}_min`).value,
        minimumFare: document.getElementById(`price_${vehicleTypeCode}_minimum`).value,
        surgeMultiplier: document.getElementById(`price_${vehicleTypeCode}_surge`).value,
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/cities/${cityId}/pricing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
        const result = await response.json()
        if (result.error) throw new Error(result.error)
        showMessage('citiesMessage', `Pricing for ${vehicleTypeCode} saved!`, 'success')
    } catch (error) {
        showMessage('citiesMessage', 'Error: ' + error.message, 'error')
    }
}

async function seedCityPricing() {
    const cityId = document.getElementById('pricingCityId').value
    const cityName = document.getElementById('pricingCityName').textContent
    
    if (!confirm(`Seed default pricing for ${cityName} based on global vehicle types?`)) return
    
    try {
        const response = await fetch(`${API_BASE}/api/cities/${cityId}/seed-pricing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ multiplier: 1.0 })
        })
        const result = await response.json()
        
        if (result.success) {
            const created = result.pricing.filter(p => p.status === 'created').length
            showMessage('citiesMessage', `Seeded ${created} pricing configurations`, 'success')
            // Refresh the pricing modal
            showCityPricing(cityId, cityName)
        } else {
            showMessage('citiesMessage', 'Error: ' + result.error, 'error')
        }
    } catch (error) {
        showMessage('citiesMessage', 'Error: ' + error.message, 'error')
    }
}

// ============================================================================
// Walkthrough (Cinematic City Tour) Management
// ============================================================================

let walkthroughMap = null
let walkthroughMarkers = []
let currentWalkthroughCityId = null
let currentWalkthroughId = null
let walkthroughPoints = []

async function showWalkthroughConfig(cityId, cityName, centerLat, centerLng) {
    currentWalkthroughCityId = cityId
    document.getElementById('walkthroughCityName').textContent = cityName
    document.getElementById('walkthroughModal').style.display = 'flex'
    
    // Initialize map
    setTimeout(() => initWalkthroughMap(centerLng, centerLat), 150)
    
    // Load existing walkthrough if any
    await loadWalkthrough(cityId)
}

function hideWalkthroughModal() {
    document.getElementById('walkthroughModal').style.display = 'none'
    if (walkthroughMap) {
        walkthroughMap.remove()
        walkthroughMap = null
    }
    walkthroughMarkers = []
    walkthroughPoints = []
    currentWalkthroughId = null
    currentWalkthroughCityId = null
}

function initWalkthroughMap(centerLng, centerLat) {
    const container = document.getElementById('walkthroughMapPicker')
    if (!container) return
    
    if (walkthroughMap) {
        walkthroughMap.remove()
        walkthroughMap = null
    }
    
    mapboxgl.accessToken = MAPBOX_TOKEN
    
    walkthroughMap = new mapboxgl.Map({
        container: 'walkthroughMapPicker',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [centerLng || -7.5898, centerLat || 33.5731],
        zoom: 12,
        pitch: 45
    })
    
    // Click on map to add point
    walkthroughMap.on('click', (e) => {
        addWalkthroughPoint(e.lngLat.lat, e.lngLat.lng)
    })
    
    // Render existing points
    renderWalkthroughMarkers()
}

async function loadWalkthrough(cityId) {
    try {
        // Use admin endpoint to get walkthrough by cityId (includes inactive ones)
        console.log('[Admin] Loading walkthrough for city:', cityId)
        const res = await fetch(`${API_BASE}/api/admin/walkthroughs/by-city/${cityId}`)
        const data = await res.json()
        console.log('[Admin] Load response:', data)
        
        if (data.success && data.data) {
            currentWalkthroughId = data.data.id
            console.log('[Admin] Set currentWalkthroughId to:', currentWalkthroughId)
            walkthroughPoints = data.data.points || []
            document.getElementById('walkthroughName').value = data.data.name || ''
            document.getElementById('walkthroughDuration').value = data.data.defaultDurationMs || 3000
            document.getElementById('walkthroughActive').checked = data.data.isActive !== false
            
            renderWalkthroughPointsList()
            renderWalkthroughMarkers()
            showMessage('citiesMessage', `Loaded walkthrough with ${walkthroughPoints.length} points`, 'success')
        } else {
            console.log('[Admin] No walkthrough found, will create new')
            currentWalkthroughId = null
            walkthroughPoints = []
            document.getElementById('walkthroughName').value = ''
            document.getElementById('walkthroughDuration').value = 3000
            document.getElementById('walkthroughActive').checked = true
            renderWalkthroughPointsList()
        }
    } catch (error) {
        console.error('[Admin] Failed to load walkthrough:', error)
        currentWalkthroughId = null
        walkthroughPoints = []
        renderWalkthroughPointsList()
    }
}

function addWalkthroughPoint(lat, lng) {
    const newPoint = {
        id: 'temp_' + Date.now(),
        order: walkthroughPoints.length + 1,
        latitude: lat,
        longitude: lng,
        zoom: parseFloat(document.getElementById('walkthroughPointZoom')?.value) || 14,
        pitch: parseFloat(document.getElementById('walkthroughPointPitch')?.value) || 60,
        bearing: parseFloat(document.getElementById('walkthroughPointBearing')?.value) || 0,
        durationMs: null,
        label: `Point ${walkthroughPoints.length + 1}`
    }
    
    walkthroughPoints.push(newPoint)
    renderWalkthroughPointsList()
    renderWalkthroughMarkers()
}

function removeWalkthroughPoint(index) {
    walkthroughPoints.splice(index, 1)
    // Re-order remaining points
    walkthroughPoints.forEach((p, i) => p.order = i + 1)
    renderWalkthroughPointsList()
    renderWalkthroughMarkers()
}

function moveWalkthroughPoint(index, direction) {
    if (direction === 'up' && index > 0) {
        [walkthroughPoints[index], walkthroughPoints[index - 1]] = [walkthroughPoints[index - 1], walkthroughPoints[index]]
    } else if (direction === 'down' && index < walkthroughPoints.length - 1) {
        [walkthroughPoints[index], walkthroughPoints[index + 1]] = [walkthroughPoints[index + 1], walkthroughPoints[index]]
    }
    // Re-order
    walkthroughPoints.forEach((p, i) => p.order = i + 1)
    renderWalkthroughPointsList()
    renderWalkthroughMarkers()
}

function updateWalkthroughPointField(index, field, value) {
    if (walkthroughPoints[index]) {
        // String fields that should not be converted to numbers
        const stringFields = ['label', 'title', 'description', 'imageUrl']
        if (stringFields.includes(field)) {
            walkthroughPoints[index][field] = value
        } else if (field === 'durationMs') {
            walkthroughPoints[index][field] = value ? parseInt(value, 10) : null
        } else {
            walkthroughPoints[index][field] = parseFloat(value)
        }
    }
}

function renderWalkthroughPointsList() {
    const container = document.getElementById('walkthroughPointsList')
    if (!container) return
    
    if (walkthroughPoints.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">Click on the map to add waypoints for the tour</p>'
        return
    }
    
    container.innerHTML = walkthroughPoints.map((p, i) => `
        <div class="walkthrough-point-item" style="background: #f8f9fa; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <strong style="color: #333;">#${p.order} ${p.label || ''}</strong>
                <div>
                    <button onclick="moveWalkthroughPoint(${i}, 'up')" style="padding: 4px 8px; font-size: 10px;" ${i === 0 ? 'disabled' : ''}>⬆️</button>
                    <button onclick="moveWalkthroughPoint(${i}, 'down')" style="padding: 4px 8px; font-size: 10px;" ${i === walkthroughPoints.length - 1 ? 'disabled' : ''}>⬇️</button>
                    <button onclick="flyToPoint(${i})" style="padding: 4px 8px; font-size: 10px;">👁️</button>
                    <button onclick="removeWalkthroughPoint(${i})" style="padding: 4px 8px; font-size: 10px; color: red;">🗑️</button>
                </div>
            </div>
            
            <!-- Rich Content Section -->
            <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px; margin-bottom: 10px;">
                <div style="font-size: 11px; color: #8b5cf6; font-weight: 600; margin-bottom: 8px;">📝 Tour Stop Content</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                    <div>
                        <label style="font-size: 10px; color: #666;">Display Title</label>
                        <input type="text" value="${p.title || ''}" placeholder="e.g., Marina Bay" onchange="updateWalkthroughPointField(${i}, 'title', this.value)" style="width: 100%; padding: 6px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="font-size: 10px; color: #666;">Image URL</label>
                        <input type="text" value="${p.imageUrl || ''}" placeholder="https://..." onchange="updateWalkthroughPointField(${i}, 'imageUrl', this.value)" style="width: 100%; padding: 6px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>
                <div>
                    <label style="font-size: 10px; color: #666;">Description</label>
                    <textarea rows="2" placeholder="Describe this location..." onchange="updateWalkthroughPointField(${i}, 'description', this.value)" style="width: 100%; padding: 6px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${p.description || ''}</textarea>
                </div>
                ${p.imageUrl ? `<div style="margin-top: 8px;"><img src="${p.imageUrl}" style="max-width: 100%; max-height: 80px; border-radius: 4px; object-fit: cover;" onerror="this.style.display='none'"></div>` : ''}
            </div>
            
            <!-- Camera Settings -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px;">
                <div>
                    <label style="font-size: 10px; color: #666;">Label (Admin)</label>
                    <input type="text" value="${p.label || ''}" onchange="updateWalkthroughPointField(${i}, 'label', this.value)" style="width: 100%; padding: 4px; font-size: 11px;">
                </div>
                <div>
                    <label style="font-size: 10px; color: #666;">Zoom</label>
                    <input type="number" value="${p.zoom}" min="8" max="20" step="0.5" onchange="updateWalkthroughPointField(${i}, 'zoom', this.value)" style="width: 100%; padding: 4px; font-size: 11px;">
                </div>
                <div>
                    <label style="font-size: 10px; color: #666;">Pitch</label>
                    <input type="number" value="${p.pitch}" min="0" max="85" step="5" onchange="updateWalkthroughPointField(${i}, 'pitch', this.value)" style="width: 100%; padding: 4px; font-size: 11px;">
                </div>
                <div>
                    <label style="font-size: 10px; color: #666;">Bearing</label>
                    <input type="number" value="${p.bearing}" min="0" max="360" step="15" onchange="updateWalkthroughPointField(${i}, 'bearing', this.value)" style="width: 100%; padding: 4px; font-size: 11px;">
                </div>
                <div>
                    <label style="font-size: 10px; color: #666;">Duration (ms)</label>
                    <input type="number" value="${p.durationMs || ''}" placeholder="Default" min="1000" step="500" onchange="updateWalkthroughPointField(${i}, 'durationMs', this.value)" style="width: 100%; padding: 4px; font-size: 11px;">
                </div>
                <div style="font-size: 10px; color: #999; padding-top: 14px;">
                    ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}
                </div>
            </div>
        </div>
    `).join('')
}

function renderWalkthroughMarkers() {
    // Clear existing markers
    walkthroughMarkers.forEach(m => m.remove())
    walkthroughMarkers = []
    
    if (!walkthroughMap) return
    
    walkthroughPoints.forEach((p, i) => {
        const el = document.createElement('div')
        el.className = 'walkthrough-marker'
        el.innerHTML = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${p.order}</div>`
        
        const marker = new mapboxgl.Marker(el)
            .setLngLat([p.longitude, p.latitude])
            .addTo(walkthroughMap)
        
        walkthroughMarkers.push(marker)
    })
    
    // Draw line connecting points
    if (walkthroughPoints.length >= 2) {
        const coordinates = walkthroughPoints.map(p => [p.longitude, p.latitude])
        
        if (walkthroughMap.getSource('walkthrough-route')) {
            walkthroughMap.getSource('walkthrough-route').setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates }
            })
        } else {
            walkthroughMap.on('load', () => {
                if (!walkthroughMap.getSource('walkthrough-route')) {
                    walkthroughMap.addSource('walkthrough-route', {
                        type: 'geojson',
                        data: {
                            type: 'Feature',
                            geometry: { type: 'LineString', coordinates }
                        }
                    })
                    walkthroughMap.addLayer({
                        id: 'walkthrough-route-line',
                        type: 'line',
                        source: 'walkthrough-route',
                        paint: {
                            'line-color': '#22c55e',
                            'line-width': 3,
                            'line-dasharray': [2, 2]
                        }
                    })
                }
            })
        }
    }
}

function flyToPoint(index) {
    if (!walkthroughMap || !walkthroughPoints[index]) return
    
    const p = walkthroughPoints[index]
    walkthroughMap.flyTo({
        center: [p.longitude, p.latitude],
        zoom: p.zoom,
        pitch: p.pitch,
        bearing: p.bearing,
        duration: 2000
    })
}

async function previewWalkthrough() {
    if (walkthroughPoints.length < 2) {
        alert('Add at least 2 points to preview')
        return
    }
    
    const duration = parseInt(document.getElementById('walkthroughDuration').value) || 3000
    
    for (let i = 0; i < walkthroughPoints.length; i++) {
        const p = walkthroughPoints[i]
        await new Promise(resolve => {
            walkthroughMap.flyTo({
                center: [p.longitude, p.latitude],
                zoom: p.zoom,
                pitch: p.pitch,
                bearing: p.bearing,
                duration: p.durationMs || duration
            })
            setTimeout(resolve, (p.durationMs || duration) + 500)
        })
    }
}

async function saveWalkthrough() {
    if (!currentWalkthroughCityId) {
        alert('No city selected')
        return
    }
    
    if (walkthroughPoints.length < 2) {
        alert('Add at least 2 points for the walkthrough')
        return
    }
    
    console.log('[Admin] Saving walkthrough. currentWalkthroughId:', currentWalkthroughId)
    
    const payload = {
        cityId: currentWalkthroughCityId,
        name: document.getElementById('walkthroughName').value || null,
        isActive: document.getElementById('walkthroughActive').checked,
        defaultDurationMs: parseInt(document.getElementById('walkthroughDuration').value) || 3000,
        points: walkthroughPoints.map(p => ({
            order: p.order,
            latitude: p.latitude,
            longitude: p.longitude,
            zoom: p.zoom,
            pitch: p.pitch,
            bearing: p.bearing,
            durationMs: p.durationMs || null,
            label: p.label || null,
            // Rich content fields
            title: p.title || null,
            description: p.description || null,
            imageUrl: p.imageUrl || null,
        }))
    }
    
    try {
        let response
        if (currentWalkthroughId) {
            // Update existing
            console.log('[Admin] Using PUT to update walkthrough:', currentWalkthroughId)
            response = await fetch(`${API_BASE}/api/admin/walkthroughs/${currentWalkthroughId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
        } else {
            // Create new
            console.log('[Admin] Using POST to create new walkthrough')
            response = await fetch(`${API_BASE}/api/admin/walkthroughs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
        }
        
        const result = await response.json()
        
        if (result.success) {
            currentWalkthroughId = result.data.id
            showMessage('citiesMessage', `Walkthrough saved with ${walkthroughPoints.length} points!`, 'success')
            hideWalkthroughModal()
        } else {
            alert('Error: ' + (result.error || 'Unknown error'))
        }
    } catch (error) {
        alert('Error saving walkthrough: ' + error.message)
    }
}

async function deleteWalkthrough() {
    if (!currentWalkthroughId) {
        alert('No walkthrough to delete')
        return
    }
    
    if (!confirm('Delete this walkthrough? This cannot be undone.')) return
    
    try {
        const response = await fetch(`${API_BASE}/api/admin/walkthroughs/${currentWalkthroughId}`, {
            method: 'DELETE'
        })
        const result = await response.json()
        
        if (result.success) {
            showMessage('citiesMessage', 'Walkthrough deleted', 'success')
            hideWalkthroughModal()
        } else {
            alert('Error: ' + (result.error || 'Unknown error'))
        }
    } catch (error) {
        alert('Error deleting walkthrough: ' + error.message)
    }
}

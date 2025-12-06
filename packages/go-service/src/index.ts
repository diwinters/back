/**
 * GoMiniApp Go-Service Package
 * Business logic for ride-hailing and delivery
 */

// Services
export { DriverService } from './services/driver.service'
export { OrderService } from './services/order.service'
export { RatingService } from './services/rating.service'
export { UserService } from './services/user.service'

// Validation schemas
export {
  registerDriverSchema,
  updateLocationSchema,
  updateAvailabilitySchema,
} from './services/driver.service'

export {
  createOrderSchema,
  acceptOrderSchema,
  updateOrderStatusSchema,
} from './services/order.service'

export {
  createRatingSchema,
} from './services/rating.service'

export {
  registerUserSchema,
  updateUserSchema,
} from './services/user.service'

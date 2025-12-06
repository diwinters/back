/**
 * User Service
 * Manages user registration and profiles
 */

import { z } from 'zod'
import {
  prisma,
  validateDid,
  logger,
  NotFoundError,
  ConflictError,
  ErrorCode,
} from '@gominiapp/core'
import type { UserProfile } from '@gominiapp/core'

export const registerUserSchema = z.object({
  did: z.string().min(1),
  handle: z.string().optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  pushToken: z.string().optional(),
})

export const updateUserSchema = z.object({
  handle: z.string().optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  pushToken: z.string().optional(),
})

export class UserService {
  /**
   * Register or update user from Bluesky DID
   */
  async registerOrUpdateUser(
    data: z.infer<typeof registerUserSchema>
  ): Promise<UserProfile> {
    const validated = registerUserSchema.parse(data)

    // Validate DID format
    if (!validateDid(validated.did)) {
      throw new Error('Invalid DID format')
    }

    // Upsert user
    const user = await prisma.user.upsert({
      where: { did: validated.did },
      update: {
        handle: validated.handle,
        displayName: validated.displayName,
        avatarUrl: validated.avatarUrl,
        pushToken: validated.pushToken,
        lastActive: new Date(),
      },
      create: {
        did: validated.did,
        handle: validated.handle,
        displayName: validated.displayName,
        avatarUrl: validated.avatarUrl,
        pushToken: validated.pushToken,
      },
      include: {
        driver: true,
      },
    })

    logger.info('User registered/updated', { userId: user.id, did: validated.did })

    return this.toUserProfile(user)
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<UserProfile> {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { driver: true },
    })

    if (!user) {
      throw new NotFoundError('User not found', ErrorCode.USER_NOT_FOUND)
    }

    return this.toUserProfile(user)
  }

  /**
   * Get user by DID
   */
  async getUserByDid(did: string): Promise<UserProfile> {
    const user = await prisma.user.findUnique({
      where: { did },
      include: { driver: true },
    })

    if (!user) {
      throw new NotFoundError('User not found', ErrorCode.USER_NOT_FOUND)
    }

    return this.toUserProfile(user)
  }

  /**
   * Update user profile
   */
  async updateUser(
    userId: string,
    data: z.infer<typeof updateUserSchema>
  ): Promise<UserProfile> {
    const validated = updateUserSchema.parse(data)

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...validated,
        lastActive: new Date(),
      },
      include: { driver: true },
    })

    return this.toUserProfile(user)
  }

  /**
   * Update push token
   */
  async updatePushToken(userId: string, pushToken: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { pushToken },
    })

    logger.debug('Push token updated', { userId })
  }

  /**
   * Get or create user for auth
   */
  async getOrCreateForAuth(did: string, handle?: string): Promise<UserProfile> {
    let user = await prisma.user.findUnique({
      where: { did },
      include: { driver: true },
    })

    if (!user) {
      user = await prisma.user.create({
        data: { did, handle },
        include: { driver: true },
      })
      logger.info('New user created via auth', { userId: user.id, did })
    } else {
      // Update last active
      await prisma.user.update({
        where: { id: user.id },
        data: { lastActive: new Date() },
      })
    }

    return this.toUserProfile(user)
  }

  private toUserProfile(user: any): UserProfile {
    return {
      id: user.id,
      did: user.did,
      handle: user.handle,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isDriver: user.isDriver,
    }
  }
}

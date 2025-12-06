/**
 * DID Authentication & Validation
 * Validates Bluesky DIDs and provides auth middleware
 */

import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const BSKY_DID_PLC_URL = process.env.BSKY_DID_PLC_URL || 'https://plc.directory'

export interface AuthenticatedRequest extends Request {
  user?: {
    did: string
    handle?: string
  }
}

/**
 * Validates a Bluesky DID format
 */
export function validateDid(did: string): boolean {
  // DID format: did:plc:xxxx or did:web:domain
  const didRegex = /^did:(plc:[a-z0-9]+|web:[a-zA-Z0-9.-]+)$/
  return didRegex.test(did)
}

/**
 * Resolves a DID to get the associated handle and verify it exists
 */
export async function resolveDid(did: string): Promise<{ handle?: string; valid: boolean }> {
  if (!validateDid(did)) {
    return { valid: false }
  }

  try {
    // For did:plc, resolve from PLC directory
    if (did.startsWith('did:plc:')) {
      const response = await fetch(`${BSKY_DID_PLC_URL}/${did}`)
      if (!response.ok) {
        return { valid: false }
      }
      
      const data = await response.json()
      // Extract handle from alsoKnownAs
      const handle = data.alsoKnownAs?.find((aka: string) => aka.startsWith('at://'))?.replace('at://', '')
      
      return { handle, valid: true }
    }

    // For did:web, resolve from the domain's .well-known
    if (did.startsWith('did:web:')) {
      const domain = did.replace('did:web:', '')
      const response = await fetch(`https://${domain}/.well-known/did.json`)
      if (!response.ok) {
        return { valid: false }
      }
      return { valid: true }
    }

    return { valid: false }
  } catch (error) {
    logger.error('DID resolution failed', { did, error })
    return { valid: false }
  }
}

/**
 * Extracts DID from Authorization header
 * Supports: Bearer <jwt> or DID <did>
 */
export function extractDid(authHeader: string | undefined): string | null {
  if (!authHeader) return null

  // JWT Bearer token
  if (authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7)
      const decoded = jwt.verify(token, JWT_SECRET) as { did: string }
      return decoded.did
    } catch {
      return null
    }
  }

  // Direct DID (for development/testing)
  if (authHeader.startsWith('DID ')) {
    const did = authHeader.slice(4)
    return validateDid(did) ? did : null
  }

  return null
}

/**
 * Generates a JWT for a validated DID
 */
export function generateToken(did: string, handle?: string): string {
  return jwt.sign(
    { did, handle },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

/**
 * Express middleware for DID authentication
 */
export function authMiddleware(required: boolean = true) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    const did = extractDid(authHeader)

    if (!did) {
      if (required) {
        return next(new AppError('Authentication required', 401))
      }
      return next()
    }

    // Validate DID exists
    const resolved = await resolveDid(did)
    if (!resolved.valid) {
      return next(new AppError('Invalid DID', 401))
    }

    req.user = {
      did,
      handle: resolved.handle,
    }

    next()
  }
}

/**
 * Validates DID ownership by checking a signed challenge
 * Used for initial registration/verification
 */
export async function verifyDidOwnership(
  did: string,
  challenge: string,
  signature: string
): Promise<boolean> {
  // In production, this would verify the signature against the DID's public key
  // For now, we trust the Bluesky session
  logger.info('DID ownership verification', { did, challenge })
  return true
}

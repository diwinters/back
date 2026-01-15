/**
 * Jetstream Types
 * Type definitions for Bluesky Jetstream events
 */

export interface JetstreamCommit {
  rev: string
  operation: 'create' | 'update' | 'delete'
  collection: string
  rkey: string
  record?: any
  cid: string
}

export interface JetstreamIdentity {
  did: string
  handle: string
  seq: number
  time: string
}

export interface JetstreamAccount {
  active: boolean
  did: string
  seq: number
  status?: string
}

export interface JetstreamEvent {
  did: string
  time_us: number
  kind: 'commit' | 'identity' | 'account'
  commit?: JetstreamCommit
  identity?: JetstreamIdentity
  account?: JetstreamAccount
}

export interface JetstreamStatus {
  status: 'running' | 'stopped' | 'error' | 'connecting'
  cursor: bigint | null
  watchedDidsCount: number
  listUri: string | null
  lastEventAt: Date | null
  errorMessage: string | null
  postsIndexedTotal: number
}

export interface PostRecord {
  $type: 'app.bsky.feed.post'
  text: string
  createdAt: string
  langs?: string[]
  facets?: Facet[]
  embed?: any
  reply?: {
    root: { uri: string; cid: string }
    parent: { uri: string; cid: string }
  }
}

export interface Facet {
  index: { byteStart: number; byteEnd: number }
  features: FacetFeature[]
}

export type FacetFeature =
  | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string }

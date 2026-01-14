"use strict";
/**
 * Labeler Routes
 * Backend endpoints for the Raceef Labeler service
 *
 * The labeler automatically labels posts created through the Raceef app
 * so they can be filtered in search results.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.labelerRouter = void 0;
const express_1 = require("express");
const core_1 = require("@gominiapp/core");
const api_1 = require("@atproto/api");
const router = (0, express_1.Router)();
exports.labelerRouter = router;
// Labeler agent instance (initialized on first use)
let labelerAgent = null;
/**
 * Initialize the labeler agent with credentials from environment
 */
async function getLabelerAgent() {
    if (labelerAgent) {
        return labelerAgent;
    }
    const identifier = process.env.LABELER_IDENTIFIER;
    const password = process.env.LABELER_PASSWORD;
    if (!identifier || !password) {
        throw new Error('LABELER_IDENTIFIER and LABELER_PASSWORD must be set in environment');
    }
    const agent = new api_1.BskyAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier, password });
    labelerAgent = agent;
    core_1.logger.info('[Labeler] Agent initialized', { did: agent.session?.did });
    return agent;
}
/**
 * POST /api/labeler/label
 * Label a post with the Raceef app label
 *
 * Body:
 * - uri: AT-URI of the post (required)
 * - cid: CID of the post (optional, for versioning)
 *
 * This endpoint is called after a post is created in the app.
 * Only authenticated users can label posts (the user creating the post).
 */
router.post('/label', async (req, res, next) => {
    try {
        const userDid = req.headers['x-user-did'];
        if (!userDid) {
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'User DID required' }
            });
        }
        const { uri, cid } = req.body;
        if (!uri) {
            return res.status(400).json({
                success: false,
                error: { code: 'MISSING_URI', message: 'Post URI is required' }
            });
        }
        // Verify the post belongs to the authenticated user
        if (!uri.startsWith(`at://${userDid}/`)) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Can only label your own posts' }
            });
        }
        // Get app config for label value
        const config = await core_1.prisma.appConfig.findUnique({
            where: { id: 1 },
            select: { labelerDid: true, labelerLabelValue: true }
        });
        if (!config?.labelerDid) {
            core_1.logger.warn('[Labeler] No labeler DID configured');
            return res.status(503).json({
                success: false,
                error: { code: 'LABELER_NOT_CONFIGURED', message: 'Labeler service not configured' }
            });
        }
        const labelValue = config.labelerLabelValue || 'raceef-post';
        // Get the labeler agent
        const agent = await getLabelerAgent();
        // Create the label using the labeler's signing key
        // Note: This uses com.atproto.label.publishLabel which is the labeler-specific endpoint
        const label = {
            src: agent.session.did, // Labeler's DID
            uri: uri,
            cid: cid || undefined,
            val: labelValue,
            neg: false,
            cts: new Date().toISOString(),
        };
        // For a real labeler service, you'd sign and publish the label
        // Using the labeler's repo. For now, we'll store it in our DB
        // and the client will filter by it.
        // Store the label in our database for tracking
        await core_1.prisma.postLabel.create({
            data: {
                postUri: uri,
                postCid: cid || null,
                labelValue: labelValue,
                labelerDid: agent.session.did,
                authorDid: userDid,
            }
        });
        core_1.logger.info('[Labeler] Post labeled', { uri, labelValue, userDid });
        res.json({
            success: true,
            data: { label }
        });
    }
    catch (error) {
        core_1.logger.error('[Labeler] Failed to label post', { error });
        next(error);
    }
});
/**
 * GET /api/labeler/status
 * Check if the labeler service is configured and operational
 */
router.get('/status', async (req, res, next) => {
    try {
        const config = await core_1.prisma.appConfig.findUnique({
            where: { id: 1 },
            select: { labelerDid: true, labelerLabelValue: true }
        });
        const isConfigured = Boolean(config?.labelerDid);
        let isAuthenticated = false;
        if (isConfigured && process.env.LABELER_IDENTIFIER && process.env.LABELER_PASSWORD) {
            try {
                await getLabelerAgent();
                isAuthenticated = true;
            }
            catch (e) {
                core_1.logger.warn('[Labeler] Agent authentication failed', { error: e });
            }
        }
        res.json({
            success: true,
            data: {
                configured: isConfigured,
                authenticated: isAuthenticated,
                labelerDid: config?.labelerDid || null,
                labelValue: config?.labelerLabelValue || 'raceef-post',
            }
        });
    }
    catch (error) {
        core_1.logger.error('[Labeler] Failed to get status', { error });
        next(error);
    }
});
/**
 * GET /api/labeler/labels
 * Get all labeled post URIs (from PostLabel table AND MarketPost table)
 *
 * This endpoint returns URIs of posts that should appear in Raceef search:
 * 1. Posts explicitly labeled via the labeler (PostLabel table)
 * 2. Market product posts (MarketPost table) - these are also Raceef app posts
 *
 * Query params:
 * - uri: Filter by post URI
 * - authorDid: Filter by author DID
 */
router.get('/labels', async (req, res, next) => {
    try {
        const { uri, authorDid } = req.query;
        // Get labels from PostLabel table
        const labelWhere = {};
        if (uri)
            labelWhere.postUri = uri;
        if (authorDid)
            labelWhere.authorDid = authorDid;
        const labels = await core_1.prisma.postLabel.findMany({
            where: labelWhere,
            orderBy: { createdAt: 'desc' },
            take: 500,
        });
        // Also get market posts (products) - these are also app posts
        const marketWhere = {
            postUri: { not: null },
            status: 'ACTIVE' // Only active products
        };
        if (uri)
            marketWhere.postUri = uri;
        // For authorDid, we need to join through seller->user
        const marketPosts = await core_1.prisma.marketPost.findMany({
            where: marketWhere,
            select: {
                postUri: true,
                seller: {
                    select: {
                        user: {
                            select: { did: true }
                        }
                    }
                }
            },
            take: 500,
        });
        // Filter market posts by authorDid if specified
        let filteredMarketPosts = marketPosts;
        if (authorDid) {
            filteredMarketPosts = marketPosts.filter(mp => mp.seller?.user?.did === authorDid);
        }
        // Combine both into a unified format
        const combinedLabels = [
            ...labels.map(l => ({
                postUri: l.postUri,
                authorDid: l.authorDid,
                source: 'label',
            })),
            ...filteredMarketPosts.map(mp => ({
                postUri: mp.postUri,
                authorDid: mp.seller?.user?.did || null,
                source: 'market',
            })),
        ];
        // Deduplicate by postUri
        const seen = new Set();
        const uniqueLabels = combinedLabels.filter(l => {
            if (seen.has(l.postUri))
                return false;
            seen.add(l.postUri);
            return true;
        });
        core_1.logger.info(`[Labeler] Returning ${uniqueLabels.length} labeled URIs (${labels.length} from labels, ${filteredMarketPosts.length} from market)`);
        res.json({
            success: true,
            data: { labels: uniqueLabels }
        });
    }
    catch (error) {
        core_1.logger.error('[Labeler] Failed to get labels', { error });
        next(error);
    }
});

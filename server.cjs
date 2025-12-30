/* server.cjs - SmartHire Backend (Security, Payments & Subscription) */
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit'); 

// --- 1. INITIALIZE FIREBASE ---
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log("✅ SmartHire Firebase Admin Initialized");
    } catch (error) { console.error("❌ Firebase Error:", error); }
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- 2. SECURITY MIDDLEWARE ---

// A. INCREASE PAYLOAD LIMIT TO 50MB (For large CVs/JDs)
app.use(express.json({ 
    limit: '50mb', 
    verify: (req, res, buf) => { req.rawBody = buf.toString(); } 
}));
app.use(cors());

// B. RATE LIMITER
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 100, 
	standardHeaders: 'draft-7', 
	legacyHeaders: false, 
    message: { error: "Too many requests, please try again later." }
});
app.use('/api/analyze', apiLimiter);

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// --- AI ROUTE ---
app.post('/api/analyze', async (req, res) => {
    try {
        const { contents, systemInstruction, generationConfig } = req.body;
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, systemInstruction, generationConfig })
        });
       
        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error?.message || 'Google API Error');
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- PORTAL ROUTE (SmartHire Specific) ---
app.post('/api/create-portal-session', async (req, res) => {
    const { userId } = req.body;
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Server missing Stripe Key" });

    try {
        // Look at 'smarthire_tracker'
        const userDoc = await admin.firestore().collection('users').doc(userId).collection('usage_limits').doc('smarthire_tracker').get();
        const stripeCustomerId = userDoc.data()?.stripeCustomerId;

        if (!stripeCustomerId) return res.status(404).json({ error: "No subscription found for this user." });

        const stripe = require('stripe')(STRIPE_SECRET_KEY);
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `https://smarthire-application.onrender.com`, // Keeps user on SmartHire
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("Portal Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- WEBHOOK ROUTE (FIXED) ---
app.post('/api/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = require('stripe')(STRIPE_SECRET_KEY);
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    // 1. UNLOCK (Pro Mode ON)
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const stripeCustomerId = session.customer; 

        if (userId && admin.apps.length) {
            // Write to 'smarthire_tracker' to unlock
            await admin.firestore()
                .collection('users').doc(userId).collection('usage_limits').doc('smarthire_tracker')
                .set({ isSubscribed: true, stripeCustomerId: stripeCustomerId }, { merge: true }); 
            console.log(`✅ SmartHire Unlocked: ${userId} -> ${stripeCustomerId}`);
        }
    }
   
    // 2. LOCK (Pro Mode OFF) - ADDED THIS BLOCK
    if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        const stripeCustomerId = subscription.customer;

        if (admin.apps.length) {
            try {
                // Search ALL usage_limits docs for this Stripe ID
                const snapshot = await admin.firestore().collectionGroup('usage_limits')
                    .where('stripeCustomerId', '==', stripeCustomerId)
                    .get();

                if (snapshot.empty) {
                    console.log(`⚠️ SmartHire: Refund processed, but no matching user found for Stripe ID: ${stripeCustomerId}`);
                } else {
                    snapshot.forEach(async (doc) => {
                        // FORCE DOWNGRADE
                        await doc.ref.update({ isSubscribed: false });
                        console.log(`❌ SmartHire: DOWNGRADE SUCCESS. User (Doc ID: ${doc.id}) cancelled.`);
                    });
                }
            } catch (err) {
                console.error("Error processing cancellation:", err);
            }
        }
    }

    res.send();
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'dist', 'index.html')); });
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });

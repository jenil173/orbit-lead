/**
 * Diagnostic script to verify Firebase Admin credentials.
 * Run with: node debug_firebase.js
 */
require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

console.log("🔍 OrbitLead Firebase Diagnostic Tool");
console.log("-----------------------------------------");

const projectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
const privateKeyRaw = (process.env.FIREBASE_PRIVATE_KEY || '');

console.log(`- Project ID: ${projectId || 'MISSING'}`);
console.log(`- Client Email: ${clientEmail || 'MISSING'}`);
console.log(`- Private Key Length: ${privateKeyRaw.length} chars`);

// Normalize PEM
function formatPEM(key) {
  if (!key) return '';
  let cleaned = key.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  if (cleaned.includes('-----BEGIN PRIVATE KEY-----') && cleaned.includes('\n')) return cleaned;
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  let base64 = cleaned.replace(header, '').replace(footer, '').replace(/\s+/g, '');
  const matches = base64.match(/.{1,64}/g);
  return `${header}\n${matches ? matches.join('\n') : base64}\n${footer}\n`;
}

const privateKey = formatPEM(privateKeyRaw);

if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
  console.error("❌ ERROR: Private Key is malformed (missing header)");
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  console.log("✅ Admin SDK Initialized Successfully!");
  
  const db = admin.firestore();
  console.log("📡 Testing Connection to Firestore...");
  
  db.collection('settings').limit(1).get()
    .then(() => {
      console.log("🎉 SUCCESS: Firestore Connection Verified!");
      process.exit(0);
    })
    .catch(err => {
      console.error("❌ FIRESTORE ERROR:", err.message);
      process.exit(1);
    });

} catch (e) {
  console.error("❌ INITIALIZATION ERROR:", e.message);
  process.exit(1);
}

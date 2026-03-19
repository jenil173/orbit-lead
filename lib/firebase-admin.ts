import * as admin from 'firebase-admin';

// Strip quotes from env vars
function cleanEnv(str: string | undefined): string {
  if (!str) return '';
  let s = str.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.substring(1, s.length - 1);
  if (s.startsWith("'") && s.endsWith("'")) s = s.substring(1, s.length - 1);
  return s.trim();
}

// Aggressively normalize PEM keys for OpenSSL 3.0 / Node 18+ (especially for Vercel)
function formatPEM(key: string): string {
  if (!key) return '';
  
  // 1. Clean up potential junk
  let cleaned = key.trim()
    .replace(/^["']|["']$/g, '')   // Remove wrapping quotes
    .replace(/\\n/g, '\n')        // Fix escaped \n
    .replace(/\\n/g, '\n');       // Double run for safety

  // 2. Ensure it has headers
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  
  if (!cleaned.includes(header)) {
    cleaned = `${header}\n${cleaned}`;
  }
  if (!cleaned.includes(footer)) {
    cleaned = `${cleaned}\n${footer}`;
  }

  // 3. Re-chunk the body to be 100% compliant with OpenSSL 3.0
  let body = cleaned
    .replace(header, '')
    .replace(footer, '')
    .replace(/\s+/g, ''); // Remove all whitespace/newlines from body
  
  const matches = body.match(/.{1,64}/g);
  const chunkedBody = matches ? matches.join('\n') : body;
  
  const finalKey = `${header}\n${chunkedBody}\n${footer}\n`;
  
  // Safe logging for debugging Vercel (only prefix)
  console.log(`[FIREBASE] Key formatted. Length: ${finalKey.length}. Prefix: ${finalKey.substring(0, 30)}...`);
  
  return finalKey;
}

if (!admin.apps.length) {
  try {
    const projectId = cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
    const clientEmail = cleanEnv(process.env.FIREBASE_CLIENT_EMAIL);
    const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || '';
    
    const privateKey = formatPEM(privateKeyRaw);

    if (projectId && clientEmail && privateKey.includes('PRIVATE KEY')) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      console.log("[FIREBASE] Admin initialized for:", projectId);
    } else {
      let missing = [];
      if (!projectId) missing.push("PROJECT_ID");
      if (!clientEmail) missing.push("CLIENT_EMAIL");
      if (!privateKey.includes('PRIVATE KEY')) missing.push("PRIVATE_KEY_FORMAT");
      console.error("[FIREBASE] Initialization failed. Missing/Invalid:", missing.join(', '));
    }
  } catch (error) {
    console.error('[FIREBASE] Initialization error:', error);
  }
}

// Export a robust getter for admin services
export const getAdminDb = () => {
  if (!admin.apps.length) throw new Error("Firebase Admin not initialized - Check .env.local keys");
  return admin.firestore();
};

export const getAdminAuth = () => {
  if (!admin.apps.length) throw new Error("Firebase Admin not initialized - Check .env.local keys");
  return admin.auth();
};

// For backward compatibility (use sparingly)
export const adminDb = admin.apps.length ? admin.firestore() : null as any;
export const adminAuth = admin.apps.length ? admin.auth() : null as any;

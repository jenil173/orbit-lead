import * as admin from 'firebase-admin';

// Strip quotes from env vars
function cleanEnv(str: string | undefined): string {
  if (!str) return '';
  let s = str.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.substring(1, s.length - 1);
  if (s.startsWith("'") && s.endsWith("'")) s = s.substring(1, s.length - 1);
  return s.trim();
}

if (!admin.apps.length) {
  try {
    const projectId = cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
    const clientEmail = cleanEnv(process.env.FIREBASE_CLIENT_EMAIL);
    const privateKeyRaw = cleanEnv(process.env.FIREBASE_PRIVATE_KEY);
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey.includes('BEGIN PRIVATE KEY')) {
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
      if (!privateKey.includes('BEGIN PRIVATE KEY')) missing.push("PRIVATE_KEY_FORMAT");
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
